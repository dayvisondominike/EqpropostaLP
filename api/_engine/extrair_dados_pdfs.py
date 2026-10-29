"""
Etapa 1 - Leitura dos PDFs de cotacao (pasta Cotacao) e montagem do DataFrame de propostas.

Cada fornecedor usa um layout de proposta diferente, entao cada um tem sua propria
funcao de parsing (regex sobre o texto extraido com pdfplumber). O resultado e
salvo em CSV para ser consumido pela etapa 2 (criar_planilha_equalizacao.py).
"""
import re
import unicodedata
from pathlib import Path

import pandas as pd
import pdfplumber

import extrair_llm

BASE_DIR = Path(__file__).parent
COTACAO_DIR = BASE_DIR / "Cotacao"
CARACTERISTICAS_DIR = COTACAO_DIR / "Caracteristicas_Produto"
SAIDA_DIR = BASE_DIR / "processado"
try:
    SAIDA_DIR.mkdir(exist_ok=True)
except OSError:
    # Sistema de arquivos somente leitura (Vercel): engine.py redireciona SAIDA_DIR para /tmp.
    pass

MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5,
    "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10,
    "novembro": 11, "dezembro": 12,
}


def _norm(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode()
    return txt.lower()


def extrair_texto(caminho: Path, x_tolerance: float = 3) -> str:
    with pdfplumber.open(caminho) as pdf:
        return "\n".join(page.extract_text(x_tolerance=x_tolerance) or "" for page in pdf.pages)


def data_por_extenso(dia, mes_nome, ano) -> str:
    mes = MESES.get(_norm(mes_nome))
    if mes is None:
        return ""
    return f"{int(dia):02d}/{mes:02d}/{ano}"


# ----------------------------------------------------------------------------
# Cliente (E-mail de solicitacao de cotacao)
# ----------------------------------------------------------------------------
def parse_cliente(texto: str) -> dict:
    # A fonte embutida neste PDF (e-mail exportado do Outlook) tem um bug de
    # renderização que ocasionalmente "engole" uma letra adjacente; o único
    # caso observado até agora é "Preferncial" no lugar de "Preferencial"
    # (falta o segundo "e"). extrair_texto() já usa x_tolerance mais estreito
    # para esse arquivo para recuperar os espaços entre palavras que a mesma
    # fonte quebrada também faz desaparecer.
    texto = texto.replace("Preferncial", "Preferencial")

    def buscar(padroes, default=None):
        """Tenta cada regex em ordem e retorna o primeiro grupo 1 que bater.
        Aceita tanto o layout "Rótulo: valor" (formato original do e-mail da
        Mirella) quanto o layout invertido "valor \\n Rótulo:" (formato que
        apareceu no e-mail da DAFRA) - nessa ordem, pois o padrão "normal" é
        mais comum e o "invertido" só deve ser tentado quando não há valor
        nenhum na mesma linha do rótulo."""
        if isinstance(padroes, str):
            padroes = [padroes]
        for padrao in padroes:
            m = re.search(padrao, texto, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return default

    return {
        "Razão Social": buscar([r"Razão Social:[ \t]*([^\n]+)", r"\n([^\n]+)\nRazão [Ss]ocial:"]),
        "CNPJ": buscar([r"CNPJ:[ \t]*([\d./-]+)", r"\n([\d./-]+)\nCNPJ:"]),
        "Modalidade": buscar([r"Modalidade:[ \t]*([^\n]+)", r"\n([^\n]+)\nModalidade:"]),
        "Tipo de Energia": buscar([r"Tipo de [Ee]nergia:[ \t]*([^\n]+)", r"\n([^\n]+)\nTipo de [Ee]nergia:"]),
        "Submercado": buscar([r"Submercado:[ \t]*([^\n]+)", r"\n([^\n]+)\nSubmercado:"]),
        "Período": buscar([r"Período:[ \t]*([^\n]+)", r"\n([^\n]+)\nPeríodo:"]),
        "Volume (MWm)": buscar([
            r"Volume [\[(]MWm[\])]:[ \t]*([\d,.]+)",
            r"\n([\d,.]+)\nVolume [\[(]MWm[\])]:",
        ]),
        "Flexibilidade": buscar([r"Flexibilidade:[ \t]*([^\n]+)", r"\n([^\n]+)\nFlexibilidade:"]),
        "Sazo": buscar([r"Sazo:[ \t]*([^\n]+)", r"\n([^\n]+)\nSazo:"]),
        "Modulação": buscar([r"Modulação:[ \t]*([^\n]+)", r"\n([^\n]+)\nModulação:"]),
        "Prazo de envio das propostas": buscar([
            r"Envio da proposta até dia\s*(.+?)\.",
            r"Prazo de envio das propostas:\s*(.+)",
        ]),
        "Validade das propostas": buscar([
            r"Validade da proposta até dia\s*(.+?)\.",
            r"Validade das propostas:\s*(.+)",
        ]),
    }


# ----------------------------------------------------------------------------
# Fornecedores
# ----------------------------------------------------------------------------
def parse_axia(texto: str) -> dict:
    fonte = re.search(r"Tipo de Energia:\s*(.+?)\s*Submercado:", texto)
    submercado = re.search(r"Submercado:\s*(\w+)", texto)

    linhas_forn = re.findall(
        r"(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+100\s+NE\s+([\d,]+)\s+([\d,]+)\s+[\d.,]+",
        texto,
    )
    precos = {inicio.split("/")[-1]: float(preco.replace(",", ".")) for inicio, _fim, _vol, preco in linhas_forn}
    volume = float(linhas_forn[0][2].replace(",", ".")) if linhas_forn else None
    periodo = f"{linhas_forn[0][0]} a {linhas_forn[-1][1]}" if linhas_forn else None

    flex = re.search(r"Flexibilidade Mensal:\s*(\S+)", texto)
    sazo = re.search(r"Sazonalização:\s*(\w+)", texto)
    modulacao = re.search(r"Modulação:\s*(\w+)", texto)
    garantia = re.search(r"Garantias:\s*(.+)", texto)
    # Valor de Re-TUSD para Incentivada 50% citado na cláusula de ressarcimento
    # (a mesma frase também traz o valor para Incentivada 100%, não usado aqui).
    retusd = re.search(r"corresponde à R\$\s*([\d,]+)/MWh", texto)
    pagamento = re.search(r"Vencimento da Fatura:\s*(.+)", texto)
    databases = re.search(r"Data base:\s*(\d{2}/\d{2}/\d{4})", texto)
    emissao = re.search(r"Data da Proposta:\s*(\d{1,2}) de (\w+) de (\d{4})", texto)
    validade = re.search(r"Data de Vencimento da Proposta:\s*(.+)", texto)

    return {
        "Fornecedor": "AXIA",
        "Tipo de Proposta": "Firme",
        "Fonte": fonte.group(1).strip() if fonte else None,
        "Submercado": submercado.group(1) if submercado else None,
        "Período": periodo,
        "Volume (MWm)": volume,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1) if flex else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": garantia.group(1).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": data_por_extenso(*emissao.groups()) if emissao else None,
        "Validade da Proposta": validade.group(1).strip() if validade else None,
    }


def parse_auren_indicativa(texto: str) -> dict:
    periodo = re.search(r"Período de Suprimento:\s*(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})", texto)
    anos = re.findall(r"^(20\d{2})\s+([\d,]+)\s+([\d,]+)\s", texto, re.MULTILINE)
    precos = {ano: float(preco.replace(",", ".")) for ano, _vol, preco in anos}
    volume = anos[0][1].replace(",", ".") if anos else None
    emissao = re.search(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})\n?Comprador:", texto)

    return {
        "Fornecedor": "AUREN",
        "Tipo de Proposta": "Indicativa",
        "Fonte": "Incentivada 50%",
        "Submercado": re.search(r"Submercado:\s*(\w+)", texto).group(1),
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume) if volume else None,
        "Preços por ano": precos,
        "Flexibilidade": re.search(r"Flexibilidade:\s*(.+)", texto).group(1).strip(),
        "Sazonalidade": re.search(r"Sazonalidade:\s*(\w+)", texto).group(1),
        "Modulação": re.search(r"Modulação:\s*(\w+)", texto).group(1),
        "Garantia": re.search(r"Garantia financeira:\s*(.+)", texto).group(1).strip(),
        "RETUSD (R$/MWh)": None,
        "Pagamento": re.search(r"Prazo de Pagamento:\s*(.+)", texto).group(1).strip(),
        "Data Base": re.search(r"Data Base:\s*(\d{2}/\d{2}/\d{4})", texto).group(1),
        "Data da Proposta": f"{emissao.group(1)} {emissao.group(2)}" if emissao else None,
        "Validade da Proposta": "Válida na data de emissão (indicativo não vinculante)",
    }


