"""
Extração de dados das propostas de energia via LLM (API da Anthropic, com
suporte nativo a PDF) - substitui os parsers em regex de extrair_dados_pdfs.py
como fonte primária de dados, mantendo exatamente o mesmo formato de saída
(mesmas chaves de dicionário) que alimenta a etapa 2 (criar_planilha_equalizacao.py).

Uso:
  - extrair_proposta_llm(caminhos_pdf, nome_pasta) -> dict no schema de
    parse_X() de extrair_dados_pdfs.py, ou None se a extração não foi
    possível (sem chave de API, SDK não instalado, erro de rede/HTTP etc.) -
    nesse caso o chamador deve cair para o parser em regex daquele fornecedor,
    se existir (ver PARSERS em extrair_dados_pdfs.py).
  - extrair_cliente_llm(caminho_pdf) -> dict no schema de parse_cliente(),
    mesma regra de fallback.

Requer a variável de ambiente ANTHROPIC_API_KEY (ou outra fonte de
credenciais aceita pelo SDK - ver `ant auth login`) e o pacote `anthropic`
instalado (`pip install anthropic`). Sem isso, as duas funções abaixo
retornam None silenciosamente (só imprimem um aviso), sem derrubar o
pipeline - o comportamento antigo em regex continua funcionando.

As respostas são cacheadas em disco (processado/cache_llm/) por hash do
conteúdo dos PDFs, para não gastar uma chamada de API nova toda vez que o
usuário clicar em "Processar Equalização" com os mesmos arquivos.
"""
import base64
import hashlib
import io
import json
import os
import re
from pathlib import Path
from typing import List, Optional

try:
    from pypdf import PdfReader, PdfWriter
    _PYPDF_DISPONIVEL = True
except ImportError:
    _PYPDF_DISPONIVEL = False

# Carrega ANTHROPIC_API_KEY (e outras variáveis) de um arquivo .env na raiz do
# projeto, se existir - python-dotenv não sobrescreve variáveis já definidas
# no ambiente (ex.: setx/$env:), só preenche o que ainda não estiver setado.
# Também é opcional: se o pacote não estiver instalado, ignora e segue com
# o que já estiver no ambiente.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# `anthropic` (e a `pydantic` que ele depende) podem não estar instalados -
# nesse caso o módulo precisa continuar importável (para não derrubar o
# fallback em regex de quem importa este arquivo) só que "inerte": as classes
# de schema viram objetos vazios e toda função abaixo devolve None cedo,
# antes de tentar usá-las de verdade.
try:
    import anthropic
    from pydantic import BaseModel, Field
    _SDK_DISPONIVEL = True
except ImportError:
    _SDK_DISPONIVEL = False
    BaseModel = object

    def Field(*_args, **_kwargs):
        return None

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "processado" / "cache_llm"

# Muda sempre que o schema abaixo (ou o prompt) mudar de um jeito que invalide
# respostas já cacheadas.
SCHEMA_VERSION = "v5"

# Sonnet 5 em vez de Opus 5: para extração estruturada de documento (não é
# raciocínio complexo) a precisão fica equivalente, com bem menos tokens/custo
# (US$2/US$10 por milhão vs US$5/US$25) e a mesma janela de contexto de 1M.
MODEL_ID = os.environ.get("EQUALIZACAO_LLM_MODEL", "claude-sonnet-5")

# Uma linha por extração (origem do dado, tokens usados etc.), lida pela
# interface Streamlit para montar a tabela do "Log de processamento" - em vez
# de imprimir no terminal. Quem chama limpa a lista antes de cada rodada.
EVENTOS: List[dict] = []


def _registrar(fornecedor: str, origem: str, resp=None, detalhe: str = ""):
    uso = getattr(resp, "usage", None)
    if uso is None:
        cache_prompt = "—"
    elif uso.cache_read_input_tokens:
        cache_prompt = "Leitura"
    else:
        cache_prompt = "Gravação"

    def _tokens(n):
        return f"{n:,}".replace(",", ".") if uso else "—"

    EVENTOS.append({
        "Fornecedor": fornecedor,
        "Origem": origem,
        "Cache do prompt": cache_prompt,
        "Tokens de entrada": _tokens(uso.input_tokens if uso else 0),
        "Tokens de saída": _tokens(uso.output_tokens if uso else 0),
        "Detalhe": detalhe,
    })


