from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass
class Event:
    type: str
    severity: str
    ts_start: datetime
    ts_end: datetime
    payload_json: dict[str, Any] = field(default_factory=dict)
    explanation: str = ""


def telemetry_context(reading: dict[str, Any]) -> dict[str, Any]:
    """Keep only real telemetry fields useful for explaining and replaying an event."""

    fields = (
        "latitude",
        "longitude",
        "speed",
        "fsm_state",
        "route_id",
        "m_current_route_name",
        "is_loc_converged",
        "m_warn_level",
        "m_danger_obj_act",
        "m_trafficlight_act",
        "m_speed_limit_act",
    )
    return {field: reading[field] for field in fields if field in reading and reading[field] is not None}


class Detector(Protocol):
    def feed(self, reading: dict[str, Any]) -> list[Event]: ...

    def flush(self) -> list[Event]: ...