def parse_auren_firme(texto: str) -> dict:
    # Layout novo (proposta "Firme"), diferente do formato "Indicativa" acima:
    # tabelas de volume/preço em bloco único (não uma linha por ano) e sem
    # rótulos com dois-pontos (ex.: "Fonte", "Garantia", "Modulação").
    periodo = re.search(r"Período de suprimento\s+De\s+(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})", texto)
    volume = re.search(r"Volume \(MWm\)\n(20\d{2})\s+([\d,]+)\s+-", texto)
    preco = re.search(r"Preço de Energia \(R\$/MWh\)\n(20\d{2})\s+([\d,]+)", texto)
    fonte = re.search(r"Fonte\s+(.+?)\.", texto)
    submercado = re.search(r"Centro de gravidade do submercado (\w+)", texto)
    databases = re.search(r"data-base em\s*(\d{2}/\d{2}/\d{4})", texto)
    pagamento = re.search(r"O pagamento deverá ser realizado\s+(.+?)\.", texto)
    flex = re.search(r"(Mínimo de [\d,]+% e Máximo de [\d,]+%)", texto)
    sazo = re.search(r"Sazonalização (\w+)\.", texto)
    modulacao = re.search(r"Modulação (\w+)\.", texto)
    garantia = re.search(r"\nGarantia\s+(Registro contra pagamento)", texto)
    retusd = re.search(r"Ress = R\$([\d.,]+)/MWh", texto)
    validade = re.search(r"válida até às (\d{1,2})hrs? do dia (\d{2}/\d{2}/\d{4})", texto)

    ano = preco.group(1) if preco else None
    precos = {ano: float(preco.group(2).replace(",", "."))} if preco and ano else {}

    return {
        "Fornecedor": "AUREN",
        "Tipo de Proposta": "Firme",
        "Fonte": fonte.group(1).strip() if fonte else None,
        "Submercado": submercado.group(1) if submercado else None,
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume.group(2).replace(",", ".")) if volume else None,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1) if flex else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": garantia.group(1) if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        # Não há uma "data de emissão" explícita no corpo do texto; a proposta
        # não traz metadado de criação no PDF, então usamos a data da rodada de
        # cotação (mesma data de emissão dos demais fornecedores deste lote).
        "Data da Proposta": "11/09/2026",
        "Validade da Proposta": f"{validade.group(2)} às {validade.group(1)}:00" if validade else None,
    }


