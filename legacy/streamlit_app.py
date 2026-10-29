"""
Interface visual (Streamlit) para a Equalização de Propostas - Mercado Livre de Energia.

Reaproveita o mesmo pipeline de App.py (extrair_dados_pdfs -> criar_planilha_equalizacao
-> calcular_equalizacao -> analisar_propostas): o botão "Processar Equalização" roda essas
4 etapas e regrava processado/*.csv e Equalizacao_LP_ACL_<CLIENTE>.xlsx (nome derivado
da Razão Social do cliente); a página então lê esses arquivos para montar o resumo e o
ranking em tela.

Rode com:
    .venv\\Scripts\\streamlit run streamlit_app.py
"""
import contextlib
import io
import re
import time
from pathlib import Path

import pandas as pd
import streamlit as st

import analisar_propostas
import calcular_equalizacao
import criar_planilha_equalizacao
import estilo
import extrair_dados_pdfs
import extrair_llm
import gerar_relatorio
from estilo import (
    _fmt_moeda,
    chip_html,
    grafico_curva_preco,
    grid_campos_html,
    metric_card_html,
    produto_card_html,
    ranking_table_html,
)

BASE_DIR = Path(__file__).parent
COTACAO_DIR = BASE_DIR / "Cotacao"
PROCESSADO_DIR = BASE_DIR / "processado"
CAMINHO_PROPOSTAS = PROCESSADO_DIR / "propostas.csv"
CAMINHO_CLIENTE = PROCESSADO_DIR / "cliente.csv"

st.set_page_config(
    page_title="Equalização de Propostas - Mercado Livre de Energia",
    page_icon="⚡",
    layout="wide",
)

# ----------------------------------------------------------------------------
# Identidade visual (compartilhada com gerar_relatorio.py via estilo.py, para
# que o relatório .docx exportado saia idêntico ao que aparece em tela)
# ----------------------------------------------------------------------------
st.markdown(f"<style>{estilo.CSS_IDENTIDADE}</style>", unsafe_allow_html=True)


def cabecalho(cliente: pd.Series = None):
    razao_social = cliente.get("Razão Social") if cliente is not None else None
    subtitulo = f"Cliente: {razao_social}" if razao_social and not pd.isna(razao_social) else "Aguardando processamento..."
    st.markdown(
        f"""
        <div class="app-header">
          <div class="app-header-icon">⚡</div>
          <div>
            <div class="app-header-title">Equalização de Propostas — Mercado Livre de Energia</div>
            <div class="app-header-subtitle">{subtitulo}</div>
          </div>
        </div>
        <div class="app-header-underline"></div>
        """,
        unsafe_allow_html=True,
    )


def section_header(texto: str):
    st.markdown(f'<div class="section-header">{texto}</div>', unsafe_allow_html=True)


def metric_card(icone: str, valor: str, rotulo: str):
    st.markdown(metric_card_html(icone, valor, rotulo), unsafe_allow_html=True)


def listar_pdfs_por_fornecedor():
    """Agrupa os PDFs de propostas por fornecedor (uma pasta = um fornecedor).
    A pasta Caracteristicas_Produto guarda o e-mail de solicitação de cotação
    do cliente, não entra aqui - não é uma proposta de fornecedor, e sim o que
    preenche a seção "CARACTERÍSTICAS DO PRODUTO" (ver render_dados_cliente,
    que lê os dados já extraídos dela em processado/cliente.csv)."""
    fornecedores = {}
    for pasta in sorted(p for p in COTACAO_DIR.iterdir() if p.is_dir()):
        if pasta == extrair_dados_pdfs.CARACTERISTICAS_DIR:
            continue
        arquivos = sorted(pasta.glob("*.pdf"))
        if arquivos:
            fornecedores[pasta.name] = [(p.name, p.stat().st_size / 1024) for p in arquivos]
    return fornecedores


def render_chip(placeholder, fornecedor: str, arquivos, estado: str = "pendente"):
    placeholder.markdown(chip_html(fornecedor, arquivos, estado), unsafe_allow_html=True)


