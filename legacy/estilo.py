"""
Identidade visual compartilhada entre a interface Streamlit (streamlit_app.py)
e o gerador de relatório .docx (gerar_relatorio.py).

Mantém CSS e os "builders" de HTML num único lugar para garantir que o
relatório exportado (via captura de tela desses mesmos trechos de HTML/CSS)
fique idêntico ao que aparece na tela do app.
"""
import html

import altair as alt
import pandas as pd

CSS_IDENTIDADE = """
section[data-testid="stSidebar"] { background-color: #132e24; }
section[data-testid="stSidebar"] * { color: #e8f0ea !important; }
section[data-testid="stSidebar"] input,
section[data-testid="stSidebar"] textarea,
section[data-testid="stSidebar"] [data-baseweb="base-input"],
section[data-testid="stSidebar"] [data-baseweb="select"] > div {
    background-color: #1c3f31 !important;
    border: 1px solid #2a5744 !important;
}
section[data-testid="stSidebar"] hr { border-color: #2a5744; }

/* Botões +/- do number_input e a seta do selectbox usam "color: inherit" no
   ícone; sem isso eles herdam o branco do texto da sidebar e ficam invisíveis
   sobre o fundo claro do próprio botão. */
section[data-testid="stSidebar"] button[data-testid="stNumberInputStepDown"],
section[data-testid="stSidebar"] button[data-testid="stNumberInputStepUp"],
section[data-testid="stSidebar"] button[data-testid="stNumberInputStepDown"] svg,
section[data-testid="stSidebar"] button[data-testid="stNumberInputStepUp"] svg {
    color: #000000 !important;
    fill: #000000 !important;
}
/* A seta do selectbox (React Aria ComboBox nas versões atuais do Streamlit -
   não usa mais "data-baseweb") define fill="currentColor" direto no <svg>;
   o !important abaixo vence esse atributo de apresentação inline. Só o <svg>
   é estilizado (não "svg *"): o path interno sem fill próprio herda o preto
   normalmente, mas o path do fundo (fill="none") preserva seu próprio valor. */
section[data-testid="stSidebar"] [data-testid="stSelectbox"] svg {
    color: #000000 !important;
    fill: #000000 !important;
}
/* st.sidebar.button (ex.: "Limpar cache") também herda o branco da regra
   geral da sidebar acima e fica ilegível sobre o fundo claro do próprio
   botão - preto no estado normal (não selecionado). Selecionado (hover/
   foco/pressionado) o Streamlit só troca o fundo por um cinza quase
   transparente (quase branco), então texto branco ali ficaria ilegível -
   por isso o fundo também vira a cor primária do tema nesse estado, pra
   sobrar contraste com o texto branco. */
section[data-testid="stSidebar"] div[data-testid="stButton"] button,
section[data-testid="stSidebar"] div[data-testid="stButton"] button * {
    color: #000000 !important;
}
section[data-testid="stSidebar"] div[data-testid="stButton"] button:hover,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:hover *,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:focus,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:focus *,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:active,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:active * {
    color: #ffffff !important;
}
section[data-testid="stSidebar"] div[data-testid="stButton"] button:hover,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:focus,
section[data-testid="stSidebar"] div[data-testid="stButton"] button:active {
    background-color: #1f6f52 !important;
    border-color: #1f6f52 !important;
}

.st-key-grafico_vencedor { border-color: #9e9e9e !important; }

.app-header { display:flex; align-items:center; gap:14px; margin-bottom:2px; }
.app-header-icon {
    width:48px; height:48px; border-radius:12px; background:#1f6f52;
    display:flex; align-items:center; justify-content:center;
    font-size:22px; color:#fff; flex-shrink:0;
}
.app-header-title { font-size:1.5rem; font-weight:700; color:#1c1c1c; line-height:1.2; }
.app-header-subtitle { color:#8a8577; font-size:0.85rem; margin-top:2px; }
.app-header-underline {
    height:4px; width:130px; background:linear-gradient(90deg,#e8722c,#f2b25c);
    border-radius:3px; margin:10px 0 22px 0;
}

.section-header {
    background:#132e24; color:#e8f0ea; font-weight:700;
    text-transform:uppercase; letter-spacing:.03em;
    padding:10px 16px; border-radius:6px; margin:22px 0 14px 0; font-size:0.8rem;
}

.file-chip {
    display:flex; align-items:flex-start; gap:12px; background:#fff;
    border:1.5px solid #cfe0d8; border-radius:10px; padding:10px 14px; margin-bottom:10px;
    box-shadow:0 1px 2px rgba(0,0,0,0.04);
    transition: background-color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
}
.file-chip.processando {
    background:#fff8e6; border-color:#f0c766;
    box-shadow:0 0 0 4px rgba(240,199,102,0.22);
    animation: chip-pulse 0.9s ease-in-out infinite;
}
.file-chip.concluido {
    background:#eaf7ee; border-color:#7fcf9e;
    box-shadow:0 0 0 4px rgba(46,125,50,0.12);
}
.file-chip-icon { font-size:18px; margin-top:3px; }
.file-chip-name { font-weight:600; font-size:0.82rem; color:#2b2b23; }
.file-chip-meta { font-size:0.72rem; color:#8a8577; }

.chip-badge {
    width:26px; height:26px; border-radius:50%; flex-shrink:0; margin-top:1px;
    display:flex; align-items:center; justify-content:center;
    font-size:14px; font-weight:800; color:#fff; box-sizing:border-box;
    border:2.5px solid #d8e6de; background:#fff;
}
.chip-badge.processando {
    border:3px solid #f6e3ab; border-top-color:#e0a72e; background:#fff;
    animation: badge-spin 0.7s linear infinite;
}
.chip-badge.concluido {
    background:#2e7d32; border-color:#2e7d32; color:#fff;
    animation: badge-pop 0.5s cubic-bezier(.34,1.56,.64,1);
}
.chip-badge.concluido::before { content:"✓"; }

@keyframes chip-pulse {
    0%, 100% { box-shadow:0 0 0 4px rgba(240,199,102,0.22); }
    50%      { box-shadow:0 0 0 8px rgba(240,199,102,0.08); }
}
@keyframes badge-spin { to { transform: rotate(360deg); } }
@keyframes badge-pop {
    0%   { transform:scale(0.3); opacity:0.2; }
    60%  { transform:scale(1.4); }
    100% { transform:scale(1); opacity:1; }
}

.metric-card {
    background:#eaf5ee; border-radius:10px; padding:16px 18px;
    border:1px solid #bfe0cc; border-left:6px solid #1f6f52;
    box-shadow:0 1px 3px rgba(0,0,0,0.06);
    display:flex; gap:14px; align-items:center; height:100%;
}
.metric-icon {
    width:42px; height:42px; border-radius:10px; background:#fff;
    box-shadow:0 1px 2px rgba(0,0,0,0.1);
    display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;
}
.metric-value { font-size:1.35rem; font-weight:700; color:#1c1c1c; line-height:1.2; }
.metric-label {
    font-size:0.68rem; color:#8a8577; text-transform:uppercase;
    letter-spacing:.04em; font-weight:600; margin-top:2px;
}

.cliente-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; }
.cliente-item { font-size:0.85rem; }
.cliente-label { color:#8a8577; font-size:0.72rem; text-transform:uppercase; font-weight:600; }
.cliente-value { color:#1c1c1c; font-weight:600; }

.produto-card {
    background:#f8f8f8; border:1px solid #ececec; border-left:6px solid #1f6f52;
    border-radius:10px; padding:16px 18px; height:100%; box-sizing:border-box;
    box-shadow:0 1px 3px rgba(0,0,0,0.06);
}
.produto-card .cliente-value { color:#1c1c1c; }
.produto-card .cliente-label { color:#7a7a7a; }
.produto-card-title {
    font-weight:700; font-size:0.85rem; color:#1c1c1c; margin-bottom:12px;
}

.ranking-table-wrap {
    background:#fff; border:1px solid #ddd7c8; border-radius:12px; overflow:hidden;
    box-shadow:0 1px 3px rgba(0,0,0,0.05);
}
.ranking-table-scroll { overflow-x:auto; }
.ranking-table { width:100%; border-collapse:collapse; font-size:0.85rem; white-space:nowrap; }
.ranking-table thead th {
    background:#c9c9c9; color:#000000; text-transform:uppercase; letter-spacing:.04em;
    font-size:0.66rem; font-weight:700; padding:13px 16px; text-align:left;
}
.ranking-table thead th.num { text-align:right; }
.ranking-table tbody td {
    padding:12px 16px; border-bottom:1px solid #f0ece0; color:#2b2b23; vertical-align:middle;
}
.ranking-table tbody tr:last-child td { border-bottom:none; }
.ranking-table tbody tr:hover td { background:#faf8f0; }
.ranking-table tbody tr.vencedor td { background:#cdebd5; }
.ranking-table tbody tr.vencedor:hover td { background:#c3e6cc; }
.ranking-table td.num {
    text-align:right; font-variant-numeric:tabular-nums; font-weight:600; font-feature-settings:"tnum";
}
.ranking-table td.forn-cell { font-weight:700; color:#1c1c1c; }
.ranking-table td.flex-cell {
    font-weight:600; max-width:180px; white-space:normal; overflow-wrap:break-word;
}
.ranking-table td.obs-cell {
    color:#000000; font-size:0.78rem; max-width:340px; white-space:normal;
    overflow-wrap:break-word;
}

.rank-badge {
    display:inline-flex; align-items:center; justify-content:center;
    width:28px; height:28px; border-radius:50%; font-weight:800; font-size:0.78rem;
    color:#fff; background:#b7b1a0;
}
.rank-badge.ouro { background:linear-gradient(135deg,#f3c95e,#c8952a); box-shadow:0 0 0 3px rgba(240,192,74,.25); }
.rank-badge.prata { background:linear-gradient(135deg,#dbe0e3,#9aa3a8); }
.rank-badge.bronze { background:linear-gradient(135deg,#d9985e,#a05a2c); }
.rank-badge.padrao { background:#e2e2e2; color:#000000; }
.rank-badge.sem { background:#e7e2d6; color:#8a8577; }

.tipo-pill {
    display:inline-block; padding:3px 10px; border-radius:6px;
    background:#f0ece0; color:#6b6555; font-size:0.72rem; font-weight:600; white-space:nowrap;
}

.status-pill {
    display:inline-flex; align-items:center; gap:6px; padding:4px 11px;
    border-radius:999px; font-size:0.74rem; font-weight:700; white-space:nowrap;
}
.status-pill.ok { background:#e5f3e6; color:#1f6f2e; }
.status-pill.ressalva { background:#fdf1cf; color:#8a6110; }
.status-pill.nao { background:#fbe4e4; color:#a4222a; }
.status-pill.semdados { background:#f0ece0; color:#8a8577; }
"""


