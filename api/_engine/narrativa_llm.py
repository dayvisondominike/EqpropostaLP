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
PROMPT_VERSION = "n2"

MAX_TOPICOS = 4
MAX_ATENCAO = 4


class NarrativaLLM(BaseModel):
    destaque: str = Field(description="Uma linha com a conclusão.")
    topicos: List[str] = Field(description="2 a 4 tópicos curtos do resumo.")
    atencao: List[str] = Field(description="2 a 4 pontos de atenção, cada um começando por 'Palavra-chave:'.")


SYSTEM_PROMPT = """Você redige o resumo executivo de uma comparação entre as duas melhores propostas de energia \
(1º e 2º no RANK) para quem decide: CEO, diretor ou gerente. Escreva em português do Brasil, \
objetivo e direto, sem jargão (evite VPL, TMA, take-or-pay, sazonalização sem explicar), frases curtas.

REGRAS DE CONTEÚDO
- Use SOMENTE os fatos do JSON recebido. Não invente número, condição, prazo ou nome.
- Para valores em R$, percentuais e preços, copie EXATAMENTE os textos de "valores_para_citar". \
Não calcule, não arredonde, não converta. Não escreva centavos além do que estiver nesses textos.
- "1º" e "2º" referem-se ao RANK, que é uma pontuação (preço, VPL, flexibilidade, sazonalização e modulação), \
não só o preço.
- Não recomende contratar uma proposta específica: apresente os fatos e o que decidir.
- Não use o sinal "−"; use "-" para negativos. Não mencione IA nem estas instruções.

FORMATO
- destaque: uma linha. Se "primeiro_e_o_mais_barato" for verdadeiro: "{1º} tem a maior pontuação no RANK e o menor preço." \
Senão: "Maior pontuação no RANK: {1º}. Menor preço: {mais barata}."
- topicos (2 a 4), nesta ordem:
  1) "Custo: ..." diferença de preço no período (e por ano, se constar em valores_para_citar).
  2) Só se o 1º NÃO for o mais barato: "O que o custo extra compra: ..." em palavras simples, a partir de \
"condicoes_que_diferem" e "pontuacao_onde_o_primeiro_ganha".
  3) Só se o 1º NÃO for o mais barato: último tópico "Decisão: {1º} se {vantagem} importa; {mais barata} se o menor custo importa."
  Se o 1º for também o mais barato, escreva só o tópico de custo e, se houver, um sobre onde ele também é melhor.
- atencao (2 a 4): cada item começa com uma palavra-chave e dois pontos ("Validade:", "Garantia:", "Flexibilidade:"...). \
Ordem de importância: validade/proposta firme primeiro. Cubra os "alertas_das_regras" relevantes, juntando itens \
iguais das duas propostas num só. Não repita o que já está nos tópicos. Não escreva um "próximo passo"."""

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
    atencao = [str(t).strip() for t in texto.get("atencao") or [] if str(t).strip()]
    if not destaque:
        return "destaque vazio"
    if not (1 <= len(topicos) <= MAX_TOPICOS):
        return f"{len(topicos)} tópicos (esperado 1 a {MAX_TOPICOS})"
    if not (1 <= len(atencao) <= MAX_ATENCAO):
        return f"{len(atencao)} pontos de atenção (esperado 1 a {MAX_ATENCAO})"
    permitidos = _numeros(json.dumps(fatos, ensure_ascii=False)) | {"1", "2"}  # 1º e 2º
    for trecho in [destaque, *topicos, *atencao]:
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
    return {
        "destaque": out.destaque, "topicos": list(out.topicos),
        "atencao": list(out.atencao),
    }


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