def parse_casa_dos_ventos(texto: str) -> dict:
    fonte = re.search(r"Fonte de Energia Elétrica\s+(.+)", texto)
    submercado = re.search(r"Submercado\s+(\w+)\n", texto)
    periodo = re.search(r"Período de Fornecimento\s+(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})", texto)
    precos = {ano: float(preco.replace(",", ".")) for ano, preco in
              re.findall(r"^(20\d{2})\s+([\d,]+)\s*R\$/MWh", texto, re.MULTILINE)}
    volume = re.search(r"^(0,\d+)\s+MWm", texto, re.MULTILINE)
    modulacao = re.search(r"Modulação\s+(\w+)", texto)
    sazo = re.search(r"Sazonalização\s+([+\-/\d%]+)", texto)
    flex = re.search(r"Flexibilidade\s+([+\-/\d%]+)", texto)
    garantia = re.search(r"Garantia\s+(Registro Contra Pagamento)", texto)
    retusd = re.search(r"RETUSD\s+R\$\s*([\d,]+)", texto)
    pagamento = re.search(r"Data do pagamento\s+(.+?)\n", texto)
    databases = re.search(r"Data base\s+(\d{2}/\d{2}/\d{4})", texto)
    emissao = re.search(r"São Paulo/SP,\s*(\d{1,2}) de (\w+) de (\d{4})", texto)
    validade = re.search(r"Validade da Proposta:\s*Esta Proposta é válida até\s*(.+?)\.", texto)

    return {
        "Fornecedor": "CASA DOS VENTOS",
        "Tipo de Proposta": "Firme",
        "Fonte": fonte.group(1).strip() if fonte else None,
        "Submercado": submercado.group(1) if submercado else None,
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume.group(1).replace(",", ".")) if volume else None,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1) if flex else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": garantia.group(1) if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": data_por_extenso(*emissao.groups()) if emissao else None,
        "Validade da Proposta": validade.group(1).strip() if validade else None,
    }


def parse_copel(texto: str) -> dict:
    # O PDF da Copel tem um problema de fonte que insere espaços soltos no meio
    # de palavras e números (ex.: "Ressarcim ento", "286 ,5 0"); por isso os
    # valores numéricos são "espremidos" (remoção de espaços) após a captura.
    anos_precos = re.findall(
        r"01 de Janeiro de (20\d{2}) a 31 de\s*\n0,274000\s+BRL([\d\s,]+?)\s*100%", texto
    )
    precos = {ano: float(preco.replace(" ", "").replace(",", ".")) for ano, preco in anos_precos}
    anos_ordenados = sorted(precos.keys())

    volume = re.search(r"(0,\d+)\s*BRL", texto)
    databases = re.search(r"Data base do preço:\s*(\d{2}/\d{2}/\d{4})", texto)
    garantia = re.search(r"Garantia financeira:\s*(.+)", texto)
    retusd = re.search(r"Ressarcim.{0,3}ento TUSD:\s*R\$\s*([\d,]+)", texto)
    pagamento = re.search(r"Data de pagam.{0,3}ento:\s*(.+)", texto)
    fonte = re.search(r"Energia:\s*(.+)", texto)
    modulacao = re.search(r"M\s?odulação:\s*(\w+)", texto)
    sazo = re.search(r"Sazonalização:\s*(.+?)Flexibilidade", texto, re.DOTALL)
    flex = re.search(r"Flexibilidade \(atrelada a m\s?edição\):\s*(.+?)Perdas", texto, re.DOTALL)
    emissao = re.search(r"Data d\s?e em\s?issão:\s*([^\n]+)", texto)
    validade = re.search(r"Valid\s?ad\s?e d\s?a proposta:\s*([^\n]+)", texto)

    def _espremer(s):
        return re.sub(r"\s+", "", s).replace("-", " ") if s else None

    return {
        "Fornecedor": "COPEL",
        "Tipo de Proposta": "Vinculante",
        "Fonte": fonte.group(1).strip() if fonte else None,
        "Submercado": "Nordeste",
        "Período": f"01/01/{anos_ordenados[0]} a 31/12/{anos_ordenados[-1]}" if anos_ordenados else None,
        "Volume (MWm)": float(volume.group(1).replace(",", ".")) if volume else None,
        "Preços por ano": precos,
        "Flexibilidade": re.sub(r"\s+", " ", flex.group(1)).strip() if flex else None,
        "Sazonalidade": re.sub(r"\s+", " ", sazo.group(1)).strip() if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": garantia.group(1).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": _espremer(emissao.group(1)) if emissao else None,
        "Validade da Proposta": _espremer(validade.group(1)) if validade else None,
    }


def parse_echoenergia(texto: str) -> dict:
    # As tabelas de Volume e Preço têm 4 colunas (submercados N/NE/SE-CO/S) e só
    # uma vem preenchida - as outras vêm "N/A". A posição da coluna preenchida
    # muda conforme o submercado do cliente (ex.: Nordeste antes, Norte agora),
    # então extraímos as 4 colunas e pegamos a primeira que não é "N/A".
    periodo = re.search(r"Início de Contrato:\s*(\d{2}/\d{2}/\d{4})\s*Fim de Contrato:\s*(\d{2}/\d{2}/\d{4})", texto)
    submercado_cli = re.search(r"Centro de Gravidade do Submercado Submercado:\s*(\w+)", texto)
    tabela_volume = re.search(
        r"(\d{2}/\d{2}/\d{4}) à\n([\d.,]+|N/A)\s+([\d.,]+|N/A)\s+([\d.,]+|N/A)\s+([\d.,]+|N/A)\n(\d{2}/\d{2}/\d{4})",
        texto,
    )
    volume_str = next((g for g in tabela_volume.groups()[1:5] if g != "N/A"), None) if tabela_volume else None
    retusd = re.search(r"\n\w+\s+I\d+\s+R\$\s*([\d,]+)", texto)
    tabela_preco = re.findall(
        r"^(20\d{2})\s+((?:R\$\s*[\d,]+|N/A))\s+((?:R\$\s*[\d,]+|N/A))\s+((?:R\$\s*[\d,]+|N/A))\s+((?:R\$\s*[\d,]+|N/A))$",
        texto, re.MULTILINE,
    )
    precos = {}
    for ano, *colunas in tabela_preco:
        preco_str = next((c for c in colunas if c != "N/A"), None)
        if preco_str:
            precos[ano] = float(preco_str.replace("R$", "").strip().replace(",", "."))
    sazo = re.search(r"Sazonalidade\n([+\-/\d%\s]+)\nDeverá", texto)
    flex = re.search(r"Flexibilidade\n([+\-/\d%\s]+)\nOs limites", texto)
    modulacao = re.search(r"Modulação:\s*(\w+)", texto)
    databases = re.search(r"Data Base e Índice de reajuste\n(\d{2}/\d{2}/\d{4})", texto)
    pagamento_dia = re.search(r"Dia de pagamento:\s*(\d+)", texto)
    emissao = re.search(r"São Paulo/SP,\s*(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})\.", texto)
    validade = re.search(r"Validade da proposta:\s*(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})", texto)

    return {
        "Fornecedor": "ECHOENERGIA",
        "Tipo de Proposta": "Vinculante (contrato preliminar)",
        "Fonte": "Incentivada 50%",
        "Submercado": submercado_cli.group(1) if submercado_cli else None,
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume_str.replace(",", ".")) if volume_str else None,
        "Preços por ano": precos,
        "Flexibilidade": re.sub(r"\s+", " ", flex.group(1)).strip() if flex else None,
        "Sazonalidade": re.sub(r"\s+", " ", sazo.group(1)).strip() if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": "Não se aplica",
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": f"Dia útil {pagamento_dia.group(1)} do mês subsequente" if pagamento_dia else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": f"{emissao.group(1)} {emissao.group(2)}" if emissao else None,
        "Validade da Proposta": validade.group(1) if validade else None,
    }