def _fmt_moeda(valor) -> str:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return "—"
    if pd.isna(valor):
        return "—"
    s = f"{valor:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def metric_card_html(icone: str, valor: str, rotulo: str) -> str:
    return (
        f'<div class="metric-card"><div class="metric-icon">{icone}</div>'
        f'<div><div class="metric-value">{valor}</div>'
        f'<div class="metric-label">{rotulo}</div></div></div>'
    )


def chip_html(fornecedor: str, arquivos, estado: str = "pendente") -> str:
    """estado: 'pendente' (cinza, parado) | 'processando' (anel amarelo girando)
    | 'concluido' (check verde com animação de pop)."""
    meta_html = "".join(
        f'<div class="file-chip-meta">{nome[:42]}{"…" if len(nome) > 42 else ""} · {tam:.1f}KB</div>'
        for nome, tam in arquivos
    )
    return (
        f'<div class="file-chip {estado}"><div class="chip-badge {estado}"></div>'
        f'<span class="file-chip-icon">📄</span>'
        f'<div><div class="file-chip-name">{fornecedor}</div>{meta_html}</div></div>'
    )


def _status_pill(status: str):
    if isinstance(status, str) and status.startswith("Aderente") and "ressalvas" not in status:
        return "ok", "✓"
    if isinstance(status, str) and "ressalvas" in status:
        return "ressalva", "⚠"
    if isinstance(status, str) and status.startswith("Não"):
        return "nao", "✕"
    return "semdados", "–"


