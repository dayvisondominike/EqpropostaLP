"""Função Python única do app: despacha por rota para o motor de equalização.

Uma só função (em vez de uma por endpoint) faz o Vercel empacotar as dependências
pesadas (pandas, numpy, pdfplumber...) uma vez por deployment, e não quatro.

POST /api/cliente     {"url": str}  ->  dados do cliente (e-mail de cotação) + parâmetros sugeridos.
POST /api/identificar {"url": str, "nome": str}  ->  fornecedor e tipo do arquivo (proposta, e-mail do cliente, anexo).
POST /api/extrair     {"fornecedor": str, "urls": [str]}  ->  proposta extraída de um fornecedor.
POST /api/consolidar  {"propostas": [...], "cliente": {...}, "params": {...}?}
                      ->  ranking, tabela de propostas, parâmetros usados e a planilha .xlsx em base64.

O vercel.json reescreve /api/<rota> para /api/index.py?rota=<rota>.
"""
import os
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import JsonHandler  # noqa: E402


def _cliente(corpo: dict) -> dict:
    return engine.extrair_cliente(str(corpo["url"]))


def _identificar(corpo: dict) -> dict:
    return engine.identificar_documento(str(corpo["url"]), str(corpo.get("nome") or ""))


def _extrair(corpo: dict) -> dict:
    urls = corpo["urls"]
    if not isinstance(urls, list) or not urls:
        raise ValueError("Informe ao menos um PDF.")
    return engine.extrair_fornecedor(str(corpo["fornecedor"]), urls)


def _consolidar(corpo: dict) -> dict:
    return engine.consolidar(corpo["propostas"], corpo["cliente"], corpo.get("params"))


ROTAS = {
    "cliente": _cliente,
    "identificar": _identificar,
    "extrair": _extrair,
    "consolidar": _consolidar,
}


def _rota_da_requisicao(caminho: str) -> str:
    url = urlparse(caminho)
    rota = (parse_qs(url.query).get("rota") or [""])[0]
    return rota or url.path.rstrip("/").rsplit("/", 1)[-1]


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        funcao = ROTAS.get(_rota_da_requisicao(self.path))
        if funcao is None:
            raise ValueError("Rota desconhecida.")
        return funcao(corpo)