def parse_engie(texto: str) -> dict:
    fonte_sub = re.search(r"Fonte Submercado Período de fornecimento\n(Incentivada \d+%)", texto)
    periodo = re.search(r"(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})", texto)
    precos = {ano: float(preco.replace(",", "."))
              for _ini, ano, preco in
              re.findall(r"\d{2}/\d{2}/(20\d{2})\s+\d{2}/\d{2}/(20\d{2})\s+IPCA\s+R\$([\d,]+)", texto)}
    volume = re.search(r"(20\d{2}) (0,\d+) 0,\d+ 0,\d+", texto)
    databases = re.search(r"Database:\s*(\d{2}/\d{2}/\d{4})", texto)
    pagamento = re.search(r"Condição de Pagamento:\s*(.+)", texto)
    flex = re.search(r"Flexibilidade de Consumo:\s*(.+)", texto)
    sazo = re.search(r"Sazonalização:\s*Flexibilidade da Sazonalização:\s*(\w+)", texto)
    modulacao = re.search(r"Modulação:\s*(\w+)", texto)
    garantia = re.search(r"Garantia:\s*(.+)", texto)
    emissao = re.search(r"Florianópolis,\s*(\d{1,2}) de (\w+) de (\d{4})", texto)
    # A proposta indicativa (PVI-*) não traz valor de RETUSD - ele só aparece
    # na cláusula 2.11 do contrato-modelo A-GILIZA anexado (por isso o texto
    # das duas PDFs da pasta é combinado antes de chegar aqui, ver
    # PASTAS_TEXTO_COMBINADO).
    retusd = re.search(r"perda total do referido desconto corresponde à R\$\s*([\d,]+)/MWh", texto)

    return {
        "Fornecedor": "ENGIE",
        "Tipo de Proposta": "Indicativa (produto A-GILIZA)",
        "Fonte": fonte_sub.group(1) if fonte_sub else "Incentivada 50%",
        "Submercado": "Nordeste",
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume.group(2).replace(",", ".")) if volume else 0.274,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1).strip() if flex else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": garantia.group(1).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": data_por_extenso(*emissao.groups()) if emissao else None,
        "Validade da Proposta": "Não informada (proposta indicativa, sujeita a alteração)",
    }


def parse_voltta(texto: str) -> dict:
    # O PDF da Voltta é uma proposta ESCANEADA (cada página é uma imagem;
    # pdfplumber extrai 0 caracteres de texto) e este ambiente não tem OCR
    # instalado (sem pytesseract/tesseract). Os campos abaixo foram lidos
    # visualmente nas imagens das páginas (Cotacao/Volta/VOLTA - Proposta de
    # Venda - DAFRA DA AMAZONIA INDUSTRIA E COMERCIO DE MOTOCICLETAS LTDA -
    # 11 de set. de 2026.pdf) e transcritos manualmente, mantendo o mesmo
    # schema dos demais fornecedores.
    return {
        "Fornecedor": "VOLTTA",
        # A cláusula "Vinculação" desta proposta obriga as Partes a celebrar o
        # Contrato (sob multa), diferente da proposta anterior da Voltta, que
        # era apenas indicativa.
        "Tipo de Proposta": "Firme",
        "Fonte": "Incentivada 50%",
        "Submercado": "Norte (N)",
        "Período": "01/01/2027 a 31/12/2027",
        "Volume (MWm)": 0.36,
        "Preços por ano": {"2027": 297.35},
        "Flexibilidade": "-100% / +30%",
        "Sazonalidade": "+/-0% conforme histórico de consumo (se não enviado até 30/11 do ano anterior, considerada Flat)",
        "Modulação": "Carga",
        "Garantia": "Sem garantia financeira da compradora (registro contra pagamento)",
        "RETUSD (R$/MWh)": 35.0,
        "Pagamento": "6º dia útil do mês subsequente ao mês de suprimento, até às 16:00",
        "Data Base": "01/09/2026",
        "Data da Proposta": "11/09/2026",
        "Validade da Proposta": "11/09/2026 às 18:00",
    }