# ----------------------------------------------------------------------------
# Schemas (saída estruturada) - nomes de campo em snake_case/ASCII por
# simplicidade; a conversão para as chaves exatas usadas na planilha (com
# espaços, acentos, "R$/MWh" etc.) acontece em _para_dict_proposta /
# _para_dict_cliente, mantendo o schema que já alimenta a etapa 2.
#
# A API rejeita esquemas de saída estruturada "complexos demais" (testado
# empiricamente: um schema plano com 14 campos falha com "Schema is too
# complex"; com 12 campos (mesmo com uma lista aninhada) funciona). Por isso
# as 3 datas (base/emissão/validade) ficam num único campo "datas" de texto
# livre, em vez de 3 campos separados - isso mantém o schema da proposta em
# 12 campos e permite extrair TUDO numa chamada só (em vez de dividir em 2
# chamadas com schemas diferentes, que na prática QUEBRA o prompt caching do
# documento e do system prompt entre elas - a API não reaproveita cache
# quando o `output_format` muda de uma chamada pra outra, mesmo com o mesmo
# system e os mesmos documentos). O formato do campo "datas" é fixo (ver
# SYSTEM_PROMPT_PROPOSTA) e recomposto nas 3 chaves de saída por
# _dividir_datas().
# ----------------------------------------------------------------------------
class PrecoAno(BaseModel):
    ano: int = Field(description="Ano civil de fornecimento, ex.: 2027")
    preco_r_mwh: float = Field(description="Preço de energia em R$/MWh para esse ano")


class PropostaCompleta(BaseModel):
    tipo_proposta: str = Field(
        description='Classificação da proposta, ex.: "Firme", "Indicativa", '
                     '"Vinculante (contrato preliminar)". Inclua entre parênteses '
                     "o nome do produto comercial quando for relevante."
    )
    fonte: Optional[str] = Field(None, description='Tipo/fonte de energia, ex.: "Incentivada 50%"')
    submercado: Optional[str] = None
    periodo: Optional[str] = Field(None, description='Período de fornecimento, ex.: "01/01/2027 a 31/12/2029"')
    volume_mwm: Optional[float] = Field(None, description="Volume médio mensal contratado, em MWm")
    precos_por_ano: List[PrecoAno] = Field(default_factory=list)
    flexibilidade: Optional[str] = Field(None, description="Texto descritivo da flexibilidade, como está no documento")
    sazonalidade: Optional[str] = Field(None, description="Texto descritivo da sazonalização, como está no documento")
    modulacao: Optional[str] = None
    garantia: Optional[str] = None
    retusd_r_mwh: Optional[float] = Field(
        None, description="Valor de ressarcimento pela perda TOTAL do desconto na TUSD/TUST, em R$/MWh"
    )
    pagamento: Optional[str] = None
    datas: Optional[str] = Field(
        None,
        description='As três datas (base, emissão da proposta e validade da proposta) juntas '
                     'em UM único texto, neste formato exato, com esses rótulos fixos - omita o '
                     'trecho de um rótulo se não houver aquela informação, mas nunca mude os '
                     'rótulos: "Base: DD/MM/AAAA | Emissão: DD/MM/AAAA | Validade: <texto>". Se '
                     'não houver data de emissão explícita mas houver validade ("proposta válida '
                     'até X"), pode-se assumir que foi emitida no mesmo dia informado na validade.'
    )


class ClienteCompleto(BaseModel):
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    modalidade: Optional[str] = None
    tipo_energia: Optional[str] = None
    submercado: Optional[str] = None
    periodo: Optional[str] = None
    volume_mwm: Optional[float] = None
    flexibilidade: Optional[str] = None
    sazo: Optional[str] = None
    modulacao: Optional[str] = None
    prazo_envio_propostas: Optional[str] = None
    validade_propostas: Optional[str] = None


