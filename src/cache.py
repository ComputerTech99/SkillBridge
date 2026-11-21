"""Deterministic credit-safe disk cache storing JSON payloads under data/cache/."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

CACHE_DIR: Path = Path(__file__).resolve().parent.parent / "data" / "cache"


def _build_cache_path(namespace: str, params: dict[str, Any]) -> Path:
    """Ensure cache directory exists and return deterministic SHA-256 cache file path."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    filtered_params = {k: v for k, v in params.items() if k != "api_key"}
    canonical_params = json.dumps(
        filtered_params,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    key_material = f"{namespace}:{canonical_params}".encode("utf-8")
    digest = hashlib.sha256(key_material).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def get_cached(namespace: str, params: dict) -> dict | None:
    """Return cached JSON dict for (namespace, params), or None on miss or corruption."""
    cache_path = _build_cache_path(namespace, params)
    if not cache_path.is_file():
        return None
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def set_cached(namespace: str, params: dict, payload: dict) -> None:
    """Persist a JSON-serializable payload dict to disk for (namespace, params)."""
    cache_path = _build_cache_path(namespace, params)
    serialized = json.dumps(payload, indent=2, ensure_ascii=False)
    tmp_path = cache_path.with_suffix(".tmp")
    tmp_path.write_text(serialized, encoding="utf-8")
    tmp_path.replace(cache_path)