def grid_campos_html(campos) -> str:
    """Grade de rótulo/valor em 2 colunas - usada em Dados do Cliente,
    Características do Produto e dentro do produto_card_html."""
    itens = "".join(
        f'<div class="cliente-item"><div class="cliente-label">{rotulo}</div>'
        f'<div class="cliente-value">{valor if pd.notna(valor) else "—"}</div></div>'
        for rotulo, valor in campos
    )
    return f'<div class="cliente-grid">{itens}</div>'


def produto_card_html(titulo: str, campos) -> str:
    return (
        f'<div class="produto-card"><div class="produto-card-title">{titulo}</div>'
        f"{grid_campos_html(campos)}</div>"
    )


def _rank_badge(rank):
    if rank == "-":
        return "sem", "–"
    r = int(rank)
    if r == 1:
        return "ouro", "1"
    if r == 2:
        return "prata", "2"
    if r == 3:
        return "bronze", "3"
    return "padrao", str(r)


def ranking_table_html(df: pd.DataFrame) -> str:
    # Importante: nenhuma linha em branco/indentação solta no HTML abaixo.
    # O parser Markdown do Streamlit trata uma linha em branco seguida de
    # texto indentado como um bloco de código, o que interrompe o modo HTML
    # bruto no meio da tabela e faz o restante aparecer como texto literal.
    # Por isso cada <tr> é montado em uma única linha, sem strings triplas.
    linhas_html = []
    for _, row in df.iterrows():
        badge_cls, badge_label = _rank_badge(row["Rank"])
        pill_cls, pill_icon = _status_pill(row["Aderente ao Produto"])
        vencedor_cls = "vencedor" if row["Rank"] == 1 else ""

        fornecedor = html.escape(str(row["Fornecedor"]))
        flex = html.escape(str(row["Flex"]))
        tipo = html.escape(str(row["Tipo de Proposta"]))
        status = html.escape(str(row["Aderente ao Produto"]))
        obs = html.escape(str(row["Observações"]))
        preco_medio = html.escape(_fmt_moeda(row["Preço Médio (R$/MWh)"]))
        vpl = html.escape(_fmt_moeda(row["VPL (R$)"]))

        linhas_html.append(
            f'<tr class="{vencedor_cls}">'
            f'<td><span class="rank-badge {badge_cls}">{badge_label}</span></td>'
            f'<td class="forn-cell">{fornecedor}</td>'
            f'<td class="flex-cell">{flex}</td>'
            f'<td><span class="tipo-pill">{tipo}</span></td>'
            f'<td class="num">{preco_medio}</td>'
            f'<td class="num">{vpl}</td>'
            f'<td><span class="status-pill {pill_cls}">{pill_icon} {status}</span></td>'
            f'<td class="obs-cell" title="{obs}">{obs}</td>'
            f"</tr>"
        )

    return (
        '<div class="ranking-table-wrap"><div class="ranking-table-scroll">'
        '<table class="ranking-table"><thead><tr>'
        "<th>Rank</th><th>Fornecedor</th><th>Flex</th><th>Tipo de Proposta</th>"
        '<th class="num">Preço Médio (R$/MWh)</th><th class="num">VPL (R$)</th>'
        "<th>Aderente ao Produto</th><th>Observações</th>"
        "</tr></thead><tbody>"
        + "".join(linhas_html)
        + "</tbody></table></div></div>"
    )


