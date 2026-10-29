"""POST /api/consolidar  {"propostas": [...], "cliente": {...}, "params": {...}?}
->  ranking, tabela de propostas, parâmetros usados e a planilha .xlsx em base64."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

import engine  # noqa: E402
from http_util import criar_handler  # noqa: E402

handler = criar_handler(
    lambda corpo: engine.consolidar(corpo["propostas"], corpo["cliente"], corpo.get("params"))
)