@st.cache_data(show_spinner="Lendo as características do produto no e-mail do cliente...")
def _extrair_cliente(caminho: str, mtime: float, tamanho: int) -> pd.Series:
    # mtime/tamanho só entram na chave do cache: trocar o PDF invalida.
    return pd.Series(extrair_dados_pdfs.extrair_dados_cliente(Path(caminho)))


def carregar_cliente():
    """Lido do e-mail que está AGORA em Cotacao/Caracteristicas_Produto, e não
    de processado/cliente.csv - o CSV é da última rodada processada e mostraria
    o cliente da cotação anterior (inclusive nos critérios de aderência da
    sidebar) até o próximo clique em Processar. Só chama a API quando o PDF é
    novo; depois disso vem do cache em disco do extrair_llm."""
    try:
        caminho = extrair_dados_pdfs.localizar_email_cliente()
    except FileNotFoundError:
        return None
    info = caminho.stat()
    return _extrair_cliente(str(caminho), info.st_mtime, info.st_size)


def _grid_cliente(campos):
    st.markdown(grid_campos_html(campos), unsafe_allow_html=True)


def render_dados_cliente(cliente):
    section_header("DADOS DO CLIENTE")
    if cliente is None:
        st.caption(
            "Nenhum e-mail de cotação encontrado em Cotacao/Caracteristicas_Produto "
            "(arquivo PDF começando com \"E-mail\")."
        )
        return
    _grid_cliente(
        [
            ("Razão Social", cliente.get("Razão Social")),
            ("CNPJ", cliente.get("CNPJ")),
        ]
    )

    section_header("CARACTERÍSTICAS DO PRODUTO")
    _grid_cliente(
        [
            ("Modalidade", cliente.get("Modalidade")),
            ("Tipo de Energia", cliente.get("Tipo de Energia")),
            ("Submercado", cliente.get("Submercado")),
            ("Período", cliente.get("Período")),
            ("Volume (MWm)", cliente.get("Volume (MWm)")),
            ("Flexibilidade", cliente.get("Flexibilidade")),
            ("Sazo", cliente.get("Sazo")),
            ("Modulação", cliente.get("Modulação")),
        ]
    )


def montar_ranking(df_propostas: pd.DataFrame, cliente: pd.Series) -> pd.DataFrame:
    linhas = []
    for _, row in df_propostas.iterrows():
        if pd.isna(row.get("Volume (MWm)")):
            status = "Sem dados"
            obs = "Arquivo de proposta corrompido/vazio - fornecedor não pôde ser avaliado"
            media = vpl = None
        else:
            status, obs = analisar_propostas.avaliar_aderencia(row, cliente)
            media, vpl = criar_planilha_equalizacao._calcular_preco_medio_vpl(row)
        linhas.append(
            {
                "Fornecedor": row["Fornecedor"],
                "Flex": analisar_propostas._txt(row.get("Flexibilidade")) or "—",
                "Tipo de Proposta": row["Tipo de Proposta"],
                "Preço Médio (R$/MWh)": media,
                "VPL (R$)": vpl,
                "Aderente ao Produto": status,
                "Observações": obs,
            }
        )
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
    return df[["Rank", "Fornecedor", "Flex", "Tipo de Proposta", "Preço Médio (R$/MWh)", "VPL (R$)", "Aderente ao Produto", "Observações"]]


def anos_disponiveis(df: pd.DataFrame) -> list:
    anos = []
    for coluna in df.columns:
        m = re.match(r"Preço (\d{4}) \(R\$/MWh\)", coluna)
        if m:
            anos.append(int(m.group(1)))
    return sorted(anos)


def render_produto_card(row: pd.Series):
    campos = [
        ("Fonte", row.get("Fonte")),
        ("Submercado", row.get("Submercado")),
        ("Período", row.get("Período")),
        ("Volume (MWm)", row.get("Volume (MWm)")),
        ("Flexibilidade", row.get("Flexibilidade")),
        ("Sazonalidade", row.get("Sazonalidade")),
        ("Modulação", row.get("Modulação")),
        ("Garantia", row.get("Garantia")),
        ("RETUSD (R$/MWh)", row.get("RETUSD (R$/MWh)")),
        ("Pagamento", row.get("Pagamento")),
        ("Data Base", row.get("Data Base")),
        ("Validade da Proposta", row.get("Validade da Proposta")),
    ]
    st.markdown(produto_card_html("Características da Proposta Vencedora", campos), unsafe_allow_html=True)


