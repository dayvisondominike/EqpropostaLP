"""
Gera o relatório executivo (.docx) da Equalização de Propostas a partir do
MODELO em modelos/Relatorio_Equalizacao_Modelo.docx - o arquivo NÃO é criado
do zero: abrimos o modelo (que já traz o cabeçalho com o logo da Ludfor, as
barras de seção, o espaçamento e a seção "Nossos Contatos" prontos) e só
substituímos, em cada seção, a imagem correspondente pela versão atualizada
com os dados da equalização atual.

Cada bloco de conteúdo é renderizado como imagem a partir do MESMO HTML/CSS
(estilo.py) usado na tela do Streamlit (streamlit_app.py), para sair
visualmente idêntico ao que aparece lá:
  - Dados do Cliente / Características do Produto
  - Chips de Fornecedores (Fonte de Dados)
  - Cards do Resumo
  - Gráfico (Curva de Preço) - renderizado a partir do MESMO spec Vega-Lite
    exibido em tela, via vl-convert (sem precisar de navegador)
  - Características da Proposta Vencedora
  - Tabela de Ranking da Equalização

A seção "Nossos Contatos" e o logo do cabeçalho não são tocados - ficam
exatamente como estão no modelo (conteúdo estático de marca).

Usado pelo botão "Gerar Relatório" da seção RELATÓRIO do app - não faz parte
do pipeline de linha de comando (App.py).
"""
import io
import tempfile
from pathlib import Path

import pandas as pd
import vl_convert as vlc
from docx import Document
from docx.shared import Emu
from docx.text.paragraph import Paragraph
from html2image import Html2Image
from PIL import Image, ImageChops

from estilo import (
    CSS_IDENTIDADE,
    _fmt_moeda,
    chip_html,
    grafico_curva_preco,
    grid_campos_html,
    metric_card_html,
    produto_card_html,
    ranking_table_html,
)

MODELO_PATH = Path(__file__).parent / "modelos" / "Relatorio_Equalizacao_Modelo.docx"

NS_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
NS_WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"

NAVEGADORES_CANDIDATOS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def _texto(valor) -> str:
    return "—" if valor is None or (isinstance(valor, float) and pd.isna(valor)) else str(valor)


def _localizar_navegador():
    for caminho in NAVEGADORES_CANDIDATOS:
        if Path(caminho).exists():
            return caminho
    return None


