"""
Etapa 2 (+ etapa 4) - Cria o arquivo xlsx de equalizacao a partir dos CSVs
gerados pela etapa 1 (processado/propostas.csv e processado/cliente.csv).

Gera duas abas:
  - "Cliente": características do produto solicitado pelo cliente (etapa 4).
  - "Equalização": uma linha por fornecedor, nas colunas do modelo BID.
"""
import calendar
import re
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BASE_DIR = Path(__file__).parent
PROCESSADO_DIR = BASE_DIR / "processado"


def _nome_cliente_arquivo() -> str:
    """Primeira palavra da Razão Social (ex.: "DAFRA" de "DAFRA DA AMAZONIA
    ..."), usada para nomear a planilha de saída. Lida diretamente do CSV em
    vez de receber o cliente por parâmetro para que ARQUIVO_SAIDA continue
    utilizável como um atributo simples pelos demais módulos/telas."""
    caminho_cliente = PROCESSADO_DIR / "cliente.csv"
    if not caminho_cliente.exists():
        return "Cliente"
    try:
        razao_social = pd.read_csv(caminho_cliente).iloc[0].get("Razão Social")
    except Exception:
        return "Cliente"
    if not razao_social or pd.isna(razao_social):
        return "Cliente"
    primeira_palavra = re.sub(r"[^A-Za-z0-9]", "", str(razao_social).strip().split()[0])
    return primeira_palavra.upper() if primeira_palavra else "Cliente"


def caminho_planilha_saida() -> Path:
    """Nome do arquivo de saída inclui o cliente atual (extraído do e-mail de
    cotação em processado/cliente.csv) para não ficar preso ao nome do
    primeiro cliente processado neste projeto - antes era fixo em
    "..._Mirella.xlsx" mesmo depois de trocar de cliente (ex.: para DAFRA)."""
    return BASE_DIR / f"Equalizacao_LP_ACL_{_nome_cliente_arquivo()}.xlsx"

AZUL_ESCURO = "1F4E78"
AZUL_CLARO = "DCE6F1"
CINZA = "F2F2F2"
BRANCO_FONTE = Font(color="FFFFFF", bold=True)
BORDA_FINA = Border(*(Side(style="thin", color="BFBFBF"),) * 4)


def _estilizar_cabecalho(ws, linha, n_colunas):
    for col in range(1, n_colunas + 1):
        cel = ws.cell(row=linha, column=col)
        cel.font = BRANCO_FONTE
        cel.fill = PatternFill("solid", fgColor=AZUL_ESCURO)
        cel.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cel.border = BORDA_FINA


def _autofit(ws, larguras: dict):
    for col, largura in larguras.items():
        ws.column_dimensions[get_column_letter(col)].width = largura


def montar_aba_cliente(wb: Workbook, df_cliente: pd.Series):
    ws = wb.active
    ws.title = "Cliente"

    ws["A1"] = "CARACTERÍSTICAS DO PRODUTO SOLICITADO PELO CLIENTE"
    ws.merge_cells("A1:B1")
    ws["A1"].font = Font(bold=True, size=13, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor=AZUL_ESCURO)
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24

    campos = [
        ("Razão Social", df_cliente.get("Razão Social")),
        ("CNPJ", df_cliente.get("CNPJ")),
        ("Modalidade", df_cliente.get("Modalidade")),
        ("Tipo de Energia", df_cliente.get("Tipo de Energia")),
        ("Submercado", df_cliente.get("Submercado")),
        ("Período", df_cliente.get("Período")),
        ("Volume (MWm)", df_cliente.get("Volume (MWm)")),
        ("Flexibilidade", df_cliente.get("Flexibilidade")),
        ("Sazonalização", df_cliente.get("Sazo")),
        ("Modulação", df_cliente.get("Modulação")),
        ("Prazo de envio das propostas", df_cliente.get("Prazo de envio das propostas")),
        ("Validade das propostas", df_cliente.get("Validade das propostas")),
    ]

    linha = 2
    for rotulo, valor in campos:
        ws.cell(row=linha, column=1, value=rotulo).font = Font(bold=True)
        ws.cell(row=linha, column=1).fill = PatternFill("solid", fgColor=AZUL_CLARO)
        ws.cell(row=linha, column=2, value=valor)
        ws.cell(row=linha, column=1).border = BORDA_FINA
        ws.cell(row=linha, column=2).border = BORDA_FINA
        linha += 1

    _autofit(ws, {1: 32, 2: 45})
    ws.freeze_panes = "A2"
    return ws


COLUNAS_EQUALIZACAO = [
    "Fornecedor", "Tipo de Proposta", "Fonte", "Submercado", "Período", "Volume (MWm)",
    "Preço 2027 (R$/MWh)", "Preço 2028 (R$/MWh)", "Preço 2029 (R$/MWh)",
    "Flexibilidade", "Sazonalidade", "Modulação", "Garantia", "RETUSD (R$/MWh)",
    "Pagamento", "Data Base", "Data da Proposta", "Validade da Proposta",
]

TMA = 0.10
HORAS_POR_ANO = 8760
ANO_BASE = 2026  # Data base dos preços: 01/07/2026

# A aba "Equalização" começa na linha 2 / coluna B (linha 1 e coluna A ficam
# em branco como margem), conforme ajuste manual feito pelo usuário na
# planilha.
LINHA_CABECALHO = 2
COL_INICIAL = 2