def render_ranking_table(df: pd.DataFrame):
    st.markdown(ranking_table_html(df), unsafe_allow_html=True)


# ----------------------------------------------------------------------------
# Sidebar - Parâmetros
# ----------------------------------------------------------------------------
SUBMERCADOS = {
    "Nordeste (NE)": (r"nordeste|\bNE\b", "Nordeste"),
    "Sudeste/Centro-Oeste (SE/CO)": (r"sudeste|centro-oeste|\bSE/?CO\b", "Sudeste/Centro-Oeste"),
    "Sul (S)": (r"\bsul\b|\bS\b", "Sul"),
    "Norte (N)": (r"\bnorte\b|\bN\b", "Norte"),
}


def _percentual_do_cliente(texto, default: int) -> int:
    """Extrai o "50" de algo como "Incentivada 50%" (campo Tipo de Energia)."""
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*%", str(texto or ""))
    return int(float(m.group(1).replace(",", "."))) if m else default


def _submercado_do_cliente(texto):
    """Casa o Submercado do cliente (ex.: "Norte") contra as opções da sidebar
    usando os mesmos regexes aplicados depois na aderência."""
    for opcao, (regex, _label) in SUBMERCADOS.items():
        if re.search(regex, str(texto or ""), re.IGNORECASE):
            return opcao
    return None


def _periodo_do_cliente(texto):
    """Extrai o primeiro e o último ano do período do cliente. Cobre tanto
    anos completos ("01/01/2027 a 31/12/2027") quanto ano abreviado depois de
    "/" ("Jan/27 a dez/2029") - nesse caso "27" só conta como ano se NÃO for
    seguido de outro "/dígitos" (o que indicaria ser dia/mês de uma data
    completa, não um ano abreviado)."""
    texto = str(texto or "")
    anos = [int(a) for a in re.findall(r"\b20\d{2}\b", texto)]
    anos += [2000 + int(a) for a in re.findall(r"/(\d{2})(?!\d|/)", texto)]
    return (min(anos), max(anos)) if anos else (None, None)


def _modulacao_do_cliente(texto):
    """As opções da sidebar são só "Flat"/"Carga"; o texto do cliente pode vir
    mais descritivo (ex.: "Preferencial Carga") - casamos por substring."""
    texto_norm = str(texto or "").lower()
    if "carga" in texto_norm or re.search(r"\blivre\b", texto_norm):
        return "Carga"
    if "flat" in texto_norm:
        return "Flat"
    return None


def _flexibilidade_do_cliente(texto):
    """Extrai os limites +superior/-inferior de algo como "+30/-100%" (campo
    Flexibilidade do e-mail do cliente). Diferente do formato usado nas
    propostas dos fornecedores (ex.: "-100% / +100%", com "%" repetido em
    cada número), aqui o "%" costuma aparecer só uma vez, no final, valendo
    para os dois números - por isso não reaproveitamos
    analisar_propostas._parse_intervalo_percentual (que exige "%" logo após
    cada número) e usamos uma extração mais tolerante aqui."""
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


cliente_atual = carregar_cliente()


@st.dialog("Limpar cache de extração (LLM)")
def _dialog_limpar_cache():
    st.write(
        "Isso apaga os resultados já extraídos salvos em cache. O e-mail do cliente é "
        "relido logo em seguida e, na próxima vez que você clicar em **Processar "
        "Equalização**, todos os fornecedores passam por uma chamada nova à API - "
        "gerando custo de novo."
    )
    col_cancelar, col_confirmar = st.columns(2)
    if col_cancelar.button("Cancelar", width="stretch"):
        st.rerun()
    if col_confirmar.button("Limpar cache", type="primary", width="stretch"):
        arquivos_cache = list(extrair_llm.CACHE_DIR.glob("*.json"))
        for arquivo in arquivos_cache:
            arquivo.unlink()
        _extrair_cliente.clear()
        st.session_state["cache_limpo_msg"] = (
            f"Cache limpo ({len(arquivos_cache)} arquivo(s) removido(s)). "
            "A próxima extração vai chamar a API de novo para todos os fornecedores."
        )
        st.rerun()