SYSTEM_PROMPT_PROPOSTA = """Você é um extrator de dados especializado em propostas comerciais de \
compra e venda de energia elétrica no Mercado Livre de Energia brasileiro (ACL).

Vai receber um ou mais arquivos PDF referentes ao MESMO fornecedor - normalmente uma \
proposta comercial, às vezes acompanhada de um contrato-modelo anexado. Quando houver mais \
de um arquivo, priorize os dados da proposta em si; use o(s) documento(s) anexo(s) somente \
para completar campos que a proposta principal não traz explicitamente (ex.: o valor de \
ressarcimento por perda de desconto na TUSD/RETUSD, que às vezes só aparece numa cláusula \
do contrato-modelo, não na proposta).

Estes campos vão para células de uma tabela lida por gente - seja CONCISO em todos eles: \
extraia só a informação em si (um rótulo curto, um número, uma cláusula específica), nunca \
o parágrafo inteiro ao redor com explicações, fórmulas, condições de aplicação etc., mesmo \
que o documento traga tudo junto. Se a informação estiver espalhada em mais de uma frase, \
resuma no mínimo de palavras possível sem perder o dado - não copie o parágrafo original.

Cuidados ao extrair:
- "tipo_proposta": classifique como "Firme" (vinculante), "Indicativa" (não vinculante, \
sujeita a aprovação/alteração) ou "Vinculante (contrato preliminar)" quando for uma minuta \
de contrato que já vincula as partes. Inclua entre parênteses o nome do produto comercial \
se houver um relevante (ex.: "Indicativa (produto A-GILIZA)").
- "volume_mwm": o volume médio mensal contratado, em MWm (megawatt médio) - um número como \
0,274 (use ponto ou vírgula, tanto faz, o campo é numérico).
- "precos_por_ano": uma entrada por ano civil de fornecimento, com o preço em R$/MWh daquele \
ano. Se o documento trouxer o mesmo preço em vários meses de um mesmo ano, é 1 preço por ano \
(não por mês).
- "retusd_r_mwh": valor de ressarcimento pela perda TOTAL do desconto na TUSD/TUST, em R$/MWh \
- às vezes chamado de "RETUSD", "Re-TUSD", ou descrito dentro de uma fórmula de ressarcimento \
("Ress = ..."). Pegue o valor associado à perda total do desconto, não a uma perda parcial. \
Se não houver nenhuma menção a isso em nenhum dos documentos, deixe null - não invente.
- "modulacao": IMPORTANTE - esse campo é comparado por igualdade exata com um valor escolhido \
pelo usuário (ex.: "Flat" ou "Carga"), então retorne APENAS o rótulo/palavra da modulação tal \
como nomeado no documento (ex.: "Flat", "Carga", "Livre", "Horária"), nunca uma frase ou \
explicação junto - mesmo que o documento traga uma frase inteira sobre o assunto, extraia só \
a palavra-chave.
- "flexibilidade" e "sazonalidade": o valor essencial de cada uma (tipicamente um percentual \
ou par de percentuais, ex.: "+30% / -30%", "Não há"), sem o parágrafo de regras de aplicação \
que costuma vir junto.
- "garantia" e "pagamento": a cláusula específica (ex.: tipo de garantia exigida e prazo; dia/\
prazo de pagamento), sem os parágrafos de multa/juros/procedimento que costumam vir junto.
- "datas": as três datas (base, emissão da proposta, validade da proposta) juntas num único \
campo de texto, no formato descrito no schema. Use DD/MM/AAAA quando possível; se o documento \
só trouxer mês/ano abreviado (ex.: "Jan/27"), transcreva como está.
- Se um campo não existir em nenhum dos documentos, retorne null - nunca invente valores.
- Alguns PDFs são escaneados ou têm o conteúdo como imagem (slides, apresentações); leia o \
conteúdo visualmente nas páginas nesses casos."""