def _anos_preco_disponiveis(row: pd.Series) -> list:
    """Detecta as colunas "Preço AAAA (R$/MWh)" presentes no row - o número de
    anos da cotação varia (esta rodada tem só 2027; a anterior tinha 2027 a
    2029), então não pode ser fixo."""
    anos = []
    for nome in row.index:
        m = re.match(r"Preço (\d{4}) \(R\$/MWh\)", nome)
        if m:
            anos.append(int(m.group(1)))
    return sorted(anos)


def horas_do_ano(ano: int) -> int:
    """Horas do ano, somando as horas de cada mês (24 h x dias do mês); 8.784 em ano bissexto."""
    return sum(24 * calendar.monthrange(ano, mes)[1] for mes in range(1, 13))


def calcular_preco_medio(precos_por_ano: dict, volume) -> float | None:
    """Preço Médio ponderado pela energia (MWh) de cada mês: para cada mês, MWh = horas do mês
    (24 x dias, com fevereiro de 29 dias em ano bissexto) x volume (MWm) e faturamento = preço x MWh;
    Preço Médio = soma dos faturamentos / soma dos MWh. Anos sem preço (None/NaN) ficam de fora."""
    volume = volume if volume and volume == volume else 1.0  # o volume se cancela; só pondera
    total_mwh = faturamento = 0.0
    for ano, preco in precos_por_ano.items():
        if preco is None or preco != preco:
            continue
        for mes in range(1, 13):
            mwh = 24 * calendar.monthrange(ano, mes)[1] * volume
            total_mwh += mwh
            faturamento += preco * mwh
    return faturamento / total_mwh if total_mwh else None


def _calcular_preco_medio_vpl(row: pd.Series):
    """Mesma fórmula usada nas fórmulas do Excel (etapa 3): serve aqui só
    para poder ORDENAR as propostas por VPL antes de escrevê-las na planilha."""
    anos = [a for a in _anos_preco_disponiveis(row) if not pd.isna(row.get(f"Preço {a} (R$/MWh)"))]
    if not anos or pd.isna(row.get("Volume (MWm)")):
        return None, None
    precos = [row[f"Preço {a} (R$/MWh)"] for a in anos]
    volume = row["Volume (MWm)"]
    media = calcular_preco_medio(dict(zip(anos, precos)), volume)
    vpl = sum(
        preco * volume * HORAS_POR_ANO / (1 + TMA) ** (ano - ANO_BASE)
        for ano, preco in zip(anos, precos)
    )
    return media, vpl


def ordenar_propostas_por_rank(df_propostas: pd.DataFrame) -> pd.DataFrame:
    """Ordena as propostas pela pontuação do Rank (ver criterio_rank.py). Propostas
    sem dados (ex.: PDF inválido) vão para o final, mantendo a ordem original entre si."""
    import criterio_rank  # import tardio: criterio_rank depende de analisar_propostas, que importa este módulo

    itens = []
    for _, row in df_propostas.iterrows():
        media, vpl = _calcular_preco_medio_vpl(row)
        itens.append({"media": media, "vpl": vpl, "flexibilidade": row.get("Flexibilidade"),
                      "sazonalidade": row.get("Sazonalidade"), "modulacao": row.get("Modulação")})
    ordem, _pontos = criterio_rank.ordenar(itens)
    return df_propostas.iloc[ordem].reset_index(drop=True)


def montar_aba_equalizacao(wb: Workbook, df_propostas: pd.DataFrame):
    ws = wb.create_sheet("Equalização")

    colunas = [c for c in COLUNAS_EQUALIZACAO if c in df_propostas.columns]
    for j, nome_col in enumerate(colunas, start=COL_INICIAL):
        ws.cell(row=LINHA_CABECALHO, column=j, value=nome_col)
    _estilizar_cabecalho(ws, LINHA_CABECALHO, len(colunas) + COL_INICIAL - 1)
    ws.row_dimensions[LINHA_CABECALHO].height = 34

    for i, (_, row) in enumerate(df_propostas.iterrows(), start=LINHA_CABECALHO + 1):
        for j, nome_col in enumerate(colunas, start=COL_INICIAL):
            valor = row[nome_col]
            if pd.isna(valor):
                valor = None
            cel = ws.cell(row=i, column=j, value=valor)
            cel.border = BORDA_FINA
            cel.alignment = Alignment(vertical="center", wrap_text=True)
            if "Preço" in nome_col or "RETUSD" in nome_col:
                cel.number_format = '#,##0.00'
            if i % 2 == 0:
                cel.fill = PatternFill("solid", fgColor=CINZA)

    larguras = {2: 18, 3: 26, 4: 22, 5: 16, 6: 24, 7: 13, 8: 15, 9: 15, 10: 15,
                11: 20, 12: 24, 13: 12, 14: 26, 15: 15, 16: 30, 17: 13, 18: 18, 19: 22}
    _autofit(ws, larguras)
    ws.freeze_panes = "C3"
    return ws


def main():
    df_propostas = pd.read_csv(PROCESSADO_DIR / "propostas.csv")
    df_cliente = pd.read_csv(PROCESSADO_DIR / "cliente.csv").iloc[0]
    df_propostas = ordenar_propostas_por_rank(df_propostas)

    wb = Workbook()
    montar_aba_cliente(wb, df_cliente)
    montar_aba_equalizacao(wb, df_propostas)

    arquivo_saida = caminho_planilha_saida()
    wb.save(arquivo_saida)
    print(f"Planilha criada em: {arquivo_saida}")
    print("Ordem das propostas (pelo critério do rank):", ", ".join(df_propostas["Fornecedor"]))


if __name__ == "__main__":
    main()