def _renderizar_html_png(conteudo_html: str, largura: int = 1400, altura: int = 1600, escala: int = 2) -> io.BytesIO:
    """Tira um "screenshot" de um trecho de HTML/CSS (usando o mesmo CSS_IDENTIDADE
    do app) via Chromium/Edge headless, e recorta as bordas brancas sobrando."""
    doc_html = (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        f"{CSS_IDENTIDADE}"
        "body{margin:0;padding:20px;background:#ffffff;font-family:'Segoe UI',Arial,sans-serif;}"
        "</style></head><body>" + conteudo_html + "</body></html>"
    )
    with tempfile.TemporaryDirectory() as tmp:
        kwargs = {}
        navegador = _localizar_navegador()
        if navegador:
            kwargs["browser_executable"] = navegador
        hti = Html2Image(
            output_path=tmp,
            size=(largura, altura),
            custom_flags=[
                "--no-sandbox",
                "--disable-gpu",
                f"--force-device-scale-factor={escala}",
                # Flags abaixo só silenciam ruído de diagnóstico do Chromium no
                # console (GPU, sincronização de conta, telemetria) - não têm
                # efeito sobre o resultado do screenshot.
                "--disable-logging",
                "--log-level=3",
                "--disable-sync",
                "--disable-background-networking",
                "--disable-default-apps",
                "--disable-extensions",
                "--disable-component-update",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            **kwargs,
        )
        nome_arquivo = "captura.png"
        hti.screenshot(html_str=doc_html, save_as=nome_arquivo)
        img = Image.open(Path(tmp) / nome_arquivo).convert("RGB")

        fundo = Image.new("RGB", img.size, (255, 255, 255))
        bbox = ImageChops.difference(img, fundo).getbbox()
        if bbox:
            pad = 16 * escala
            l, t, r, b = bbox
            l, t = max(0, l - pad), max(0, t - pad)
            r, b = min(img.width, r + pad), min(img.height, b + pad)
            img = img.crop((l, t, r, b))

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf


def _cards_resumo_html(forn_lider, vpl_lider, preco_medio_lider, total) -> str:
    valores = [
        ("🏆", forn_lider, "1º COLOCADO NO RANK"),
        ("⚡", _fmt_moeda(vpl_lider), "VPL DO 1º COLOCADO"),
        ("🏷️", _fmt_moeda(preco_medio_lider), "PREÇO MÉDIO DO 1º COLOCADO"),
        ("📊", str(total), "PROPOSTAS RECEBIDAS"),
    ]
    celulas = "".join(
        f'<div style="flex:1">{metric_card_html(icone, valor, rotulo)}</div>' for icone, valor, rotulo in valores
    )
    return f'<div style="display:flex; gap:16px;">{celulas}</div>'


def _chips_fornecedores_html(fornecedores_pdfs: dict) -> str:
    celulas = "".join(
        f"<div>{chip_html(fornecedor, arquivos, 'concluido')}</div>" for fornecedor, arquivos in fornecedores_pdfs.items()
    )
    return f'<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:14px;">{celulas}</div>'


def _grafico_curva_preco_png(row_vencedor: pd.Series, anos, fornecedor: str) -> io.BytesIO:
    """Renderiza o MESMO spec Vega-Lite exibido em tela (estilo.grafico_curva_preco),
    via vl-convert - dispensa navegador e garante o resultado pixel-a-pixel igual."""
    chart = grafico_curva_preco(row_vencedor, anos, fornecedor).properties(width=760)
    png_bytes = vlc.vegalite_to_png(chart.to_dict(), scale=3)
    return io.BytesIO(png_bytes)


def _mapear_secoes_com_imagens(doc: Document) -> dict:
    """Varre o corpo do modelo e devolve, para cada título de seção (o texto
    da tabela-banner, em maiúsculas), a lista - na ordem em que aparecem - dos
    elementos <w:p> que contêm imagem, situados entre essa tabela e a próxima."""
    mapa: dict[str, list] = {}
    titulo_atual = None
    for filho in doc.element.body:
        tag = filho.tag.split("}")[-1]
        if tag == "tbl":
            textos = filho.findall(f".//{NS_W}t")
            titulo_atual = "".join(t.text or "" for t in textos).strip().upper()
            mapa.setdefault(titulo_atual, [])
        elif tag == "p" and titulo_atual is not None:
            if filho.findall(f".//{NS_W}drawing"):
                mapa[titulo_atual].append(filho)
    return mapa


def _largura_original(p_element) -> Emu | None:
    ext = p_element.find(f".//{NS_WP}extent")
    return Emu(int(ext.get("cx"))) if ext is not None else None


def _substituir_imagem(doc: Document, p_element, buf: io.BytesIO):
    """Troca a imagem existente no parágrafo pela nova, preservando a largura
    que já estava definida no modelo (assim o dimensionamento fica todo a
    cargo do próprio arquivo .docx, sem precisar de constantes no código)."""
    largura = _largura_original(p_element)
    paragrafo = Paragraph(p_element, doc)
    for run in list(paragrafo.runs):
        run._r.getparent().remove(run._r)
    novo_run = paragrafo.add_run()
    if largura is not None:
        novo_run.add_picture(buf, width=largura)
    else:
        novo_run.add_picture(buf)


def gerar_relatorio_docx(
    cliente: pd.Series,
    df_ranking: pd.DataFrame,
    row_vencedor,
    forn_lider: str,
    anos,
    vpl_lider,
    preco_medio_lider,
    total: int,
    fornecedores_pdfs: dict,
    on_progress=None,
) -> io.BytesIO:
    """on_progress(passo_atual, total_passos, rotulo), se informado, é chamado
    após cada bloco (imagem/gráfico) ser atualizado no documento - usado pela
    interface Streamlit para exibir uma barra de progresso de 0 a 100%."""
    if not MODELO_PATH.exists():
        raise FileNotFoundError(
            f"Modelo do relatório não encontrado em: {MODELO_PATH}. "
            "Verifique se o arquivo 'Relatorio_Equalizacao_Modelo.docx' está na pasta 'modelos/'."
        )

    total_passos = 5 + (2 if row_vencedor is not None else 0)
    _progresso = {"i": 0}

    def _avancar(rotulo: str):
        _progresso["i"] += 1
        if on_progress:
            on_progress(_progresso["i"], total_passos, rotulo)

    doc = Document(str(MODELO_PATH))

    # Nome do cliente no subtítulo do cabeçalho ("Cliente: X")
    if len(doc.paragraphs) > 1:
        p_subtitulo = doc.paragraphs[1]
        novo_texto = f"Cliente: {_texto(cliente.get('Razão Social'))}"
        if p_subtitulo.runs:
            p_subtitulo.runs[0].text = novo_texto
            for run_extra in p_subtitulo.runs[1:]:
                run_extra.text = ""
        else:
            p_subtitulo.add_run(novo_texto)

    mapa = _mapear_secoes_com_imagens(doc)

    def _slot(titulo: str, indice: int = 0):
        slots = mapa.get(titulo.upper(), [])
        return slots[indice] if indice < len(slots) else None

    slot = _slot("Dados do Cliente")
    if slot is not None:
        _substituir_imagem(
            doc,
            slot,
            _renderizar_html_png(
                grid_campos_html([("Razão Social", cliente.get("Razão Social")), ("CNPJ", cliente.get("CNPJ"))]),
                largura=950,
                altura=140,
            ),
        )
    _avancar("Dados do Cliente")

    slot = _slot("Características do Produto")
    if slot is not None:
        _substituir_imagem(
            doc,
            slot,
            _renderizar_html_png(
                grid_campos_html(
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
                ),
                largura=950,
                altura=420,
            ),
        )
    _avancar("Características do Produto")

    slot = _slot("Fonte de Dados — Propostas (PDFs)")
    if slot is not None:
        _substituir_imagem(doc, slot, _renderizar_html_png(_chips_fornecedores_html(fornecedores_pdfs)))
    _avancar("Fonte de Dados")

    slot = _slot("Resumo", 0)
    if slot is not None:
        _substituir_imagem(
            doc, slot, _renderizar_html_png(_cards_resumo_html(forn_lider, vpl_lider, preco_medio_lider, total), altura=260)
        )
    _avancar("Resumo")

    if row_vencedor is not None:
        slot_grafico = _slot("Resumo", 1)
        if slot_grafico is not None:
            _substituir_imagem(doc, slot_grafico, _grafico_curva_preco_png(row_vencedor, anos, forn_lider))
        _avancar("Gráfico")

        slot = _slot("Características da Proposta Vencedora")
        if slot is not None:
            campos_vencedor = [
                ("Fonte", row_vencedor.get("Fonte")),
                ("Submercado", row_vencedor.get("Submercado")),
                ("Período", row_vencedor.get("Período")),
                ("Volume (MWm)", row_vencedor.get("Volume (MWm)")),
                ("Flexibilidade", row_vencedor.get("Flexibilidade")),
                ("Sazonalidade", row_vencedor.get("Sazonalidade")),
                ("Modulação", row_vencedor.get("Modulação")),
                ("Garantia", row_vencedor.get("Garantia")),
                ("RETUSD (R$/MWh)", row_vencedor.get("RETUSD (R$/MWh)")),
                ("Pagamento", row_vencedor.get("Pagamento")),
                ("Data Base", row_vencedor.get("Data Base")),
                ("Validade da Proposta", row_vencedor.get("Validade da Proposta")),
            ]
            _substituir_imagem(
                doc,
                slot,
                _renderizar_html_png(
                    produto_card_html("Características da Proposta Vencedora", campos_vencedor),
                    largura=950,
                    altura=520,
                ),
            )
        _avancar("Características da Proposta Vencedora")

    slot = _slot("Ranking da Equalização")
    if slot is not None:
        _substituir_imagem(doc, slot, _renderizar_html_png(ranking_table_html(df_ranking)))
    _avancar("Ranking da Equalização")

    # "Nossos Contatos" e o logo do cabeçalho não são tocados - ficam como
    # já estão prontos no modelo.

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
