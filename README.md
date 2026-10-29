# Equalização de Propostas — Next.js + API Python (Vercel)

- `app/`, `lib/`: front-end Next.js (upload via Vercel Blob, progresso, ranking, parâmetros, download do .xlsx).
- `api/*.py`: funções serverless Python (`/api/cliente`, `/api/extrair`, `/api/consolidar`).
- `api/_engine/`: pipeline original (extração LLM/regex, VPL, aderência, planilha) + `engine.py`, que redireciona os caminhos para `/tmp`.
- `legacy/`: app Streamlit original e `gerar_relatorio.py` (relatório .docx — Fase 2).

## Variáveis de ambiente
Copie `.env.example` para `.env.local`: `ANTHROPIC_API_KEY` e `BLOB_READ_WRITE_TOKEN` (crie um Blob store no projeto Vercel).

## Rodar localmente
```
npm install
npx vercel dev
```
`vercel dev` executa o Next.js e as funções Python juntos. `npm run dev` sozinho não serve `/api/*.py`.
