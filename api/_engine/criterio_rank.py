"""
Critério de definição do vencedor no Rank da Equalização: pontuação de 0 a 100.

Cada proposta soma pontos em 7 critérios; quem tiver mais pontos fica em 1º lugar.
Os pesos ficam todos em PESOS (somam 100) e podem ser ajustados num só lugar:

  Preço Médio ........................ 35
  VPL ................................ 25
  Flexibilidade (inferior + superior)  20  (10 + 10)
  Sazonalidade (inferior + superior) . 10  (5 + 5)
  Modulação .......................... 10

Nota de cada critério (0 a 100% do peso):
  - Preço Médio e VPL: posição entre a proposta mais barata (100%) e a mais cara (0%).
    A nota depende, portanto, do conjunto de propostas da equalização.
  - Flexibilidade e Sazonalidade, em cada limite: ofertado ÷ solicitado pelo cliente,
    limitado a 100% (oferecer mais que o pedido não dá bônus; pedido 0 = nota cheia).
  - Modulação: 100% se atende ao pedido do cliente (curva de carga também atende a Flat),
    0% caso contrário.

Empate de pontuação (em 2 casas): desempata em cascata por menor Preço Médio, menor VPL,
maior limite inferior e superior de Flexibilidade, idem de Sazonalidade e melhor Modulação
(curva de carga > Flat > demais). Propostas sem dados ficam no final, sem pontuação.
"""
import analisar_propostas

PESOS = {
    "preco": 35.0,
    "vpl": 25.0,
    "flex_inferior": 10.0,
    "flex_superior": 10.0,
    "sazo_inferior": 5.0,
    "sazo_superior": 5.0,
    "modulacao": 10.0,
}

DESCRICAO = (
    "Pontuação de 0 a 100 (preço médio 35, VPL 25, flexibilidade 20, sazonalidade 10 e "
    "modulação 10): a proposta com mais pontos fica em 1º lugar; empates pela pontuação "
    "desempatam por menor preço médio, menor VPL, flexibilidade, sazonalidade e modulação; "
    "todas as propostas recebidas entram no rank, independente da aderência ao produto "
    "solicitado (a aderência fica registrada nas colunas ao lado)"
)


def _limites(texto) -> tuple:
    """(limite superior, limite inferior) de um campo percentual bilateral, em magnitude (Flat/sem dado = 0).
    Ex.: "±50%" -> (50, 50); "+30% / -10%" -> (30, 10)."""
    inferior, superior = analisar_propostas._parse_intervalo_percentual(texto)
    return (superior or 0.0, inferior or 0.0)


def _nota_modulacao(texto) -> int:
    """Desempate: curva de carga (2) > Flat (1) > demais (0)."""
    modulacao = analisar_propostas._normalizar_modulacao(texto)
    if modulacao == "Carga":
        return 2
    if modulacao == "Flat":
        return 1
    return 0


def _atende_modulacao(texto) -> float:
    ofertada = analisar_propostas._normalizar_modulacao(texto)
    desejada = analisar_propostas._normalizar_modulacao(analisar_propostas.MODULACAO_DESEJADA)
    return 1.0 if ofertada == desejada or (ofertada == "Carga" and desejada == "Flat") else 0.0


def _nota_limite(ofertado: float, solicitado: float) -> float:
    return 1.0 if not solicitado else min(ofertado / solicitado, 1.0)


def _posicao(valor: float, menor: float, maior: float) -> float:
    return 1.0 if maior == menor else (maior - valor) / (maior - menor)


def pontuar(itens: list) -> list:
    """Pontuação (0 a 100) de cada item; None para os sem dados. Cada item é um dict com
    media, vpl, flexibilidade, sazonalidade e modulacao (media/vpl None = sem dados)."""
    validos = [i for i in itens if i["vpl"] is not None]
    if not validos:
        return [None] * len(itens)
    medias = [i["media"] for i in validos]
    vpls = [i["vpl"] for i in validos]
    pontos = []
    for i in itens:
        if i["vpl"] is None:
            pontos.append(None)
            continue
        flex_sup, flex_inf = _limites(i["flexibilidade"])
        sazo_sup, sazo_inf = _limites(i["sazonalidade"])
        pontos.append(
            PESOS["preco"] * _posicao(i["media"], min(medias), max(medias))
            + PESOS["vpl"] * _posicao(i["vpl"], min(vpls), max(vpls))
            + PESOS["flex_inferior"] * _nota_limite(flex_inf, analisar_propostas.FLEXIBILIDADE_INFERIOR_MINIMA)
            + PESOS["flex_superior"] * _nota_limite(flex_sup, analisar_propostas.FLEXIBILIDADE_SUPERIOR_MINIMA)
            + PESOS["sazo_inferior"] * _nota_limite(sazo_inf, analisar_propostas.SAZONALIZACAO_INFERIOR_MINIMA)
            + PESOS["sazo_superior"] * _nota_limite(sazo_sup, analisar_propostas.SAZONALIZACAO_SUPERIOR_MINIMA)
            + PESOS["modulacao"] * _atende_modulacao(i["modulacao"])
        )
    return pontos


def ordenar(itens: list) -> tuple:
    """(índices na ordem do rank, pontuação de cada item). Sem dados vão para o final, na ordem original."""
    pontos = pontuar(itens)

    def chave(posicao: int) -> tuple:
        i, p = itens[posicao], pontos[posicao]
        if p is None:
            return (1,)
        flex_sup, flex_inf = _limites(i["flexibilidade"])
        sazo_sup, sazo_inf = _limites(i["sazonalidade"])
        return (0, -round(p, 2), round(float(i["media"]), 2), round(float(i["vpl"]), 2),
                -flex_inf, -flex_sup, -sazo_inf, -sazo_sup, -_nota_modulacao(i["modulacao"]))

    return sorted(range(len(itens)), key=chave), pontos  # sorted é estável