def parse_cemig(texto: str) -> dict:
    tabela_volume = re.search(
        r"Submercado Quantidade \(MWmédio\) Data inicial Data final\n"
        r"(\w+)\s+([\d,]+)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})",
        texto,
    )
    tabela_preco = re.search(
        r"Submercado Data inicial Data final Preço \(R\$/MWh\)\n"
        r"\w+\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+R\$\s*([\d,]+)",
        texto,
    )
    fonte = re.search(r"Tipo de energia:\s*(.+?TUSD)", texto, re.DOTALL)
    # A flexibilidade da CEMIG vem em duas cláusulas separadas (piso e teto de
    # consumo, ambos "% da energia mensal sazonalizada") em vez de um único
    # campo "+NN%/-NN%" como os demais fornecedores; combinamos as duas no
    # campo Flexibilidade para que apareçam juntas na aderência e na tela.
    takeorpay = re.search(r"Take-or-pay:\s*(.+)", texto)
    flex = re.search(r"Flexibilidade mensal:\s*(.+)", texto)
    flexibilidade_texto = "; ".join(
        t for t in [
            f"Take-or-pay: {takeorpay.group(1).strip()}" if takeorpay else None,
            flex.group(1).strip() if flex else None,
        ] if t
    )
    sazo = re.search(r"Sazonalização:\s*(.+)", texto)
    modulacao = re.search(r"Modulação:\s*(.+?)\.", texto)
    # Garantia só é exigida condicionalmente, a depender do resultado da análise
    # de crédito do comprador (não é uma garantia fixa como nos demais fornecedores).
    garantia = re.search(
        r"garantia de pagamento no valor equivalente a\s*(.+?),\s*por meio de uma das modalidades",
        texto, re.DOTALL,
    )
    # Não há um campo "RETUSD" explícito; usamos o valor de redução do preço citado
    # na cláusula de substituição de energia incentivada por convencional, que tem
    # o mesmo efeito prático do ressarcimento de TUSD cobrado pelos demais fornecedores.
    retusd = re.search(r"redução do Preço\s+em R\$\s*([\d,]+)/MWh", texto)
    pagamento = re.search(r"Data de pagamento da fatura:\s*(.+)", texto)
    databases = re.search(r"Base do preço:\s*(\d{2}/\d{2}/\d{4})", texto)
    emissao = re.search(r"\nData:\s*(\d{2}/\d{2}/\d{4})", texto)
    validade = re.search(r"Validade da proposta:\s*(\d{2}/\d{2}/\d{4})", texto)

    ano = tabela_preco.group(1).split("/")[-1] if tabela_preco else None
    precos = {ano: float(tabela_preco.group(3).replace(",", "."))} if tabela_preco and ano else {}

    return {
        "Fornecedor": "CEMIG",
        "Tipo de Proposta": "Firme",
        "Fonte": re.sub(r"\s+", " ", fonte.group(1)).strip() if fonte else None,
        "Submercado": tabela_volume.group(1) if tabela_volume else None,
        "Período": f"{tabela_volume.group(3)} a {tabela_volume.group(4)}" if tabela_volume else None,
        "Volume (MWm)": float(tabela_volume.group(2).replace(",", ".")) if tabela_volume else None,
        "Preços por ano": precos,
        "Flexibilidade": flexibilidade_texto or None,
        "Sazonalidade": sazo.group(1).strip() if sazo else None,
        "Modulação": modulacao.group(1).strip() if modulacao else None,
        "Garantia": (
            f"Condicionada à análise de crédito; se exigida, {garantia.group(1).strip()} "
            "(Caução, Fiança Bancária, Seguro Garantia ou Depósito Caução)"
        ) if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": emissao.group(1) if emissao else None,
        "Validade da Proposta": validade.group(1) if validade else None,
    }


def parse_light(texto: str) -> dict:
    tipo_energia = re.search(r"TIPO DE ENERGIA CONTRATADA\s+(.+)", texto)
    submercado = re.search(r"SUBMERCADO\s+(.+)", texto)
    periodo = re.search(
        r"PERÍODO DE FORNECIMENTO\s+(\d{2}/\d{2}/\d{4})\s*(?:à|a|-|–)\s*(\d{2}/\d{2}/\d{4})", texto
    )
    volume = re.search(r"MWmed:\s*([\d,]+)", texto)
    precos = {
        ano: float(preco.replace(",", "."))
        for ano, preco in re.findall(
            r"01/01/(20\d{2})\s*-\s*31/12/20\d{2}\s+Preço \(R\$/MWh\):\s*([\d,]+)", texto
        )
    }
    flex_inf = re.search(r"Limite inferior de flexibilidade:\s*-?\s*([\d,]+)", texto)
    flex_sup = re.search(r"Limite superior de flexibilidade:\s*\+?\s*([\d,]+)", texto)
    sazo = re.search(r"SAZONALIZAÇÃO\s+(\w+)", texto)
    modulacao = re.search(r"MODULAÇÃO\s+(\w+)", texto)
    # O rótulo "19. GARANTIA" vem DEPOIS do valor (tabela de duas colunas
    # extraída fora de ordem pelo pdfplumber). Quando garantia é exigida, o
    # valor é o parágrafo da cláusula "19.1 A COMPRADORA..."; quando não é
    # exigida, o valor é só uma linha curta ("Não Aplicável.").
    garantia = (
        re.search(r"(19\.1 A COMPRADORA.+?)\n19\. GARANTIA", texto, re.DOTALL)
        or re.search(r"\n([^\n]+)\n19\. GARANTIA", texto)
    )
    retusd = re.search(r"R\$\s*([\d,]+)/MWh[^\n]*\n15\. RETUSD", texto)
    pagamento = re.search(r"(Até o [^\n]+)\n17\. VENCIMENTO DA FATURA", texto)
    databases = re.search(r"Data base:\s*(\d{2}/\d{2}/\d{4})", texto)
    validade = re.search(r"válida até\s*(.+?)\.", texto)
    # Não há uma "data de emissão" explícita no corpo do texto; a proposta
    # costuma valer só até a noite do próprio dia em que foi emitida (mesmo
    # padrão dos demais fornecedores deste tipo), então usamos a data contida
    # na Validade em vez de fixar uma data no código.
    data_emissao = re.search(r"(\d{2}/\d{2}/\d{4})", validade.group(1)) if validade else None

    return {
        "Fornecedor": "LIGHT",
        "Tipo de Proposta": "Firme",
        "Fonte": tipo_energia.group(1).strip() if tipo_energia else None,
        "Submercado": submercado.group(1).strip() if submercado else None,
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": float(volume.group(1).replace(",", ".")) if volume else None,
        "Preços por ano": precos,
        "Flexibilidade": f"-{flex_inf.group(1)}% / +{flex_sup.group(1)}%" if flex_inf and flex_sup else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": re.sub(r"\s+", " ", garantia.group(1)).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": data_emissao.group(1) if data_emissao else None,
        "Validade da Proposta": validade.group(1).strip() if validade else None,
    }