SYSTEM_PROMPT_CLIENTE = """Você é um extrator de dados especializado em e-mails de solicitação \
de cotação de energia elétrica no Mercado Livre de Energia brasileiro (ACL).

Vai receber um PDF (geralmente um e-mail exportado do Outlook) com os dados do cliente e as \
características do produto de energia que ele está cotando. Extraia os campos do schema \
pedido a partir do texto do e-mail. Datas no formato DD/MM/AAAA quando possível. Se um campo \
não existir no documento, retorne null - nunca invente valores."""

# Todo fornecedor usa o MESMO system prompt (e o mesmo schema/output_format,
# PropostaCompleta) - marcar cache_control aqui faz o 2º, 3º etc. fornecedor
# processado numa mesma rodada reaproveitar o prompt de sistema já escrito em
# cache (~10% do preço normal) em vez de pagar de novo. Isso só funciona
# porque o schema é idêntico entre chamadas; um output_format diferente entre
# chamadas quebra o cache mesmo com o texto do system idêntico (testado).
_SYSTEM_PROPOSTA_CACHEADO = [
    {"type": "text", "text": SYSTEM_PROMPT_PROPOSTA, "cache_control": {"type": "ephemeral"}}
]
_SYSTEM_CLIENTE_CACHEADO = [
    {"type": "text", "text": SYSTEM_PROMPT_CLIENTE, "cache_control": {"type": "ephemeral"}}
]


# ----------------------------------------------------------------------------
# Cliente da API / cache em disco
# ----------------------------------------------------------------------------
_client_cache = None


def _client():
    global _client_cache
    if not _SDK_DISPONIVEL:
        return None
    if _client_cache is None:
        try:
            _client_cache = anthropic.Anthropic()
        except Exception:
            return None
    return _client_cache


def _hash_arquivos(caminhos: List[Path]) -> str:
    h = hashlib.sha256()
    h.update(SCHEMA_VERSION.encode())
    for caminho in sorted(caminhos, key=lambda p: p.name):
        h.update(caminho.name.encode("utf-8"))
        h.update(caminho.read_bytes())
    return h.hexdigest()[:24]


def _cache_ler(hash_: str):
    caminho = CACHE_DIR / f"{hash_}.json"
    if not caminho.exists():
        return None
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except Exception:
        return None


def _cache_gravar(hash_: str, dados: dict):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{hash_}.json").write_text(
        json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _bloco_documento(dados_pdf: bytes) -> dict:
    dados_b64 = base64.standard_b64encode(dados_pdf).decode("ascii")
    return {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": dados_b64},
    }


# Conceitos cobertos pelos campos extraídos (ver PropostaCompleta) - usados
# para decidir quais páginas de um anexo GRANDE (ex.: o contrato-modelo da
# Engie) valem a pena mandar para a API, em vez do documento inteiro. É
# proposital ser abrangente (cobre todos os campos, não só RETUSD) para não
# arriscar cortar uma página que complete outro campo que falte na proposta
# principal - a lista larga sacrifica economia por segurança.
TERMOS_ANEXO_RELEVANTES = re.compile(
    r"retusd|re-?tusd|ressarci|\btusd\b|\btust\b|garantia|flexibilidade|"
    r"sazonaliza|modula|pagamento|vencimento|validade",
    re.IGNORECASE,
)

# Só vale a pena recortar anexos com bastante página - em documentos curtos a
# economia é pequena e não compensa o risco de cortar algo relevante.
MIN_PAGINAS_PARA_RECORTAR = 6
MARGEM_PAGINAS = 1  # inclui 1 página antes/depois de cada página com match,
                     # pra não cortar uma cláusula que atravessa a quebra de página.


