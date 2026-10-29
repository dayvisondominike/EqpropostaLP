"""
Aplicação de Equalização de Propostas - Mercado Livre de Energia

Executa o pipeline completo, na ordem:
  1. extrair_dados_pdfs.py         -> lê os PDFs em Cotacao/ e gera
                                       processado/propostas.csv e cliente.csv
  2. criar_planilha_equalizacao.py -> cria Equalizacao_LP_ACL_<CLIENTE>.xlsx
                                       (abas "Cliente" e "Equalização"),
                                       já ordenada por VPL - o nome do
                                       arquivo é derivado da Razão Social lida
                                       do e-mail de cotação (cliente.csv)
  3. calcular_equalizacao.py       -> adiciona Preço Médio e VPL (TMA 10%)
  4. analisar_propostas.py         -> adiciona aderência e Rank da Equalização

Rode este arquivo sempre que as propostas (PDFs na pasta Cotacao) mudarem:
    python App.py

IMPORTANTE: feche a planilha Equalizacao_LP_ACL_*.xlsx no Excel antes de
rodar - o script precisa reescrevê-la do zero e o Windows bloqueia a escrita
enquanto o arquivo está aberto.
"""
import sys

import extrair_dados_pdfs
import criar_planilha_equalizacao
import calcular_equalizacao
import analisar_propostas


def _etapa(numero, total, titulo, funcao):
    print(f"\n[{numero}/{total}] {titulo}")
    print("-" * 60)
    funcao()


def main():
    print("=" * 60)
    print("EQUALIZAÇÃO DE PROPOSTAS - MERCADO LIVRE DE ENERGIA")
    print("=" * 60)

    etapas = [
        ("Extraindo dados dos PDFs (pasta Cotacao)", extrair_dados_pdfs.main),
        ("Criando planilha de equalização (ordenada por VPL)", criar_planilha_equalizacao.main),
        ("Calculando Preço Médio e VPL (TMA 10%)", calcular_equalizacao.main),
        ("Analisando aderência e Rank da Equalização", analisar_propostas.main),
    ]

    try:
        for i, (titulo, funcao) in enumerate(etapas, start=1):
            _etapa(i, len(etapas), titulo, funcao)
    except PermissionError:
        print("\n[ERRO] Não foi possível salvar o arquivo:")
        print(f"       {criar_planilha_equalizacao.caminho_planilha_saida()}")
        print("       Feche a planilha no Excel (ou em qualquer outro programa) e rode novamente.")
        sys.exit(1)
    except FileNotFoundError as erro:
        print(f"\n[ERRO] Arquivo não encontrado: {erro}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("CONCLUÍDO")
    print(f"Planilha gerada em: {criar_planilha_equalizacao.caminho_planilha_saida()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
