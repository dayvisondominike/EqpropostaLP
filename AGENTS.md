# Equalização de Propostas LP ACL

App Python (Streamlit) que equaliza propostas de energia do Mercado Livre (ACL) a partir de PDFs de cotação.

## Ambiente

- Windows, Python 3.14, ambiente virtual em `.venv/` (já com as dependências de `requirements.txt`).
- Sempre use o interpretador `.venv\Scripts\python.exe`; não instale pacotes no Python global.
- Segredos (chave da API da Anthropic, `EQUALIZACAO_LLM_MODEL`) ficam em `.env`, que não vai para o git. Nunca exponha o conteúdo dele.

## Como executar

- Interface web: `.venv\Scripts\python.exe -m streamlit run streamlit_app.py --server.port 8501` → http://localhost:8501
- Pipeline completo pelo terminal: `.venv\Scripts\python.exe App.py`
- Instalar/atualizar dependências: `.venv\Scripts\python.exe -m pip install -r requirements.txt`

Feche as planilhas `Equalizacao_LP_ACL_*.xlsx` no Excel antes de rodar o pipeline: o Windows bloqueia a reescrita do arquivo aberto.

## Estrutura

Pipeline (orquestrado por `App.py`, na ordem):
1. `extrair_dados_pdfs.py` – lê os PDFs em `Cotacao/` e gera `processado/propostas.csv` e `cliente.csv` (usa `extrair_llm.py` para extração via Claude).
2. `criar_planilha_equalizacao.py` – cria `Equalizacao_LP_ACL_<CLIENTE>.xlsx`.
3. `calcular_equalizacao.py` – Preço Médio e VPL (TMA 10%).
4. `analisar_propostas.py` – aderência e Rank da Equalização.

Outros: `streamlit_app.py` (interface), `estilo.py` (estilo da interface), `gerar_relatorio.py` (relatório Word a partir de `modelos/Relatorio_Equalizacao_Modelo.docx`).

`Clientes/`, `Cotacao/`, `processado/` e `Temp/` contêm dados de clientes ou saídas geradas e não são versionados.

## Convenções

- Código, comentários e mensagens em português do Brasil.
- Este projeto também é editado pelo Claude Code; mantenha as mudanças compatíveis com as duas ferramentas.
