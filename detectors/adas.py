from __future__ import annotations

from datetime import datetime
from typing import Any

from .base import Event, telemetry_context


class AdasDetector:
    _FLAGS = {
        "m_danger_obj_act": "adas.danger_object.activated",
        "m_trafficlight_act": "adas.traffic_light.activated",
        "m_speed_limit_act": "adas.speed_limit.activated",
    }

    def __init__(self) -> None:
        self._previous: dict[str, Any] = {}

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        if not isinstance(timestamp, datetime):
            return []
        events: list[Event] = []
        for field, event_type in self._FLAGS.items():
            current = reading.get(field)
            if current not in (None, "No", False) and self._previous.get(field) in (None, "No", False):
                events.append(Event(event_type, "warning", timestamp, timestamp, {field: current, **telemetry_context(reading)}, "ADAS-флаг активирован, детали объекта/светофора в телеметрии отсутствуют."))
            self._previous[field] = current
        return events

    def flush(self) -> list[Event]:
        return []