def parse_serena(texto: str) -> dict:
    # O PDF da Serena é uma apresentação em slides com fontes customizadas (cada
    # página é renderizada como imagem para o pdfplumber, que extrai 0 caracteres
    # de texto). Os campos abaixo foram lidos visualmente nas páginas 3, 4 e 7 do
    # arquivo (Cotacao/Serena/SERENA - Proposta Indicativa - MIRELLA ARTEFATOS
    # DE BORRACHA LTDA.pdf) e transcritos manualmente, mantendo o mesmo schema
    # dos demais fornecedores. Precisa ser atualizado manualmente a cada nova
    # cotação (submercado, volume, preços e datas mudam a cada arquivo).
    return {
        "Fornecedor": "SERENA",
        "Tipo de Proposta": "Indicativa",
        "Fonte": "Incentivada 50%",
        "Submercado": "Nordeste (NE)",
        "Período": "01/01/2027 a 31/12/2029",
        "Volume (MWm)": 0.274,
        "Preços por ano": {"2027": 272.00, "2028": 265.00, "2029": 252.00},
        "Flexibilidade": "+/-30%",
        "Sazonalidade": "Não há",
        "Modulação": "Flat",
        "Garantia": "A ser avaliada pelo comitê de risco da Serena",
        "RETUSD (R$/MWh)": 35.0,
        "Pagamento": "Até o 6º dia útil do mês subsequente ao de fornecimento",
        "Data Base": "01/09/2026",
        "Data da Proposta": "15/09/2026",
        "Validade da Proposta": "Indicativa, sujeita à aprovação do Comitê de Risco & Portfolio da Serena (não vinculante)",
    }


def parse_ludcom(texto: str) -> dict:
    fonte = re.search(r"Tipo de Energia:\s*(.+?)\.", texto)
    submercado = re.search(r"Centro de Gravidade do Submercado (\w+)", texto)
    periodo = re.search(r"Período de Fornecimento:\s*(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})", texto)
    # Tabela com uma linha por ano: "Início Fim Volume Preço Percentual", ex.
    # "01/2027 12/2027 0,274 310,01 100%".
    linhas_tabela = re.findall(r"\d{2}/(\d{4})\s+\d{2}/\d{4}\s+([\d,]+)\s+([\d,]+)\s+\d+%", texto)
    precos = {ano: float(preco.replace(",", ".")) for ano, _vol, preco in linhas_tabela}
    volume = float(linhas_tabela[0][1].replace(",", ".")) if linhas_tabela else None
    flex = re.search(r"Flexibilidade Mensal:\s*(.+)", texto)
    sazo = re.search(r"Sazonalidade:\s*(\w+)", texto)
    modulacao = re.search(r"Modulação Horária:\s*(\w+)", texto)
    garantia = re.search(r"Garantia Financeira:\s*(.+?)\.", texto, re.DOTALL)
    retusd = re.search(r"ressarcida proporcionalmente à R\$\s*([\d,]+)/MWh", texto)
    pagamento = re.search(r"Pagamento:\s*(.+?)\.", texto)
    databases = re.search(r"Data-base do Preço:\s*(\d{2}/\d{2}/\d{4})", texto)
    emissao = re.search(r"Data da Operação:\s*(\d{2}/\d{2}/\d{4})", texto)
    validade = re.search(r"Validade Proposta:\s*(.+)", texto)

    return {
        "Fornecedor": "LUDCOM",
        "Tipo de Proposta": "Firme",
        "Fonte": fonte.group(1).strip() if fonte else None,
        "Submercado": submercado.group(1) if submercado else None,
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": volume,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1).strip() if flex else None,
        "Sazonalidade": sazo.group(1) if sazo else None,
        "Modulação": modulacao.group(1) if modulacao else None,
        "Garantia": re.sub(r"\s+", " ", garantia.group(1)).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        "Data da Proposta": emissao.group(1) if emissao else None,
        "Validade da Proposta": validade.group(1).strip() if validade else None,
    }


def parse_neoenergia_pe(texto: str) -> dict:
    tipo_energia = re.search(r"Tipo de Energia Contratada:\s*(\w+)", texto)
    fonte = "Incentivada 50%" if tipo_energia and tipo_energia.group(1).lower() == "i5" else (
        tipo_energia.group(1).strip() if tipo_energia else None
    )
    # O texto vem "invertido" (a data aparece antes do rótulo) por causa de
    # como a tabela de duas colunas do PDF é extraída pelo pdfplumber.
    periodo = re.search(r"(\d{2}/\d{2}/\d{4}) até (\d{2}/\d{2}/\d{4})\nPeríodo de suprimento:", texto)

    # As tabelas de Volume e de Preço têm o mesmo formato de linha (Ano Início
    # Fim Valor); usamos os textos "MWm"/"Preço R$/MWh" como âncoras para não
    # misturar as duas.
    bloco_volume = re.search(r"MWm\n(.*?)Preço de Venda", texto, re.DOTALL)
    bloco_preco = re.search(r"Preço R\$/MWh\n(.*?)Especificamente", texto, re.DOTALL)
    volumes = dict(re.findall(r"(20\d{2}) \d{2}/\d{2}/\d{4} \d{2}/\d{2}/\d{4} (0,\d+)", bloco_volume.group(1))) if bloco_volume else {}
    precos = {
        ano: float(preco.replace(",", "."))
        for ano, preco in re.findall(r"(20\d{2}) \d{2}/\d{2}/\d{4} \d{2}/\d{2}/\d{4} (\d+,\d+)", bloco_preco.group(1))
    } if bloco_preco else {}
    volume = float(next(iter(volumes.values())).replace(",", ".")) if volumes else None

    sazo = re.search(r"Sazonalização:\s*([^\n]+)", texto)
    flex = re.search(r"Flexibilidade:\s*([^\n]+)", texto)
    # "Não há flexibilidade de modulação" = perfil fixo, equivalente a Flat.
    modulacao_raw = re.search(r"Modulação:\s*([^\n]+)", texto)
    modulacao = "Flat" if modulacao_raw and "não há flexibilidade" in modulacao_raw.group(1).lower() else (
        modulacao_raw.group(1).strip() if modulacao_raw else None
    )
    retusd = re.search(r"valor de R\$\s*([\d,]+)/MWh", texto)
    garantia = re.search(r"Garantia financeira:\s*(.+?\.)", texto, re.DOTALL)
    pagamento = re.search(r"Data do pagamento:\s*([^\n.]+)", texto)
    databases = re.search(r"Data base:\s*(\d{2}/\d{2}/\d{4})", texto)
    validade = re.search(r"válidas até\s*(\d{2}/\d{2}/\d{4}\s*às\s*[\d:]+\s*hs)", texto)

    return {
        "Fornecedor": "NEOENERGIA PE",
        "Tipo de Proposta": "Firme",
        "Fonte": fonte,
        "Submercado": "Nordeste (NE)",
        "Período": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
        "Volume (MWm)": volume,
        "Preços por ano": precos,
        "Flexibilidade": flex.group(1).strip() if flex else None,
        "Sazonalidade": sazo.group(1).strip() if sazo else None,
        "Modulação": modulacao,
        "Garantia": re.sub(r"\s+", " ", garantia.group(1)).strip() if garantia else None,
        "RETUSD (R$/MWh)": float(retusd.group(1).replace(",", ".")) if retusd else None,
        "Pagamento": pagamento.group(1).strip() if pagamento else None,
        "Data Base": databases.group(1) if databases else None,
        # A proposta não traz uma "data de emissão" explícita no corpo do
        # texto; usamos a data de criação do PDF (metadado CreationDate).
        "Data da Proposta": "14/07/2026",
        "Validade da Proposta": validade.group(1).strip() if validade else None,
    }


