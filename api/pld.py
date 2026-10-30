"""POST /api/pld  ->  PLD médio mensal por submercado (CCEE Dados Abertos).

Tenta atualizar a partir do portal da CCEE (CKAN, dataset `pld_media_mensal`); se o portal
estiver fora do ar ou recusar a consulta, devolve a cópia local embutida no deploy."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_engine"))

from http_util import JsonHandler  # noqa: E402

CCEE = "https://dadosabertos.ccee.org.br/api/3/action"
ARQUIVO_LOCAL = os.path.join(os.path.dirname(__file__), "_engine", "pld_mensal.json")
VALIDADE_CACHE_S = 3600
_cache: dict = {"quando": 0.0, "resposta": None}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _copia_local() -> dict:
    with open(ARQUIVO_LOCAL, encoding="utf-8") as f:
        return json.load(f)


def _atualizar_pela_ccee(dados: dict) -> int:
    """Soma ao dado local o que a CCEE tiver (anos de 2021 em diante). Retorna quantos meses vieram."""
    pacote = _get(f"{CCEE}/package_show?id=pld_media_mensal")["result"]
    novos = 0
    for rec in pacote["resources"]:
        nome = rec.get("name", "")
        ano = nome.rsplit("_", 1)[-1]
        if not (ano.isdigit() and int(ano) >= 2021):
            continue
        consulta = urllib.parse.urlencode({"resource_id": rec["id"], "limit": 1000})
        for r in _get(f"{CCEE}/datastore_search?{consulta}")["result"]["records"]:
            mes = str(r["MES_REFERENCIA"])
            chave = f"{mes[:4]}-{mes[4:6]}"
            dados.setdefault(r["SUBMERCADO"], {})[chave] = float(r["PLD_MEDIA_MES"])
            novos += 1
    return novos


def montar_resposta() -> dict:
    if _cache["resposta"] and time.time() - _cache["quando"] < VALIDADE_CACHE_S:
        return _cache["resposta"]
    local = _copia_local()
    dados, fonte = local["dados"], f"Cópia local — {local['referencia']}"
    try:
        if _atualizar_pela_ccee(dados):
            fonte = "CCEE Dados Abertos (consulta ao vivo)"
    except Exception as e:  # noqa: BLE001 - portal indisponível: segue com a cópia local
        print(f"CCEE indisponível: {e.__class__.__name__}: {e}")
    resposta = {
        "fonte": fonte,
        "dados": {s: dict(sorted(m.items())) for s, m in dados.items()},
    }
    _cache.update(quando=time.time(), resposta=resposta)
    return resposta


class handler(JsonHandler):
    def executar(self, corpo: dict) -> dict:
        return montar_resposta()