def _paginas_relevantes(caminho: Path) -> Optional[List[int]]:
    """Índices (0-based) das páginas de `caminho` que mencionam algum dos
    TERMOS_ANEXO_RELEVANTES, com margem. Retorna None (= "manda o PDF
    inteiro, não teve como decidir com segurança") quando o pdfplumber não
    está disponível, o documento é curto demais para valer a pena, ou nenhuma
    página bateu com os termos (mais seguro reenviar tudo do que arriscar
    enviar um recorte vazio ou errado)."""
    try:
        import pdfplumber
    except ImportError:
        return None

    try:
        with pdfplumber.open(caminho) as pdf:
            paginas = pdf.pages
            if len(paginas) < MIN_PAGINAS_PARA_RECORTAR:
                return None
            casadas = [
                i for i, pagina in enumerate(paginas)
                if TERMOS_ANEXO_RELEVANTES.search(pagina.extract_text() or "")
            ]
    except Exception:
        return None

    if not casadas:
        return None

    limite = len(paginas) * 0.9

    com_margem = set()
    for i in casadas:
        for j in range(i - MARGEM_PAGINAS, i + MARGEM_PAGINAS + 1):
            if 0 <= j < len(paginas):
                com_margem.add(j)

    # A margem ajuda a não cortar uma cláusula que atravessa a quebra de
    # página, mas em documentos com muitos matches próximos ela "engole" o
    # documento inteiro (cada página vizinha de um match também entra). Nesse
    # caso, cai para sem margem - ainda reduz de verdade, só perde a proteção
    # contra clásula dividida entre páginas (risco pequeno: os termos são
    # abrangentes o bastante pra normalmente bater na página seguinte também).
    if len(com_margem) < limite:
        return sorted(com_margem)
    if len(casadas) < limite:
        return sorted(casadas)
    return None


def _pdf_recortado(caminho: Path, indices: List[int]) -> bytes:
    leitor = PdfReader(str(caminho))
    escritor = PdfWriter()
    for i in indices:
        escritor.add_page(leitor.pages[i])
    buffer = io.BytesIO()
    escritor.write(buffer)
    return buffer.getvalue()


def _contar_paginas(caminho: Path) -> int:
    """Número de páginas do PDF - usado para decidir qual arquivo é a
    "proposta principal" (menos páginas) num grupo de PDFs da mesma pasta.
    Em caso de erro, devolve um número grande para não ser escolhido como
    principal por engano (mais seguro tentar recortá-lo do que não)."""
    if _PYPDF_DISPONIVEL:
        try:
            return len(PdfReader(str(caminho)).pages)
        except Exception:
            pass
    try:
        import pdfplumber
        with pdfplumber.open(caminho) as pdf:
            return len(pdf.pages)
    except Exception:
        return 10**6


def _dados_documento(caminho: Path, permitir_recorte: bool) -> bytes:
    """Bytes do PDF a enviar - inteiro, ou só as páginas relevantes quando
    `permitir_recorte` é True (documento secundário/anexo, não a proposta
    principal) e valer a pena (ver _paginas_relevantes)."""
    if permitir_recorte and _PYPDF_DISPONIVEL:
        indices = _paginas_relevantes(caminho)
        if indices is not None:
            try:
                return _pdf_recortado(caminho, indices)
            except Exception:
                pass  # qualquer erro no recorte -> manda o arquivo original
    return caminho.read_bytes()


_RE_DATA_BASE = re.compile(r"Base:\s*([^|]+)", re.IGNORECASE)
_RE_DATA_EMISSAO = re.compile(r"Emiss[aã]o:\s*([^|]+)", re.IGNORECASE)
_RE_DATA_VALIDADE = re.compile(r"Validade:\s*(.+)$", re.IGNORECASE)


def _dividir_datas(texto: Optional[str]):
    """Separa o campo combinado "datas" (ver PropostaCompleta.datas) de volta
    em (data_base, data_proposta, validade_proposta). O formato é ditado pelo
    próprio prompt, então o regex é só uma leitura literal dos rótulos fixos
    - não precisa adivinhar layout como nos parsers em regex antigos."""
    if not texto:
        return None, None, None
    m_base = _RE_DATA_BASE.search(texto)
    m_emissao = _RE_DATA_EMISSAO.search(texto)
    m_validade = _RE_DATA_VALIDADE.search(texto)
    return (
        m_base.group(1).strip() if m_base else None,
        m_emissao.group(1).strip() if m_emissao else None,
        m_validade.group(1).strip() if m_validade else None,
    )


