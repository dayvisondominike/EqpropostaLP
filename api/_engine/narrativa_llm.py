"""
Texto executivo do comparativo 1º × 2º no RANK (página "Decisão" do relatório), escrito pela LLM
a partir de FATOS já calculados pelo app (preços, pontos, condições, alertas das regras).

Garantias:
  - Mesmos fatos => mesmo texto: o resultado é guardado (disco/Vercel Blob) pela impressão digital dos
    fatos + versão do prompt + modelo. Só a primeira geração chama a API; depois o texto volta idêntico.
  - Sem número inventado: todo número do texto precisa existir nos fatos enviados; se não existir
    (ou a saída vier fora do formato), tenta uma vez mais e, falhando, devolve erro - o relatório
    então usa o texto das regras fixas (lib/comparativo.ts).
"""
import hashlib
import json
import re
import time
from typing import List

import extrair_llm as ell

try:
    from pydantic import BaseModel, Field
except ImportError:  # sem pydantic o módulo fica inerte (ver extrair_llm)
    BaseModel = object

    def Field(*_a, **_k):
        return None

# Muda quando o prompt ou o formato mudarem: invalida os textos guardados.
PROMPT_VERSION = "n5"

MAX_TOPICOS = 4


class NarrativaLLM(BaseModel):
    destaque: str = Field(description="Uma linha com a conclusão.")
    topicos: List[str] = Field(description="2 a 4 tópicos curtos do resumo.")


SYSTEM_PROMPT = """Você redige o resumo executivo de uma comparação entre as duas melhores propostas de energia \
(1º e 2º no RANK) para quem decide: CEO, diretor ou gerente. Escreva em português do Brasil, \
objetivo e direto, sem jargão (evite VPL, TMA, take-or-pay, sazonalização sem explicar), frases curtas.

REGRAS DE CONTEÚDO
- Use SOMENTE os fatos do JSON recebido. Não invente número, condição, prazo ou nome.
- Nas frases, chame cada proposta pelo "nome_curto" (ex.: "EDP", não o nome completo do produto). Para valores em R$, percentuais e preços, copie EXATAMENTE os textos de "valores_para_citar". \
Não calcule, não arredonde, não converta. Não escreva centavos além do que estiver nesses textos.
- "1º" e "2º" referem-se ao RANK, que é uma pontuação (preço, VPL, flexibilidade, sazonalização e modulação), \
não só o preço.
- Não recomende contratar uma proposta específica: apresente os fatos e o que decidir.
- Não use o sinal "−"; use "-" para negativos. Não mencione IA nem estas instruções.

FORMATO
- destaque: uma linha. Se "primeiro_e_o_mais_barato" for verdadeiro: "{1º} tem a maior pontuação no RANK e o menor preço." \
Senão: "Maior pontuação no RANK: {1º}. Menor preço: {mais barata}."
- topicos (2 a 4), nesta ordem:
  1) "Custo: ..." sempre comparando com o 2º colocado, dizendo o nome dele e o período, neste molde: \
"Custo: {nome_curto do 1º} é {diferenca_de_preco_no_periodo} ({diferenca_percentual}) {preco_do_primeiro_em_relacao_ao_segundo} que o 2º colocado ({nome_curto do 2º}) em {periodo_do_contrato}". \
Use o total do período (diferenca_de_preco_no_periodo) e não cite a diferença por MWh neste tópico. \
Só acrescente ", cerca de R$ Z por ano" se "diferenca_de_preco_por_ano" existir nos fatos; com um ano só, NÃO fale em valor por ano \
(seria o mesmo valor repetido). Nunca escreva só "diferença de R$ X": diga quem é mais barato ou mais caro que quem.
  2) Se o 1º NÃO for o mais barato: "O que o custo extra compra: ..." em palavras simples, a partir de \
"condicoes_que_diferem" e "pontuacao_onde_o_primeiro_ganha". Se o 1º for também o mais barato: \
"Condições: ..." com a natureza da proposta (firme, indicativa, vinculante), a aderência ao produto e a flexibilidade \
do 1º, a partir de "condicoes_do_primeiro".
  3) Só se existir "mercado" nos fatos: "Mercado: o preço da proposta da {nome_curto do 1º} está X% acima/abaixo da média do spot i5 no período (R$ ...)." \
usando exatamente os textos de "mercado".
  4) Só se o 1º NÃO for o mais barato: último tópico "Decisão: {1º} se {vantagem} importa; {mais barata} se o menor custo importa."
- Não escreva pontos de atenção, alertas de validade nem "próximo passo": isso já aparece em outro lugar do relatório."""

