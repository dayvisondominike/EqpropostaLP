"""
Critério de definição do vencedor no Rank da Equalização.

Ordem de prioridade (cada critério só desempata o anterior):
  1º Menor Preço Médio
  2º Menor VPL
  3º Maior Flexibilidade
  4º Maior Sazonalidade
  5º Melhor Modulação

Preço Médio e VPL são comparados em centavos (arredondados a 2 casas): sem isso
uma diferença de ponto flutuante impediria os critérios 3 a 5 de entrarem em jogo.
Flexibilidade e Sazonalidade são medidas pela soma dos limites inferior e superior
ofertados ("Flat" = 0). Modulação: curva de carga (livre) > Flat > demais.
"""
import analisar_propostas

DESCRICAO = (
    "Rank por menor Preço Médio; desempate por menor VPL (TMA 10%), depois maior "
    "Flexibilidade, maior Sazonalidade e melhor Modulação (curva de carga > Flat); "
    "todas as propostas recebidas entram no rank, independente da aderência ao produto "
    "solicitado (a aderência fica registrada nas colunas ao lado)"
)


def _amplitude(texto) -> float:
    """Soma dos limites inferior e superior de um campo percentual bilateral (Flat/sem dado = 0)."""
    inferior, superior = analisar_propostas._parse_intervalo_percentual(texto)
    return (inferior or 0.0) + (superior or 0.0)


def _nota_modulacao(texto) -> int:
    modulacao = analisar_propostas._normalizar_modulacao(texto)
    if modulacao == "Carga":
        return 2
    if modulacao == "Flat":
        return 1
    return 0


def chave_rank(preco_medio, vpl, flexibilidade, sazonalidade, modulacao) -> tuple:
    """Chave de ordenação (menor = melhor colocada) de uma proposta com Preço Médio e VPL calculados."""
    return (
        round(float(preco_medio), 2),
        round(float(vpl), 2),
        -_amplitude(flexibilidade),
        -_amplitude(sazonalidade),
        -_nota_modulacao(modulacao),
    )
