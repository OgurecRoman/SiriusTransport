from __future__ import annotations

from datetime import datetime
from typing import Any

from .base import Event, telemetry_context


class BrakeDetector:
    _BRAKES = {
        "is_emergency_brake_fb": ("brake.emergency.activated", "critical", "экстренное"),
        "is_crash_brake_fb": ("brake.crash.activated", "critical", "аварийное"),
        "is_mechanical_brake_fb": ("brake.mechanical.activated", "info", "механическое"),
        "is_rail_brake_fb": ("brake.rail.activated", "info", "рельсовое"),
    }

    def __init__(self) -> None:
        self._previous: dict[str, bool] = {}
        self._last_event_at: dict[str, datetime] = {}

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        if not isinstance(timestamp, datetime):
            return []
        events: list[Event] = []
        for field, (event_type, severity, label) in self._BRAKES.items():
            current = reading.get(field) is True
            if current and self._previous.get(field) is not True:
                speed = reading.get("speed")
                fsm_state = reading.get("fsm_state")
                last_event_at = self._last_event_at.get(field)
                repeated = last_event_at is not None and (timestamp - last_event_at).total_seconds() < 60
                routine = field in {"is_mechanical_brake_fb", "is_rail_brake_fb"} and (
                    repeated or (isinstance(speed, (int, float)) and speed <= 2) or fsm_state in {"Yield", "Stopped", "Stop"}
                )
                event_severity = "info" if routine else severity
                payload = {field: True, "routine_braking": routine, **telemetry_context(reading)}
                explanation = (
                    f"Штатное {label} торможение: скорость {speed!s}, состояние FSM {fsm_state!s}."
                    if routine
                    else f"Нетипичное {label} торможение: флаг {field} перешёл в true при скорости {speed!s}."
                )
                events.append(Event(event_type, event_severity, timestamp, timestamp, payload, explanation))
                self._last_event_at[field] = timestamp
            self._previous[field] = current
        return events

    def flush(self) -> list[Event]:
        return []