def _para_dict_proposta(nome_pasta: str, dados: PropostaCompleta) -> dict:
    precos = {str(p.ano): p.preco_r_mwh for p in dados.precos_por_ano}
    data_base, data_proposta, validade_proposta = _dividir_datas(dados.datas)
    return {
        "Fornecedor": nome_pasta.upper(),
        "Tipo de Proposta": dados.tipo_proposta,
        "Fonte": dados.fonte,
        "Submercado": dados.submercado,
        "Período": dados.periodo,
        "Volume (MWm)": dados.volume_mwm,
        "Preços por ano": precos,
        "Flexibilidade": dados.flexibilidade,
        "Sazonalidade": dados.sazonalidade,
        "Modulação": dados.modulacao,
        "Garantia": dados.garantia,
        "RETUSD (R$/MWh)": dados.retusd_r_mwh,
        "Pagamento": dados.pagamento,
        "Data Base": data_base,
        "Data da Proposta": data_proposta,
        "Validade da Proposta": validade_proposta,
    }


def _para_dict_cliente(dados: ClienteCompleto) -> dict:
    return {
        "Razão Social": dados.razao_social,
        "CNPJ": dados.cnpj,
        "Modalidade": dados.modalidade,
        "Tipo de Energia": dados.tipo_energia,
        "Submercado": dados.submercado,
        "Período": dados.periodo,
        "Volume (MWm)": dados.volume_mwm,
        "Flexibilidade": dados.flexibilidade,
        "Sazo": dados.sazo,
        "Modulação": dados.modulacao,
        "Prazo de envio das propostas": dados.prazo_envio_propostas,
        "Validade das propostas": dados.validade_propostas,
    }


def disponivel() -> bool:
    """True se dá pra tentar extração via LLM agora (SDK instalado e alguma
    credencial resolvível). Não garante que a chamada vai ter sucesso (pode
    faltar permissão, rede etc.) - só que vale a pena tentar."""
    return _client() is not None


def _blocos_documentos(caminhos: List[Path]) -> list:
    """Monta os blocos de documento (1 por PDF). Cada extração faz só 1
    chamada de API, então não há uma 2ª chamada no mesmo recurso que se
    beneficiaria de cache_control no documento (reprocessar o MESMO arquivo
    numa rodada futura já é resolvido pelo cache em disco, ver
    _cache_ler/_cache_gravar) - por isso os documentos vão sem cache_control.

    Quando há mais de um PDF (proposta + anexo, ex.: Engie), só o(s) mais
    curto(s) - a proposta em si - é enviado inteiro; o(s) demais (anexo/
    contrato-modelo, normalmente bem maior) tem as páginas irrelevantes
    cortadas antes de enviar (ver _dados_documento/_paginas_relevantes), pra
    reduzir tokens sem arriscar perder informação que só exista na proposta."""
    if len(caminhos) > 1:
        # Número de páginas, não tamanho em bytes - um PDF de poucas páginas
        # mas com imagens/fontes embutidas pode "pesar" mais em bytes do que
        # um anexo de dezenas de páginas só com texto simples.
        menos_paginas = min(caminhos, key=_contar_paginas)
        dados = [
            _dados_documento(c, permitir_recorte=(c != menos_paginas))
            for c in caminhos
        ]
    else:
        dados = [caminhos[0].read_bytes()]
    return [_bloco_documento(d) for d in dados]


