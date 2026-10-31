"""POST /api/identificar  {"url": str, "nome": str}  ->  fornecedor e tipo do PDF (proposta, e-mail do cliente, anexo)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        return engine.identificar_documento(str(corpo["url"]), str(corpo.get("nome") or ""))