def grafico_curva_preco(row: pd.Series, anos: list, fornecedor: str):
    cor = "#2e7d32"
    precos = [row.get(f"Preço {a} (R$/MWh)") for a in anos]
    teto = max(p for p in precos if pd.notna(p)) * 1.18
    df_curva = pd.DataFrame({"Ano": [str(a) for a in anos], "Preço (R$/MWh)": precos})

    base = alt.Chart(df_curva).encode(
        x=alt.X(
            "Ano:O",
            title="Ano",
            scale=alt.Scale(padding=0),
            axis=alt.Axis(grid=False, domain=False, tickColor="#d8e6de", labelColor="#8a8577", titleColor="#8a8577"),
        ),
        y=alt.Y(
            "Preço (R$/MWh):Q",
            title="R$/MWh",
            scale=alt.Scale(domain=[0, teto]),
            axis=alt.Axis(
                grid=True, gridDash=[2, 3], gridColor="#d8d2c0", domain=False,
                tickColor="#d8e6de", labelColor="#8a8577", titleColor="#8a8577",
            ),
        ),
    )
    area = base.mark_area(color=cor, opacity=0.18, line=False, interpolate="monotone")
    linha = base.mark_line(color=cor, strokeWidth=2.5, interpolate="monotone")
    marcador = base.mark_circle(size=150, color=cor, stroke="#ffffff", strokeWidth=2.5, opacity=1)
    alvo_hover = base.mark_circle(size=280, color=cor, opacity=0.001).encode(
        tooltip=[
            alt.Tooltip("Ano:O", title="Ano"),
            alt.Tooltip("Preço (R$/MWh):Q", title="Preço", format=",.2f"),
        ]
    )
    rotulos = base.mark_text(dy=-16, color="#2b2b23", fontWeight="bold", fontSize=12).encode(
        text=alt.Text("Preço (R$/MWh):Q", format=",.2f")
    )

    return (
        (area + linha + marcador + alvo_hover + rotulos)
        .properties(width="container", height=260, title=f"Curva de Preço — {fornecedor} (R$/MWh)")
        .configure_view(strokeWidth=0)
        .configure_title(fontSize=14, color="#1c1c1c", anchor="start")
    )