def extrair_proposta_llm(caminhos_pdf, nome_pasta: str):
    """Extrai os dados de uma proposta (1+ PDFs do mesmo fornecedor) via LLM,
    numa única chamada de API (schema PropostaCompleta, 12 campos + lista de
    preços por ano). Retorna um dict no mesmo schema dos parse_X() em regex,
    ou None se a extração não foi possível (sem SDK/chave, erro de API etc.)
    - nesse caso o chamador deve tentar o parser em regex daquele fornecedor,
    se existir."""
    caminhos = [Path(c) for c in caminhos_pdf]
    if not caminhos:
        return None

    hash_ = _hash_arquivos(caminhos)
    cache = _cache_ler(hash_)
    if cache is not None:
        _registrar(nome_pasta, "Cache em disco", detalhe=f"{hash_}.json")
        return cache

    client = _client()
    if client is None:
        _registrar(nome_pasta, "Regex", detalhe="LLM indisponível (SDK ou chave de API ausente)")
        return None

    try:
        docs = _blocos_documentos(caminhos)
        aviso_multiplos = (
            " Há mais de um arquivo: use o(s) documento(s) adicional(is) apenas para "
            "completar campos que a proposta principal não traz explicitamente "
            "(ex.: RETUSD citado só num contrato-modelo anexo)."
            if len(caminhos) > 1 else ""
        )
        instrucao = (
            f'Extraia todos os dados da proposta comercial de energia do fornecedor '
            f'"{nome_pasta}" anexada acima.' + aviso_multiplos
        )
        resp = client.messages.parse(
            model=MODEL_ID,
            max_tokens=2048,
            system=_SYSTEM_PROPOSTA_CACHEADO,
            messages=[{"role": "user", "content": docs + [{"type": "text", "text": instrucao}]}],
            output_format=PropostaCompleta,
        )
        dados_llm = resp.parsed_output
        if dados_llm is None:
            raise ValueError("resposta da API não trouxe saída estruturada válida")
    except Exception as e:
        print(
            f"[AVISO] Extração via LLM falhou para '{nome_pasta}' ({e.__class__.__name__}: {e}); "
            "usando parser em regex como alternativa, se existir."
        )
        _registrar(nome_pasta, "Regex", detalhe=f"Falha na API: {e.__class__.__name__}: {e}")
        return None

    _registrar(nome_pasta, f"API ({MODEL_ID})", resp)
    dados = _para_dict_proposta(nome_pasta, dados_llm)
    _cache_gravar(hash_, dados)
    return dados


def extrair_cliente_llm(caminho_pdf):
    """Extrai as características do cliente/produto a partir do e-mail de
    cotação via LLM, numa única chamada de API (schema ClienteCompleto, 12
    campos, sem lista aninhada). Retorna um dict no mesmo schema de
    parse_cliente(), ou None se a extração não foi possível (mesma regra de
    fallback)."""
    caminho = Path(caminho_pdf)
    hash_ = _hash_arquivos([caminho])
    cache = _cache_ler(hash_)
    if cache is not None:
        _registrar("E-mail do cliente", "Cache em disco", detalhe=f"{hash_}.json")
        return cache

    client = _client()
    if client is None:
        _registrar("E-mail do cliente", "Regex", detalhe="LLM indisponível (SDK ou chave de API ausente)")
        return None

    try:
        docs = _blocos_documentos([caminho])
        resp = client.messages.parse(
            model=MODEL_ID,
            max_tokens=1024,
            system=_SYSTEM_CLIENTE_CACHEADO,
            messages=[{"role": "user", "content": docs + [{
                "type": "text",
                "text": "Extraia todos os dados do cliente e as características do produto de "
                        "energia solicitados neste e-mail.",
            }]}],
            output_format=ClienteCompleto,
        )
        dados_llm = resp.parsed_output
        if dados_llm is None:
            raise ValueError("resposta da API não trouxe saída estruturada válida")
    except Exception as e:
        print(
            f"[AVISO] Extração via LLM do e-mail do cliente falhou ({e.__class__.__name__}: {e}); "
            "usando parser em regex como alternativa."
        )
        _registrar("E-mail do cliente", "Regex", detalhe=f"Falha na API: {e.__class__.__name__}: {e}")
        return None

    _registrar("E-mail do cliente", f"API ({MODEL_ID})", resp)

    dados = _para_dict_cliente(dados_llm)
    _cache_gravar(hash_, dados)
    return dados


# ----------------------------------------------------------------------------
# Identificação do fornecedor de um PDF solto (arrastar e soltar)
# ----------------------------------------------------------------------------
TIPOS_DOCUMENTO = ("proposta", "email_cliente", "anexo_contrato", "outro")