st.sidebar.markdown("### ⚙️ Parâmetros")

if st.sidebar.button("🗑️ Limpar cache de extração (LLM)", width="stretch"):
    _dialog_limpar_cache()

if "cache_limpo_msg" in st.session_state:
    st.sidebar.success(st.session_state.pop("cache_limpo_msg"))

st.sidebar.caption(
    "Valores padrão herdados do modelo de referência — ajuste conforme a instalação e o contrato."
)

tma_pct = st.sidebar.number_input("TMA — Taxa Mínima de Atratividade (% a.a.)", value=10.0, step=0.5, min_value=0.0)
horas_por_ano = st.sidebar.number_input("Horas por ano (MWm → MWh)", value=8760, step=1)
ano_base = st.sidebar.number_input("Ano base (Data Base)", value=2026, step=1)

st.sidebar.markdown("---")
st.sidebar.markdown("**Critérios de Aderência**")
st.sidebar.caption(
    "Pré-preenchidos a partir de CARACTERÍSTICAS DO PRODUTO (dados do cliente) "
    "quando disponíveis — ajuste se necessário."
)

fonte_percentual_default = _percentual_do_cliente(
    cliente_atual.get("Tipo de Energia") if cliente_atual is not None else None, default=50
)
fonte_percentual = st.sidebar.number_input(
    "Fonte incentivada exigida (%)", value=fonte_percentual_default, min_value=0, max_value=100, step=5
)

opcoes_submercado = list(SUBMERCADOS.keys())
submercado_default = _submercado_do_cliente(cliente_atual.get("Submercado") if cliente_atual is not None else None)
index_submercado = opcoes_submercado.index(submercado_default) if submercado_default in opcoes_submercado else 0
submercado_opcao = st.sidebar.selectbox("Submercado desejado", opcoes_submercado, index=index_submercado)

ano_ini_default, ano_fim_default = _periodo_do_cliente(
    cliente_atual.get("Período") if cliente_atual is not None else None
)
col_ano_ini, col_ano_fim = st.sidebar.columns(2)
ano_inicio_criterio = col_ano_ini.number_input("Período - início", value=ano_ini_default or 2027, step=1)
ano_fim_criterio = col_ano_fim.number_input("Período - fim", value=ano_fim_default or 2029, step=1)

opcoes_modulacao = ["Flat", "Carga"]
modulacao_default = _modulacao_do_cliente(cliente_atual.get("Modulação") if cliente_atual is not None else None)
index_modulacao = opcoes_modulacao.index(modulacao_default) if modulacao_default in opcoes_modulacao else 0
modulacao_desejada = st.sidebar.selectbox("Modulação desejada", opcoes_modulacao, index=index_modulacao)

flex_inf_default, flex_sup_default = _flexibilidade_do_cliente(
    cliente_atual.get("Flexibilidade") if cliente_atual is not None else None
)
col_flex_sup, col_flex_inf = st.sidebar.columns(2)
flexibilidade_superior = col_flex_sup.number_input(
    "Flexibilidade Superior + (%)", value=flex_sup_default if flex_sup_default is not None else 30.0, step=5.0
)
flexibilidade_inferior = col_flex_inf.number_input(
    "Flexibilidade Inferior - (%)", value=flex_inf_default if flex_inf_default is not None else 30.0, step=5.0
)

sazonalizacao_opcao = st.sidebar.selectbox("Sazonalização", ["Flat", "Personalizada"], index=0)
sazonalizacao_flat = sazonalizacao_opcao == "Flat"

