"""File-level streaming parser with non-fatal parse error collection."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .normalizer import decode_and_normalize
from .tokenizer import IncompleteJSONError, iter_json_objects


@dataclass
class ParseResult:
    readings: list[dict[str, Any]] = field(default_factory=list)
    parse_errors: list[dict[str, Any]] = field(default_factory=list)


def parse_file(path: str | Path) -> ParseResult:
    result = ParseResult()
    previous_timestamp: datetime | None = None
    with Path(path).open("r", encoding="utf-8") as stream:
        try:
            for record_number, json_text in enumerate(iter_json_objects(stream), start=1):
                try:
                    record = decode_and_normalize(json_text)
                except (ValueError, json.JSONDecodeError) as error:
                    result.parse_errors.append({"record": record_number, "error": str(error)})
                    continue
                timestamp = record.get("timestamp")
                record["is_duplicate_ts"] = timestamp is not None and timestamp == previous_timestamp
                if timestamp is not None:
                    previous_timestamp = timestamp
                record["raw_json"] = json.loads(json_text)
                result.readings.append(record)
        except IncompleteJSONError as error:
            result.parse_errors.append(
                {"record": len(result.readings) + 1, "line": error.line, "error": str(error)}
            )
    return result