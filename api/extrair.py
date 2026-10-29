"""POST /api/extrair  {"fornecedor": str, "urls": [str]}  ->  proposta extraída de um fornecedor."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        urls = corpo["urls"]
        if not isinstance(urls, list) or not urls:
            raise ValueError("Informe ao menos um PDF.")
        return engine.extrair_fornecedor(str(corpo["fornecedor"]), urls)