col_sazo_sup, col_sazo_inf = st.sidebar.columns(2)
if sazonalizacao_flat:
    col_sazo_sup.number_input("Sazonalização Superior + (%)", value=0.0, disabled=True, key="sazo_sup_flat")
    col_sazo_inf.number_input("Sazonalização Inferior - (%)", value=0.0, disabled=True, key="sazo_inf_flat")
    sazonalizacao_superior = 0.0
    sazonalizacao_inferior = 0.0
else:
    sazonalizacao_superior = col_sazo_sup.number_input(
        "Sazonalização Superior + (%)", value=0.0, step=5.0, key="sazo_sup_personalizada"
    )
    sazonalizacao_inferior = col_sazo_inf.number_input(
        "Sazonalização Inferior - (%)", value=0.0, step=5.0, key="sazo_inf_personalizada"
    )

# Os mesmos parâmetros usados na pré-visualização abaixo são aplicados ao
# pipeline de exportação (Excel), garantindo consistência entre tela e planilha.
tma = tma_pct / 100
submercado_regex, submercado_label = SUBMERCADOS[submercado_opcao]
for modulo in (criar_planilha_equalizacao, calcular_equalizacao, analisar_propostas):
    modulo.TMA = tma
    modulo.HORAS_POR_ANO = int(horas_por_ano)
    modulo.ANO_BASE = int(ano_base)
analisar_propostas.FONTE_PERCENTUAL = int(fonte_percentual)
analisar_propostas.SUBMERCADO_REGEX = submercado_regex
analisar_propostas.SUBMERCADO_LABEL = submercado_label
analisar_propostas.ANO_INICIO = int(ano_inicio_criterio)
analisar_propostas.ANO_FIM = int(ano_fim_criterio)
analisar_propostas.MODULACAO_DESEJADA = modulacao_desejada
analisar_propostas.FLEXIBILIDADE_SUPERIOR_MINIMA = flexibilidade_superior
analisar_propostas.FLEXIBILIDADE_INFERIOR_MINIMA = flexibilidade_inferior
analisar_propostas.SAZONALIZACAO_SUPERIOR_MINIMA = sazonalizacao_superior
analisar_propostas.SAZONALIZACAO_INFERIOR_MINIMA = sazonalizacao_inferior

# ----------------------------------------------------------------------------
# Cabeçalho
# ----------------------------------------------------------------------------
cabecalho(cliente_atual)

# ----------------------------------------------------------------------------
# Dados do cliente
# ----------------------------------------------------------------------------
render_dados_cliente(cliente_atual)

# ----------------------------------------------------------------------------
# Fonte de dados
# ----------------------------------------------------------------------------
section_header("FONTE DE DADOS — PROPOSTAS (PDFs)")

fornecedores_pdfs = listar_pdfs_por_fornecedor()
total_arquivos = sum(len(v) for v in fornecedores_pdfs.values())

NCOLS = 3
colunas_grid = st.columns(NCOLS)
placeholders = {}
for i, fornecedor in enumerate(fornecedores_pdfs):
    with colunas_grid[i % NCOLS]:
        placeholders[fornecedor] = st.empty()

# Estado inicial: sempre pendente - só é possível avançar de estado processando.
for fornecedor, arquivos in fornecedores_pdfs.items():
    render_chip(placeholders[fornecedor], fornecedor, arquivos, estado="pendente")

st.caption(f"{len(fornecedores_pdfs)} fornecedor(es) · {total_arquivos} arquivo(s) encontrados na pasta Cotacao/.")

progresso_placeholder = st.empty()
barra_progresso_pdfs = st.progress(0)

