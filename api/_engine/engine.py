"""
Camada fina sobre o pipeline (extrair_dados_pdfs -> criar_planilha_equalizacao ->
calcular_equalizacao -> analisar_propostas) para rodar em funções serverless.

O pipeline original lê/grava pastas relativas ao próprio código (Cotacao/,
processado/, Equalizacao_LP_ACL_*.xlsx). No Vercel o código é somente leitura e
só /tmp é gravável, então aqui cada chamada trabalha num diretório temporário e
redireciona as constantes de caminho dos módulos para ele - sem alterar a lógica
de extração, VPL e aderência.

Fluxo (stateless, uma chamada HTTP por etapa):
  extrair_fornecedor(nome, urls)  -> dict de uma proposta (1 chamada por fornecedor)
  extrair_cliente(url)            -> dict do e-mail do cliente
  consolidar(propostas, cliente, params) -> ranking + planilha .xlsx (base64)
"""
import base64
import json
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd  # noqa: E402

import analisar_propostas  # noqa: E402
import calcular_equalizacao  # noqa: E402
import criar_planilha_equalizacao  # noqa: E402
import extrair_dados_pdfs  # noqa: E402
import extrair_llm  # noqa: E402

LIMITE_DOWNLOAD_BYTES = 40 * 1024 * 1024


# ----------------------------------------------------------------------------
# Utilitários
# ----------------------------------------------------------------------------
def _nome_seguro(nome: str) -> str:
    return re.sub(r"[^\w.\- ]", "_", nome, flags=re.UNICODE).strip() or "arquivo"