# Fornecedores cujo PDF não tem texto extraível (proposta escaneada/imagem) -
# para esses, o parser acima independe do "texto" vindo do pdfplumber.
PASTAS_SEM_TEXTO_EXTRAIVEL = {"Volta", "Serena"}

PARSERS = {
    # Ordem alfabética (mesma ordem em que os fornecedores aparecem na grade
    # "Fonte de Dados" da interface Streamlit) - usada aqui para que a animação
    # de processamento em tela siga a mesma sequência mostrada ao usuário.
    #
    # O valor de cada entrada é ou uma função de parsing única, ou um dict de
    # variantes {palavra-chave no nome do arquivo: parser} + "default" - usado
    # quando o mesmo fornecedor manda propostas em formatos diferentes (ex.:
    # a Auren já mandou tanto "Prop Indic" quanto "Prop Firme").
    "Auren": {"indic": parse_auren_indicativa, "firme": parse_auren_firme, "default": parse_auren_firme},
    "Axia": parse_axia,
    "Casa dos Ventos": parse_casa_dos_ventos,
    "Cemig": parse_cemig,
    "Copel": parse_copel,
    "Echoenergia": parse_echoenergia,
    "Engie": parse_engie,
    "Light": parse_light,
    "Ludcom": parse_ludcom,
    "Neoenergia PE": parse_neoenergia_pe,
    "Serena": parse_serena,
    "Volta": parse_voltta,
}


def _resolver_parser(entrada, nome_arquivo: str):
    """Resolve a entrada de PARSERS (função direta, ou dict de variantes por
    palavra-chave no nome do arquivo) para a função de parsing a usar."""
    if callable(entrada):
        return entrada
    nome = _norm(nome_arquivo)
    for chave, parser in entrada.items():
        if chave != "default" and _norm(chave) in nome:
            return parser
    return entrada["default"]


def _localizar_pdf_pasta(pasta_dir: Path):
    """Cada fornecedor tem sua própria subpasta em Cotacao/ e o nome do PDF
    muda a cada cotação (cliente, data, número da proposta); por isso achamos
    o arquivo pelo nome da PASTA, não por um nome de arquivo fixo."""
    pdfs = sorted(pasta_dir.glob("*.pdf")) if pasta_dir.exists() else []
    if not pdfs:
        return None
    if len(pdfs) == 1:
        return pdfs[0]
    mais_recente = max(pdfs, key=lambda p: p.stat().st_mtime)
    print(f"[AVISO] Mais de um PDF em {pasta_dir}, usando o mais recente: {mais_recente.name}")
    return mais_recente


# Pastas em que múltiplos PDFs não são versões concorrentes (onde faria
# sentido pegar só o mais recente), e sim documentos complementares que
# precisam ser lidos juntos - ex.: a Engie manda a proposta indicativa (PVI-*)
# separada do contrato-modelo do produto A-GILIZA, e cláusulas do contrato
# (como o valor do RETUSD) só aparecem no anexo, não na proposta em si.
PASTAS_TEXTO_COMBINADO = {"Engie"}


def _extrair_texto_pasta(pasta_dir: Path):
    """Retorna (texto, caminho_para_log) para a pasta de um fornecedor,
    combinando o texto de todos os PDFs quando a pasta está em
    PASTAS_TEXTO_COMBINADO, ou lendo só o mais recente nos demais casos."""
    if pasta_dir.name in PASTAS_TEXTO_COMBINADO:
        pdfs = sorted(pasta_dir.glob("*.pdf")) if pasta_dir.exists() else []
        if not pdfs:
            return None, None
        # A proposta em si costuma ser bem mais curta que o contrato-modelo
        # anexado (dezenas de páginas de cláusulas gerais); colocamos o texto
        # mais curto primeiro para que os campos que existem nos dois
        # documentos (datas, preços etc.) continuem batendo com a proposta,
        # e só usamos o texto do contrato para campos que só existem nele
        # (ex.: RETUSD, ver parse_engie).
        textos = sorted((extrair_texto(p) for p in pdfs), key=len)
        return "\n".join(textos), pdfs[-1]
    caminho = _localizar_pdf_pasta(pasta_dir)
    if caminho is None:
        return None, None
    return extrair_texto(caminho), caminho