st.write("")
if st.button("▶ Processar Equalização", type="primary"):
    contador = {"i": 0}

    def marcar_processado(pasta: str):
        # extrair_dados_pdfs.main() chama on_vendor para toda pasta de
        # fornecedor encontrada em Cotacao/, mesmo as que não têm PDF (ex.:
        # uma pasta vazia deixada de uma cotação anterior); essas não têm chip
        # nem entram no denominador do progresso, então são ignoradas aqui -
        # senão o contador ultrapassa len(fornecedores_pdfs) e a barra de
        # progresso estoura 100%.
        if pasta not in placeholders:
            return
        contador["i"] += 1
        percentual = int(contador["i"] / len(fornecedores_pdfs) * 100)
        progresso_placeholder.markdown(
            f"🔄 Analisando proposta **{contador['i']}/{len(fornecedores_pdfs)}** — **{pasta}**..."
        )
        barra_progresso_pdfs.progress(percentual, text=f"{percentual}% — {pasta}")
        render_chip(placeholders[pasta], pasta, fornecedores_pdfs[pasta], estado="processando")
        time.sleep(0.45)
        render_chip(placeholders[pasta], pasta, fornecedores_pdfs[pasta], estado="concluido")
        time.sleep(0.2)

    # A saída de texto da extração só serve ao uso por terminal (App.py) -
    # aqui as tabelas vêm direto de extrair_llm.EVENTOS e do retorno de
    # main(); do texto capturado só se aproveitam os avisos.
    log_extracao = io.StringIO()
    log_etapas = io.StringIO()
    df_propostas_log = df_cliente_log = None
    erro = None
    extrair_llm.EVENTOS.clear()
    try:
        with contextlib.redirect_stdout(log_extracao):
            df_propostas_log, df_cliente_log = extrair_dados_pdfs.main(on_vendor=marcar_processado)
        barra_progresso_pdfs.progress(100, text="100% — Extração concluída")
        progresso_placeholder.markdown("✅ Extração concluída para todos os fornecedores.")
        with st.spinner("Consolidando planilha e calculando equalização..."):
            with contextlib.redirect_stdout(log_etapas):
                criar_planilha_equalizacao.main()
                calcular_equalizacao.main()
                analisar_propostas.main()
    except PermissionError:
        erro = (
            f"Não foi possível salvar a planilha '{criar_planilha_equalizacao.caminho_planilha_saida().name}'. "
            "Feche o arquivo no Excel (ou em qualquer outro programa) e tente novamente."
        )
    except FileNotFoundError as e:
        erro = f"Arquivo não encontrado: {e}"
    except Exception as e:
        erro = f"Erro ao processar: {e}"

    if erro:
        st.error(erro)
    else:
        st.success("Equalização processada com sucesso!")
        st.session_state.processado = True
    with st.expander("Log de processamento"):
        st.markdown("**Extração por fornecedor**")
        if extrair_llm.EVENTOS:
            st.dataframe(pd.DataFrame(extrair_llm.EVENTOS), hide_index=True, width="stretch")
        else:
            st.caption("Nenhuma extração registrada.")

        if df_propostas_log is not None:
            st.markdown(f"**Propostas extraídas ({len(df_propostas_log)})**")
            st.dataframe(df_propostas_log, hide_index=True, width="stretch")
        if df_cliente_log is not None:
            st.markdown("**Dados do cliente**")
            st.dataframe(df_cliente_log, hide_index=True, width="stretch")

        avisos = [
            l.strip() for l in log_extracao.getvalue().splitlines()
            if l.strip().startswith(("[AVISO]", "[INFO]"))
        ]
        etapas = [l.strip() for l in log_etapas.getvalue().splitlines() if l.strip()]
        mensagens = [{"Tipo": "Aviso", "Mensagem": m} for m in avisos] + [
            {"Tipo": "Etapa", "Mensagem": m} for m in etapas
        ]
        if mensagens:
            st.markdown("**Mensagens**")
            st.dataframe(pd.DataFrame(mensagens), hide_index=True, width="stretch")

# ----------------------------------------------------------------------------
# Resumo, ranking e exportação só aparecem depois que o usuário efetivamente
# clicar em "Processar Equalização" nesta sessão (não basta o CSV já existir
# em disco de uma execução anterior).
# ----------------------------------------------------------------------------
if not st.session_state.get("processado"):
    st.info("Clique em **▶ Processar Equalização** para gerar o resumo e o ranking.")
    st.stop()

if not CAMINHO_PROPOSTAS.exists() or not CAMINHO_CLIENTE.exists():
    st.error("Arquivos processados não encontrados. Clique em **▶ Processar Equalização** novamente.")
    st.stop()

