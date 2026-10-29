"""POST /api/cliente  {"url": str}  ->  dados do cliente (e-mail de cotação) + parâmetros sugeridos."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        return engine.extrair_cliente(str(corpo["url"]))
