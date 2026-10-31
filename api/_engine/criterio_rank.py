"""
Critério de definição do vencedor no Rank da Equalização.

Ordem de prioridade (cada critério só desempata o anterior):
  1º Menor Preço Médio
  2º Menor VPL
  3º Maior Flexibilidade no limite inferior
  4º Maior Flexibilidade no limite superior
  5º Maior Sazonalidade no limite inferior
  6º Maior Sazonalidade no limite superior
  7º Melhor Modulação

Preço Médio e VPL são comparados em centavos (arredondados a 2 casas): sem isso
uma diferença de ponto flutuante impediria os critérios 3 a 5 de entrarem em jogo.
Flexibilidade e Sazonalidade têm os limites comparados separadamente (±50% vale +50%
e -50%; "Flat" = 0): vence o maior limite inferior e, persistindo o empate, o maior
limite superior. Modulação: curva de carga (livre) > Flat > demais.
"""
import analisar_propostas

DESCRICAO = (
    "Rank por menor Preço Médio; desempate por menor VPL (TMA 10%), depois maior "
    "Flexibilidade (limite inferior, depois superior), maior Sazonalidade (limite "
    "inferior, depois superior) e melhor Modulação (curva de carga > Flat); "
    "todas as propostas recebidas entram no rank, independente da aderência ao produto "
    "solicitado (a aderência fica registrada nas colunas ao lado)"
)


def _limites(texto) -> tuple:
    """(limite superior, limite inferior) de um campo percentual bilateral, em magnitude (Flat/sem dado = 0).
    Ex.: "±50%" -> (50, 50); "+30% / -10%" -> (30, 10)."""
    inferior, superior = analisar_propostas._parse_intervalo_percentual(texto)
    return (superior or 0.0, inferior or 0.0)


def _nota_modulacao(texto) -> int:
    modulacao = analisar_propostas._normalizar_modulacao(texto)
    if modulacao == "Carga":
        return 2
    if modulacao == "Flat":
        return 1
    return 0


def chave_rank(preco_medio, vpl, flexibilidade, sazonalidade, modulacao) -> tuple:
    """Chave de ordenação (menor = melhor colocada) de uma proposta com Preço Médio e VPL calculados."""
    flex_sup, flex_inf = _limites(flexibilidade)
    sazo_sup, sazo_inf = _limites(sazonalidade)
    return (
        round(float(preco_medio), 2),
        round(float(vpl), 2),
        -flex_inf, -flex_sup,
        -sazo_inf, -sazo_sup,
        -_nota_modulacao(modulacao),
    )