class IdentificacaoDocumento(BaseModel):
    fornecedor: str = Field(
        description="Nome comercial CURTO e padronizado da empresa que emitiu a proposta/contrato "
        "(ex.: 'Engie', 'Casa dos Ventos', 'Cemig', 'Auren', 'Axia', 'Light', 'Serena', 'Echo Energia'). "
        "Vazio se o documento não for de um fornecedor (ex.: e-mail do cliente)."
    )
    tipo: str = Field(
        description="'proposta' (proposta comercial de energia de um fornecedor), 'email_cliente' "
        "(e-mail/solicitação de cotação do cliente com as características do produto), "
        "'anexo_contrato' (contrato-modelo, minuta ou anexo de um fornecedor) ou 'outro'."
    )
    cliente: str = Field(description="Nome do cliente (consumidor) citado no documento, se houver; senão vazio.")


_SYSTEM_IDENTIFICAR = (
    "Você classifica documentos de cotação de energia elétrica do mercado livre (ACL) no Brasil. "
    "Para cada PDF diga quem é o fornecedor (comercializadora/geradora que emite a proposta ou o "
    "contrato), o tipo do documento e o cliente citado. Use sempre o nome comercial curto e "
    "consistente da empresa (o mesmo nome para todos os documentos dela, sem 'S.A.', 'Ltda' ou "
    "'Comercializadora'). Se o documento for o e-mail de solicitação do cliente (pedido de cotação "
    "com submercado, volume, período, flexibilidade), o tipo é 'email_cliente' e o fornecedor fica vazio."
)


def _fornecedor_pelo_arquivo(nome_arquivo: str) -> str:
    """Alternativa sem LLM: primeiro trecho do nome ('Engie - Mirella - ...pdf' -> 'Engie')."""
    base = re.split(r"\s+[-–_]\s+|_", Path(nome_arquivo).stem, maxsplit=1)[0].strip()
    return base[:40]


def identificar_documento_llm(caminho_pdf, nome_arquivo: str = "") -> dict:
    """Identifica fornecedor e tipo de um PDF olhando só as primeiras páginas.
    Nunca levanta: sem SDK/chave ou em caso de erro, devolve o palpite pelo nome do arquivo."""
    caminho = Path(caminho_pdf)
    nome_arquivo = nome_arquivo or caminho.name
    palpite = {"fornecedor": _fornecedor_pelo_arquivo(nome_arquivo), "tipo": "proposta", "cliente": "", "origem": "Nome do arquivo"}

    client = _client()
    if client is None:
        return palpite
    try:
        if _PYPDF_DISPONIVEL:
            total = _contar_paginas(caminho)
            dados = _pdf_recortado(caminho, list(range(min(3, total)))) if total < 10**6 else caminho.read_bytes()
        else:
            dados = caminho.read_bytes()
        resp = client.messages.parse(
            model=MODEL_ID,
            max_tokens=256,
            system=_SYSTEM_IDENTIFICAR,
            messages=[{"role": "user", "content": [_bloco_documento(dados), {
                "type": "text",
                "text": f'Arquivo: "{nome_arquivo}". Identifique o fornecedor, o tipo do documento e o cliente.',
            }]}],
            output_format=IdentificacaoDocumento,
        )
        r = resp.parsed_output
        if r is None:
            return palpite
        tipo = r.tipo if r.tipo in TIPOS_DOCUMENTO else "outro"
        fornecedor = r.fornecedor.strip() or ("" if tipo == "email_cliente" else palpite["fornecedor"])
        _registrar(fornecedor or "E-mail do cliente", f"API ({MODEL_ID})", resp, detalhe=f"Identificação: {nome_arquivo}")
        return {"fornecedor": fornecedor, "tipo": tipo, "cliente": r.cliente.strip(), "origem": "LLM"}
    except Exception as e:  # noqa: BLE001
        print(f"[AVISO] Identificação via LLM falhou para '{nome_arquivo}' ({e.__class__.__name__}: {e}).")
        return palpite
