from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Any

from .normalizer import normalize_record


CSV_FIELD_MAP = {
    "date": "timestamp",
    "locConverged": "is_loc_converged",
    "brakeMech": "is_mechanical_brake_fb",
    "brakeRail": "is_rail_brake_fb",
    "brakeCrash": "is_crash_brake_fb",
    "brakeEmergency": "is_emergency_brake_fb",
    "dangObjAct": "m_danger_obj_act",
    "trafLightAct": "m_trafficlight_act",
    "speedLimitAct": "m_speed_limit_act",
    "route": "m_current_route_name",
}
BOOLEAN_FIELDS = {
    "is_loc_converged",
    "is_mechanical_brake_fb",
    "is_rail_brake_fb",
    "is_crash_brake_fb",
    "is_emergency_brake_fb",
}


def _parse_geo(value: str | None) -> tuple[float | None, float | None]:
    if not value or "," not in value:
        return None, None
    latitude, longitude = (part.strip() for part in value.split(",", maxsplit=1))
    return float(latitude), float(longitude)


def csv_record(row: dict[str, str]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for source_key, value in row.items():
        if source_key == "geo":
            latitude, longitude = _parse_geo(value)
            record["latitude"] = latitude
            record["longitude"] = longitude
        elif source_key in CSV_FIELD_MAP:
            record[CSV_FIELD_MAP[source_key]] = value
        else:
            record[source_key] = value
    normalized = normalize_record(record)
    for field in BOOLEAN_FIELDS:
        if normalized.get(field) in (0, 1):
            normalized[field] = bool(normalized[field])
    normalized["raw_json"] = dict(row)
    return normalized


def iter_csv_records(path: str | Path):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        for row in reader:
            if row:
                yield csv_record(row)


def parse_csv_file(path: str | Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    readings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    previous_timestamp: datetime | None = None
    for record_number, record in enumerate(iter_csv_records(path), start=2):
        try:
            timestamp = record.get("timestamp")
            record["is_duplicate_ts"] = timestamp is not None and timestamp == previous_timestamp
            if timestamp is not None:
                previous_timestamp = timestamp
            readings.append(record)
        except (TypeError, ValueError) as error:
            errors.append({"record": record_number, "error": str(error)})
    return readings, errors