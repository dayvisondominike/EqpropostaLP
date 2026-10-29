"""POST /api/consolidar  {"propostas": [...], "cliente": {...}, "params": {...}?}
->  ranking, tabela de propostas, parâmetros usados e a planilha .xlsx em base64."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        return engine.consolidar(corpo["propostas"], corpo["cliente"], corpo.get("params"))
