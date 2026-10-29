"""Helpers para os handlers serverless (BaseHTTPRequestHandler) do Vercel."""
import json
import traceback
from http.server import BaseHTTPRequestHandler

LIMITE_CORPO_BYTES = 4 * 1024 * 1024


class JsonHandler(BaseHTTPRequestHandler):
    """Base dos endpoints: cada arquivo em api/ declara `class handler(JsonHandler)`
    (o runtime do Vercel procura essa classe por nome) e implementa `executar`,
    que recebe o JSON do POST e devolve o JSON de resposta."""

    def executar(self, corpo: dict) -> dict:
        raise NotImplementedError

    def _responder(self, status: int, payload: dict):
        corpo = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
            if tamanho > LIMITE_CORPO_BYTES:
                return self._responder(413, {"erro": "Corpo da requisição grande demais."})
            corpo = json.loads(self.rfile.read(tamanho) or b"{}")
            self._responder(200, self.executar(corpo))
        except (ValueError, KeyError, TypeError) as e:
            self._responder(400, {"erro": f"Requisição inválida: {e}"})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self._responder(500, {"erro": f"{e.__class__.__name__}: {e}"})

    def do_GET(self):
        self._responder(405, {"erro": "Use POST."})

    def log_message(self, *_args):
        pass