def _baixar(url: str, destino: Path) -> Path:
    if not url.startswith("https://"):
        raise ValueError("URL de PDF inválida (esperado https).")
    req = urllib.request.Request(url, headers={"User-Agent": "equalizacao-lp-acl"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dados = resp.read(LIMITE_DOWNLOAD_BYTES + 1)
    if len(dados) > LIMITE_DOWNLOAD_BYTES:
        raise ValueError("PDF maior que o limite permitido.")
    destino.write_bytes(dados)
    return destino


def _json_seguro(obj):
    """DataFrame/dict -> estrutura JSON pura (NaN vira null, numpy vira nativo)."""
    if isinstance(obj, pd.DataFrame):
        return json.loads(obj.to_json(orient="records", force_ascii=False))
    if isinstance(obj, dict):
        return {str(k): _json_seguro(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_seguro(v) for v in obj]
    if isinstance(obj, float) and obj != obj:
        return None
    if hasattr(obj, "item"):  # escalares numpy
        return _json_seguro(obj.item())
    return obj


def _normalizar_proposta(dados: dict) -> dict:
    """Chaves de "Preços por ano" viram str no JSON; o pipeline usa int."""
    dados = dict(dados)
    dados["Preços por ano"] = {int(a): p for a, p in (dados.get("Preços por ano") or {}).items()}
    return dados


# ----------------------------------------------------------------------------
# Extração (uma chamada por fornecedor / cliente)
# ----------------------------------------------------------------------------
def _preparar_llm(tmp: Path):
    extrair_llm.CACHE_DIR = tmp / "cache_llm"
    extrair_llm.EVENTOS.clear()


def extrair_fornecedor(nome: str, urls: list) -> dict:
    nome = _nome_seguro(nome)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        _preparar_llm(tmp)
        pasta = tmp / "Cotacao" / nome
        pasta.mkdir(parents=True)
        pdfs = []
        for i, url in enumerate(urls):
            nome_arq = _nome_seguro(Path(url.split("?")[0]).name) or f"arquivo{i}.pdf"
            if not nome_arq.lower().endswith(".pdf"):
                nome_arq += ".pdf"
            pdfs.append(_baixar(url, pasta / nome_arq))

        dados = extrair_llm.extrair_proposta_llm(sorted(pdfs), nome)
        origem = "LLM"
        if dados is None:
            origem = "Regex"
            entrada = extrair_dados_pdfs.PARSERS.get(nome)
            if entrada is not None:
                texto, caminho = extrair_dados_pdfs._extrair_texto_pasta(pasta)
                if caminho is not None and (texto.strip() or nome in extrair_dados_pdfs.PASTAS_SEM_TEXTO_EXTRAIVEL):
                    dados = extrair_dados_pdfs._resolver_parser(entrada, caminho.name)(texto)

        if dados is None:
            origem = "Sem dados"
            dados = {
                "Fornecedor": nome.upper(), "Tipo de Proposta": "SEM DADOS",
                "Fonte": None, "Submercado": None, "Período": None, "Volume (MWm)": None,
                "Preços por ano": {}, "Flexibilidade": None, "Sazonalidade": None,
                "Modulação": None, "Garantia": None, "RETUSD (R$/MWh)": None, "Pagamento": None,
                "Data Base": None, "Data da Proposta": None,
                "Validade da Proposta": "Extração indisponível (LLM e regex falharam) - sem dados para equalizar",
            }
        return {"pasta": nome, "origem": origem, "eventos": list(extrair_llm.EVENTOS), "dados": _json_seguro(dados)}


def extrair_cliente(url: str) -> dict:
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        _preparar_llm(tmp)
        caminho = _baixar(url, tmp / "email_cliente.pdf")
        dados = extrair_dados_pdfs.extrair_dados_cliente(caminho)
        return {"eventos": list(extrair_llm.EVENTOS), "dados": _json_seguro(dados), "params": parametros_do_cliente(dados)}


# ----------------------------------------------------------------------------
# Parâmetros de aderência (derivados do e-mail do cliente; antes na sidebar do Streamlit)
# ----------------------------------------------------------------------------
SUBMERCADOS = {
    "Nordeste (NE)": (r"nordeste|\bNE\b", "Nordeste"),
    "Sudeste/Centro-Oeste (SE/CO)": (r"sudeste|centro-oeste|\bSE/?CO\b", "Sudeste/Centro-Oeste"),
    "Sul (S)": (r"\bsul\b|\bS\b", "Sul"),
    "Norte (N)": (r"\bnorte\b|\bN\b", "Norte"),
}


def _percentual_do_cliente(texto, default: int) -> int:
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*%", str(texto or ""))
    return int(float(m.group(1).replace(",", "."))) if m else default


def _submercado_do_cliente(texto):
    for opcao, (regex, _label) in SUBMERCADOS.items():
        if re.search(regex, str(texto or ""), re.IGNORECASE):
            return opcao
    return list(SUBMERCADOS)[0]


def _periodo_do_cliente(texto):
    texto = str(texto or "")
    anos = [int(a) for a in re.findall(r"\b20\d{2}\b", texto)]
    anos += [2000 + int(a) for a in re.findall(r"/(\d{2})(?!\d|/)", texto)]
    return (min(anos), max(anos)) if anos else (None, None)


def _modulacao_do_cliente(texto):
    texto_norm = str(texto or "").lower()
    if "carga" in texto_norm or re.search(r"\blivre\b", texto_norm):
        return "Carga"
    return "Flat"


def _flexibilidade_do_cliente(texto):
    pares = re.findall(r"([+\-])\s*(\d+(?:[.,]\d+)?)", str(texto or ""))
    if not pares:
        return None, None
    positivos = [float(v.replace(",", ".")) for s, v in pares if s == "+"]
    negativos = [float(v.replace(",", ".")) for s, v in pares if s == "-"]
    superior = max(positivos) if positivos else None
    inferior = max(negativos) if negativos else None
    if superior is None:
        superior = inferior
    if inferior is None:
        inferior = superior
    return inferior, superior


def parametros_padrao() -> dict:
    return {
        "tma_pct": 10.0, "horas_por_ano": 8760, "ano_base": 2026,
        "fonte_percentual": 50, "submercado": list(SUBMERCADOS)[0],
        "ano_inicio": 2027, "ano_fim": 2029, "modulacao": "Flat",
        "flex_superior": 30.0, "flex_inferior": 30.0,
        "sazonalizacao": "Flat", "sazo_superior": 0.0, "sazo_inferior": 0.0,
    }


def parametros_do_cliente(cliente: dict) -> dict:
    p = parametros_padrao()
    p["fonte_percentual"] = _percentual_do_cliente(cliente.get("Tipo de Energia"), p["fonte_percentual"])
    p["submercado"] = _submercado_do_cliente(cliente.get("Submercado"))
    ini, fim = _periodo_do_cliente(cliente.get("Período"))
    p["ano_inicio"], p["ano_fim"] = ini or p["ano_inicio"], fim or p["ano_fim"]
    p["modulacao"] = _modulacao_do_cliente(cliente.get("Modulação"))
    inf, sup = _flexibilidade_do_cliente(cliente.get("Flexibilidade"))
    if sup is not None:
        p["flex_superior"] = sup
    if inf is not None:
        p["flex_inferior"] = inf
    return p


def _aplicar_parametros(p: dict):
    for modulo in (criar_planilha_equalizacao, calcular_equalizacao, analisar_propostas):
        modulo.TMA = float(p["tma_pct"]) / 100
        modulo.HORAS_POR_ANO = int(p["horas_por_ano"])
        modulo.ANO_BASE = int(p["ano_base"])
    regex, label = SUBMERCADOS.get(p["submercado"], list(SUBMERCADOS.values())[0])
    analisar_propostas.FONTE_PERCENTUAL = int(p["fonte_percentual"])
    analisar_propostas.SUBMERCADO_REGEX = regex
    analisar_propostas.SUBMERCADO_LABEL = label
    analisar_propostas.ANO_INICIO = int(p["ano_inicio"])
    analisar_propostas.ANO_FIM = int(p["ano_fim"])
    analisar_propostas.MODULACAO_DESEJADA = p["modulacao"]
    analisar_propostas.FLEXIBILIDADE_SUPERIOR_MINIMA = float(p["flex_superior"])
    analisar_propostas.FLEXIBILIDADE_INFERIOR_MINIMA = float(p["flex_inferior"])
    flat = p["sazonalizacao"] == "Flat"
    analisar_propostas.SAZONALIZACAO_SUPERIOR_MINIMA = 0.0 if flat else float(p["sazo_superior"])
    analisar_propostas.SAZONALIZACAO_INFERIOR_MINIMA = 0.0 if flat else float(p["sazo_inferior"])


# ----------------------------------------------------------------------------
# Consolidação: monta o DataFrame, roda as etapas 2-5 e devolve ranking + xlsx
# ----------------------------------------------------------------------------
def _montar_dataframe(linhas: list) -> pd.DataFrame:
    """Mesma montagem de extrair_dados_pdfs.montar_dataframe_propostas (colunas por ano)."""
    linhas = [_normalizar_proposta(l) for l in linhas]
    anos = sorted({a for l in linhas for a in l["Preços por ano"]})
    for linha in linhas:
        precos = linha.pop("Preços por ano")
        for ano in anos:
            linha[f"Preço {ano} (R$/MWh)"] = precos.get(ano)
    colunas = (
        ["Fornecedor", "Tipo de Proposta", "Fonte", "Submercado", "Período", "Volume (MWm)"]
        + [f"Preço {a} (R$/MWh)" for a in anos]
        + ["Flexibilidade", "Sazonalidade", "Modulação", "Garantia", "RETUSD (R$/MWh)",
           "Pagamento", "Data Base", "Data da Proposta", "Validade da Proposta"]
    )
    df = pd.DataFrame(linhas)
    for c in colunas:
        if c not in df.columns:
            df[c] = None
    return df[colunas]


def montar_ranking(df_propostas: pd.DataFrame, cliente: pd.Series) -> pd.DataFrame:
    linhas = []
    for _, row in df_propostas.iterrows():
        if pd.isna(row.get("Volume (MWm)")):
            status, obs = "Sem dados", "Arquivo de proposta corrompido/vazio - fornecedor não pôde ser avaliado"
            media = vpl = None
        else:
            status, obs = analisar_propostas.avaliar_aderencia(row, cliente)
            media, vpl = criar_planilha_equalizacao._calcular_preco_medio_vpl(row)
        linhas.append({
            "Fornecedor": row["Fornecedor"],
            "Flex": analisar_propostas._txt(row.get("Flexibilidade")) or "—",
            "Tipo de Proposta": row["Tipo de Proposta"],
            "Preço Médio (R$/MWh)": media,
            "VPL (R$)": vpl,
            "Aderente ao Produto": status,
            "Observações": obs,
        })
    df = pd.DataFrame(linhas)
    df["_sem_dados"] = df["VPL (R$)"].isna()
    df = df.sort_values(by=["_sem_dados", "VPL (R$)", "Preço Médio (R$/MWh)"], kind="stable").reset_index(drop=True)
    rank, contador = [], 0
    for sem in df["_sem_dados"]:
        if sem:
            rank.append("-")
        else:
            contador += 1
            rank.append(contador)
    df["Rank"] = rank
    df = df.drop(columns=["_sem_dados"])
    return df[["Rank", "Fornecedor", "Flex", "Tipo de Proposta", "Preço Médio (R$/MWh)", "VPL (R$)",
               "Aderente ao Produto", "Observações"]]


def consolidar(propostas: list, cliente: dict, params: dict | None = None) -> dict:
    if not propostas:
        raise ValueError("Nenhuma proposta recebida.")
    p = {**parametros_do_cliente(cliente), **(params or {})}
    _aplicar_parametros(p)

    df_propostas = _montar_dataframe(propostas)
    df_cliente = pd.DataFrame([cliente])

    # Proposta indicativa sem volume é cotada para o volume do e-mail do cliente.
    sem_volume = df_propostas["Volume (MWm)"].isna() & (df_propostas["Tipo de Proposta"] != "SEM DADOS")
    df_propostas["Volume informado na proposta"] = ~sem_volume
    df_propostas.loc[sem_volume, "Volume (MWm)"] = df_cliente.loc[0, "Volume (MWm)"]

    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        saida = tmp / "processado"
        saida.mkdir()
        criar_planilha_equalizacao.BASE_DIR = tmp
        criar_planilha_equalizacao.PROCESSADO_DIR = saida
        df_propostas.to_csv(saida / "propostas.csv", index=False, encoding="utf-8-sig")
        df_cliente.to_csv(saida / "cliente.csv", index=False, encoding="utf-8-sig")

        criar_planilha_equalizacao.main()
        calcular_equalizacao.main()
        analisar_propostas.main()

        arquivo = criar_planilha_equalizacao.caminho_planilha_saida()
        xlsx_b64 = base64.b64encode(arquivo.read_bytes()).decode("ascii")
        nome_arquivo = arquivo.name

    # Relê do CSV para o mesmo tipo de dados que o Streamlit usava (NaN em vez de None).
    df_prop_csv = pd.read_csv(__import__("io").StringIO(df_propostas.to_csv(index=False)))
    df_ranking = montar_ranking(df_prop_csv, pd.Series(cliente))
    return {
        "ranking": _json_seguro(df_ranking),
        "propostas": _json_seguro(df_prop_csv),
        "cliente": _json_seguro(cliente),
        "params": p,
        "xlsx": {"nome": nome_arquivo, "base64": xlsx_b64},
    }
