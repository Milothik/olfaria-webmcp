"""Carga reproducible del corpus oficial de Olfaria.

Este módulo contiene únicamente lectura, normalización e índices. No usa
modelos locales, servicios de IA ni fuentes externas. El JSON original se
conserva intacto para la web y se ofrece una vista normalizada para WebMCP.
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import threading
import unicodedata
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple


ROOT = Path(__file__).resolve().parent
EXPECTED_SHA256 = os.environ.get("OLFARIA_EXPECTED_SHA256", "").strip().lower()
DATA_FILE = Path(
    os.environ.get("OLFARIA_DATA_FILE", ROOT / "data" / "olfaria-sample.json")
).resolve()

_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {
    "mtime": None,
    "raw": None,
    "normalized": None,
    "schema": "unknown",
    "sha256": None,
}


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def _number(value: Any, fallback: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "."))
        except ValueError:
            pass
    return fallback


def _schema(raw: dict) -> str:
    if raw.get("dataset", "").startswith("Olfemas") or "relaciones" in raw:
        return "v1_5_0"
    if raw.get("schema", "").startswith("olfaria.internet_pack.seed"):
        return "v0_2"
    return "unknown"


def _olfema(item: dict) -> Optional[dict]:
    if not isinstance(item, dict):
        return None
    code = item.get("codigo") or item.get("olfaria_code")
    id_key = item.get("id_key")
    identifier = item.get("id") or id_key or code
    if not identifier:
        return None
    intensity = item.get("intensidad") or item.get("intensity_range") or [1, 3]
    if isinstance(intensity, dict):
        intensity = intensity.get("range") or [intensity.get("min", 1), intensity.get("max", 3)]
    if not isinstance(intensity, list):
        intensity = [1, 3]
    family = item.get("familia") or item.get("family") or "unknown"
    risks = item.get("risk_flags") or []
    if not risks and family in {"defect", "regulatory", "stability"}:
        risks = [id_key or code or identifier]
    return {
        "id": identifier,
        "olfaria_code": code or identifier,
        "id_key": id_key or identifier,
        "label": item.get("etiqueta") or item.get("label") or identifier,
        "family": family,
        "facet": item.get("faceta") or item.get("facet") or "",
        "typical_phase": item.get("fase") or item.get("typical_phase") or "ambient",
        "intensity_range": intensity[:2],
        "polarity": _number(item.get("polaridad", item.get("polarity", 0))),
        "synonyms": item.get("sinonimos") or item.get("synonyms") or [],
        "related_ingredients_or_materials": (
            item.get("ingredientes_materiales")
            or item.get("related_ingredients_or_materials")
            or []
        ),
        "risk_flags": risks,
        "source_tags": item.get("source_tags") or item.get("procedencia") or [],
        "procedencia": item.get("procedencia") or [],
        "incertidumbre": item.get("incertidumbre"),
        "codigo_original": item.get("codigo_original"),
    }


def _relation(item: dict, resolve: Callable[[Any], Optional[str]]) -> Optional[dict]:
    if not isinstance(item, dict):
        return None
    identifier = item.get("id") or item.get("relacion")
    source = resolve(item.get("source") or item.get("origen"))
    target = resolve(item.get("target") or item.get("destino"))
    predicate = item.get("predicate") or item.get("predicado")
    if not all((identifier, source, target, predicate)):
        return None
    return {
        "id": identifier,
        "source": source,
        "target": target,
        "predicate": predicate,
        "confidence": _number(item.get("confidence", item.get("confianza", 0.5)), 0.5),
        "weight": item.get("weight", item.get("peso")),
        "uncertainty": item.get("uncertainty", item.get("incertidumbre")),
        "phase": item.get("phase", item.get("fase")),
        "rationale": item.get("rationale") or item.get("racional_comentario") or "",
    }


def normalize_dataset(raw: dict) -> Tuple[dict, str]:
    olfemas = []
    seen = set()
    for item in raw.get("olfemas") or []:
        normalized = _olfema(item)
        if not normalized or normalized["id"] in seen:
            continue
        seen.add(normalized["id"])
        olfemas.append(normalized)

    by_id = {item["id"]: item["id"] for item in olfemas}
    by_code = {item["olfaria_code"]: item["id"] for item in olfemas}
    by_key = {item["id_key"]: item["id"] for item in olfemas}

    def resolve(value: Any) -> Optional[str]:
        return by_id.get(value) or by_key.get(value) or by_code.get(value)

    relations = []
    for item in raw.get("relations") or raw.get("relaciones") or []:
        normalized = _relation(item, resolve)
        if normalized:
            relations.append(normalized)

    schema = _schema(raw)
    return {
        "schema": "olfaria.internet_pack.seed.v0.2",
        "source_schema": schema,
        "source_dataset": raw.get("dataset") or raw.get("schema") or "",
        "source_version": raw.get("version") or "",
        "olfemas": olfemas,
        "relations": relations,
    }, schema


def _refresh() -> None:
    try:
        mtime = DATA_FILE.stat().st_mtime_ns
    except OSError as error:
        raise RuntimeError(f"No se encuentra el corpus: {DATA_FILE}") from error
    if _CACHE["normalized"] is not None and _CACHE["mtime"] == mtime:
        return
    source_bytes = DATA_FILE.read_bytes()
    sha256 = hashlib.sha256(source_bytes).hexdigest()
    if EXPECTED_SHA256 and sha256 != EXPECTED_SHA256:
        raise RuntimeError(
            "El corpus no coincide con la versión auditada: "
            f"SHA-256 esperado {EXPECTED_SHA256}, recibido {sha256}."
        )
    raw = json.loads(source_bytes.decode("utf-8"))
    normalized, schema = normalize_dataset(raw)
    _CACHE.update(
        mtime=mtime,
        raw=raw,
        normalized=normalized,
        schema=schema,
        sha256=sha256,
    )


def load_raw_data() -> dict:
    with _LOCK:
        _refresh()
        return _CACHE["raw"]


def load_data() -> dict:
    with _LOCK:
        _refresh()
        return _CACHE["normalized"]


def corpus_status() -> dict:
    data = load_data()
    return {
        "loaded": True,
        "schema": data["source_schema"],
        "source_dataset": data["source_dataset"],
        "source_version": data["source_version"],
        "olfemas": len(data["olfemas"]),
        "relations": len(data["relations"]),
        "file": DATA_FILE.name,
        "sha256": _CACHE["sha256"],
    }