df_propostas = pd.read_csv(CAMINHO_PROPOSTAS)
cliente = pd.read_csv(CAMINHO_CLIENTE).iloc[0]

# ----------------------------------------------------------------------------
# Resumo
# ----------------------------------------------------------------------------
df_ranking = montar_ranking(df_propostas, cliente)

section_header("RESUMO")
col1, col2, col3, col4 = st.columns(4)

lider = df_ranking[df_ranking["Rank"] != "-"].head(1)
total = len(df_ranking)

with col1:
    forn_lider = lider["Fornecedor"].iloc[0] if not lider.empty else "—"
    metric_card("🏆", forn_lider, "1º COLOCADO NO RANK")
with col2:
    vpl_lider = lider["VPL (R$)"].iloc[0] if not lider.empty else None
    metric_card("⚡", _fmt_moeda(vpl_lider), "VPL DO 1º COLOCADO")
with col3:
    preco_medio_lider = lider["Preço Médio (R$/MWh)"].iloc[0] if not lider.empty else None
    metric_card("🏷️", _fmt_moeda(preco_medio_lider), "PREÇO MÉDIO DO 1º COLOCADO")
with col4:
    metric_card("📊", str(total), "PROPOSTAS RECEBIDAS")

anos = anos_disponiveis(df_propostas)
row_vencedor = df_propostas[df_propostas["Fornecedor"] == forn_lider].iloc[0] if not lider.empty else None

if row_vencedor is not None:
    st.write("")
    st.write("")
    with st.container(border=True, key="grafico_vencedor"):
        st.altair_chart(grafico_curva_preco(row_vencedor, anos, forn_lider), width="stretch")
    render_produto_card(row_vencedor)

# ----------------------------------------------------------------------------
# Ranking
# ----------------------------------------------------------------------------
section_header("RANKING DA EQUALIZAÇÃO")

render_ranking_table(df_ranking)

# ----------------------------------------------------------------------------
# Detalhes e download
# ----------------------------------------------------------------------------
with st.expander("Ver tabela completa de propostas (todos os campos extraídos dos PDFs)"):
    st.dataframe(df_propostas, width="stretch", hide_index=True)

section_header("EXPORTAR")
arquivo_saida = criar_planilha_equalizacao.caminho_planilha_saida()
if arquivo_saida.exists():
    with open(arquivo_saida, "rb") as f:
        st.download_button(
            "⬇️ Baixar planilha de equalização (.xlsx)",
            data=f.read(),
            file_name=arquivo_saida.name,
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
else:
    st.caption("A planilha ainda não foi gerada. Clique em **▶ Processar Equalização**.")

# ----------------------------------------------------------------------------
# Relatório
# ----------------------------------------------------------------------------
section_header("RELATÓRIO")

if st.button("📄 Gerar Relatório", type="primary"):
    barra_progresso = st.progress(0, text="Gerando relatório .docx...")

    def _atualizar_progresso(passo_atual, total_passos, rotulo):
        percentual = int(passo_atual / total_passos * 100)
        barra_progresso.progress(percentual, text=f"Gerando relatório .docx... {percentual}% — {rotulo}")

    buf_relatorio = gerar_relatorio.gerar_relatorio_docx(
        cliente=cliente,
        df_ranking=df_ranking,
        row_vencedor=row_vencedor,
        forn_lider=forn_lider,
        anos=anos,
        vpl_lider=vpl_lider,
        preco_medio_lider=preco_medio_lider,
        total=total,
        fornecedores_pdfs=fornecedores_pdfs,
        on_progress=_atualizar_progresso,
    )
    barra_progresso.progress(100, text="Gerando relatório .docx... 100% — Concluído")
    st.session_state.relatorio_docx = buf_relatorio.getvalue()
    st.success("Relatório gerado com sucesso!")

if st.session_state.get("relatorio_docx"):
    nome_cliente = str(cliente.get("Razão Social") or "Cliente").strip().replace(" ", "_")
    st.download_button(
        "⬇️ Baixar Relatório (.docx)",
        data=st.session_state.relatorio_docx,
        file_name=f"Relatorio_Equalizacao_{nome_cliente}.docx",
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