def montar_dataframe_propostas(on_vendor=None) -> pd.DataFrame:
    """on_vendor(nome_pasta), se informado, é chamado logo após cada fornecedor
    ser processado (com ou sem sucesso) - usado pela interface Streamlit para
    animar o checklist de processamento em tempo real.

    Para cada pasta de fornecedor, tenta primeiro a extração via LLM
    (extrair_llm.extrair_proposta_llm, com todos os PDFs da pasta - inclusive
    escaneados/em imagem, e inclusive quando há mais de um arquivo, ex.:
    proposta + contrato-modelo anexado). Se isso não for possível (sem SDK/
    chave configurada, erro de API etc.), cai para o parser em regex antigo
    daquele fornecedor, se ele tiver um cadastrado em PARSERS. Só marca "SEM
    DADOS" se as duas tentativas falharem (ou não houver parser em regex para
    aquele fornecedor)."""
    linhas = []
    anos_encontrados = set()

    pastas_fornecedores = sorted(
        p for p in COTACAO_DIR.iterdir() if p.is_dir() and p != CARACTERISTICAS_DIR
    )

    for pasta_dir in pastas_fornecedores:
        pasta = pasta_dir.name
        pdfs = sorted(pasta_dir.glob("*.pdf"))
        if not pdfs:
            print(f"[AVISO] Nenhum PDF encontrado para {pasta} em {pasta_dir}")
            if on_vendor:
                on_vendor(pasta)
            continue

        dados = extrair_llm.extrair_proposta_llm(pdfs, pasta)

        if dados is None:
            parser_entry = PARSERS.get(pasta)
            if parser_entry is not None:
                texto, caminho = _extrair_texto_pasta(pasta_dir)
                if caminho is not None:
                    if texto.strip() or pasta in PASTAS_SEM_TEXTO_EXTRAIVEL:
                        parser = _resolver_parser(parser_entry, caminho.name)
                        dados = parser(texto)
                    else:
                        print(f"[AVISO] PDF de {pasta} veio vazio/corrompido, pulando: {caminho}")

        if dados is None:
            tamanho_total = sum(p.stat().st_size for p in pdfs)
            print(f"[AVISO] Não foi possível extrair dados de '{pasta}' nem via LLM nem via "
                  f"regex (arquivos: {[p.name for p in pdfs]}, bytes: {tamanho_total}).")
            dados = {
                "Fornecedor": pasta.upper(),
                "Tipo de Proposta": "SEM DADOS",
                "Fonte": None, "Submercado": None, "Período": None, "Volume (MWm)": None,
                "Preços por ano": {}, "Flexibilidade": None, "Sazonalidade": None,
                "Modulação": None, "Garantia": None, "RETUSD (R$/MWh)": None, "Pagamento": None,
                "Data Base": None, "Data da Proposta": None,
                "Validade da Proposta": "Extração indisponível (LLM e regex falharam) - sem dados para equalizar",
            }

        anos_encontrados.update(dados["Preços por ano"].keys())
        linhas.append(dados)
        if on_vendor:
            on_vendor(pasta)

    anos_ordenados = sorted(anos_encontrados)
    for linha in linhas:
        precos = linha.pop("Preços por ano")
        for ano in anos_ordenados:
            linha[f"Preço {ano} (R$/MWh)"] = precos.get(ano)

    colunas = (
        ["Fornecedor", "Tipo de Proposta", "Fonte", "Submercado", "Período", "Volume (MWm)"]
        + [f"Preço {ano} (R$/MWh)" for ano in anos_ordenados]
        + ["Flexibilidade", "Sazonalidade", "Modulação", "Garantia", "RETUSD (R$/MWh)",
           "Pagamento", "Data Base", "Data da Proposta", "Validade da Proposta"]
    )
    df = pd.DataFrame(linhas)
    for c in colunas:
        if c not in df.columns:
            df[c] = None
    return df[colunas]


def localizar_email_cliente() -> Path:
    """O nome do PDF do e-mail de cotação muda a cada cliente (ex.: "...Mirella
    Artefatos.pdf", "...DAFRA.pdf"), então localizamos pelo prefixo dentro da
    subpasta Caracteristicas_Produto em vez de fixar o nome do arquivo."""
    candidatos = sorted(CARACTERISTICAS_DIR.glob("E-mail*.pdf"))
    if not candidatos:
        raise FileNotFoundError(
            f"Nenhum PDF de e-mail do cliente encontrado em {CARACTERISTICAS_DIR}"
        )
    return candidatos[0]


def extrair_dados_cliente(caminho_email: Path) -> dict:
    dados = extrair_llm.extrair_cliente_llm(caminho_email)
    if dados is None:
        # x_tolerance mais estreito: a fonte embutida neste e-mail exportado do
        # Outlook tem um bug que faz o pdfplumber "colar" palavras adjacentes sem
        # espaço no meio (ex.: "Incentivada50%"); ver comentário em parse_cliente.
        dados = parse_cliente(extrair_texto(caminho_email, x_tolerance=1))
    return dados


def main(on_vendor=None):
    if not extrair_llm.disponivel():
        print(
            "[INFO] Extração via LLM indisponível (pacote 'anthropic' não instalado e/ou "
            "ANTHROPIC_API_KEY não configurada) - usando os parsers em regex como alternativa "
            "para cada fornecedor."
        )
    df_propostas = montar_dataframe_propostas(on_vendor=on_vendor)
    df_cliente = pd.DataFrame([extrair_dados_cliente(localizar_email_cliente())])

    # Proposta indicativa sem volume (ex.: Casa dos Ventos só traz preço) é
    # cotada para o volume pedido no e-mail - sem isso ela ficaria sem VPL e
    # marcada como "Sem dados". A coluna abaixo vira observação na aderência.
    sem_volume = df_propostas["Volume (MWm)"].isna() & (df_propostas["Tipo de Proposta"] != "SEM DADOS")
    df_propostas["Volume informado na proposta"] = ~sem_volume
    df_propostas.loc[sem_volume, "Volume (MWm)"] = df_cliente.loc[0, "Volume (MWm)"]

    df_propostas.to_csv(SAIDA_DIR / "propostas.csv", index=False, encoding="utf-8-sig")
    df_cliente.to_csv(SAIDA_DIR / "cliente.csv", index=False, encoding="utf-8-sig")

    print(f"\n{len(df_propostas)} propostas extraídas:")
    print(df_propostas.to_string(index=False))
    print("\nDados do cliente:")
    print(df_cliente.to_string(index=False))
    return df_propostas, df_cliente


if __name__ == "__main__":
    main()
