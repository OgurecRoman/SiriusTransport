"""Normalize values without inventing fields absent from telemetry."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any


_INTEGER = re.compile(r"^[+-]?\d+$")
_NUMBER = re.compile(r"^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$")
_TIMESTAMP_KEYS = {"timestamp", "timestamp_local"}


def _normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if stripped == "":
        return None
    if stripped.lower() == "true":
        return True
    if stripped.lower() == "false":
        return False
    if _INTEGER.fullmatch(stripped):
        return int(stripped)
    if _NUMBER.fullmatch(stripped):
        return float(stripped)
    return value


def normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    """Convert scalar strings and timestamp fields while retaining all fields."""

    normalized = {key: _normalize_value(value) for key, value in record.items()}
    for key in _TIMESTAMP_KEYS:
        value = normalized.get(key)
        if isinstance(value, str):
            normalized[key] = datetime.fromisoformat(value)
    return normalized


def decode_and_normalize(json_text: str) -> dict[str, Any]:
    record = json.loads(json_text)
    if not isinstance(record, dict):
        raise ValueError("telemetry record must be a JSON object")
    return normalize_record(record)