_SYSTEM_CACHEADO = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]

_NUM = re.compile(r"\d+(?:[.,]\d+)*")


def _numeros(texto: str) -> set:
    return set(_NUM.findall(texto))


def _impressao_digital(fatos: dict) -> str:
    base = json.dumps(fatos, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    h = hashlib.sha256(f"{PROMPT_VERSION}|{ell.MODEL_ID}|{base}".encode("utf-8")).hexdigest()
    return "nar_" + h[:24]


def validar(texto: dict, fatos: dict) -> str:
    """'' se o texto é aceitável; senão o motivo da recusa."""
    destaque = str(texto.get("destaque") or "").strip()
    topicos = [str(t).strip() for t in texto.get("topicos") or [] if str(t).strip()]
    if not destaque:
        return "destaque vazio"
    if not (1 <= len(topicos) <= MAX_TOPICOS):
        return f"{len(topicos)} tópicos (esperado 1 a {MAX_TOPICOS})"
    permitidos = _numeros(json.dumps(fatos, ensure_ascii=False)) | {"1", "2"}  # 1º e 2º
    for trecho in [destaque, *topicos]:
        extras = _numeros(trecho) - permitidos
        if extras:
            return f"número fora dos fatos: {sorted(extras)[:3]} em “{trecho[:60]}”"
    return ""


def _gerar(fatos: dict, tentativa: int):
    client = ell._client()
    if client is None:
        raise RuntimeError("LLM indisponível (SDK ou chave de API ausente)")
    t0 = time.monotonic()
    resp = client.messages.parse(
        model=ell.MODEL_ID,
        max_tokens=1500,
        system=_SYSTEM_CACHEADO,
        messages=[{
            "role": "user",
            "content": "Fatos da comparação (JSON):\n" + json.dumps(fatos, ensure_ascii=False, indent=1)
            + "\n\nRedija o texto executivo conforme as regras.",
        }],
        output_format=NarrativaLLM,
    )
    seg = time.monotonic() - t0
    out = resp.parsed_output
    if out is None:
        raise ValueError("resposta da API não trouxe saída estruturada válida")
    ell._registrar("Narrativa", f"API ({ell.MODEL_ID})", resp, detalhe=f"tentativa {tentativa}", segundos=seg)
    return {"destaque": out.destaque, "topicos": list(out.topicos)}


def narrativa(fatos: dict) -> dict:
    """Texto do comparativo: do cache (mesmos fatos) ou gerado pela LLM e conferido. Levanta ValueError se não der."""
    if not isinstance(fatos, dict) or not fatos:
        raise ValueError("Informe os fatos da comparação.")
    chave = _impressao_digital(fatos)
    guardado, origem = ell._cache_ler(chave)
    if isinstance(guardado, dict) and not validar(guardado, fatos):
        print(f"[NARRATIVA] {origem} | {chave}", flush=True)
        return {**guardado, "origem": origem}

    motivo = ""
    for tentativa in (1, 2):
        try:
            texto = _gerar(fatos, tentativa)
        except Exception as e:  # noqa: BLE001
            motivo = f"{e.__class__.__name__}: {e}"
            print(f"[AVISO] Narrativa falhou (tentativa {tentativa}): {motivo}", flush=True)
            continue
        motivo = validar(texto, fatos)
        if not motivo:
            ell._cache_gravar(chave, texto)
            return {**texto, "origem": "LLM"}
        print(f"[AVISO] Narrativa recusada (tentativa {tentativa}): {motivo}", flush=True)
    raise ValueError(f"Não foi possível gerar o texto com a LLM ({motivo}).")
