from __future__ import annotations

from datetime import datetime
from typing import Any

from .base import Event, telemetry_context


class LocalizationDetector:
    def __init__(self) -> None:
        self._previous: bool | None = None

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        current = reading.get("is_loc_converged")
        if not isinstance(timestamp, datetime) or not isinstance(current, bool):
            return []
        event = None
        if self._previous is True and current is False:
            event = Event("localization.lost", "warning", timestamp, timestamp, {"is_loc_converged": False, **telemetry_context(reading)}, "Локализация потеряна: is_loc_converged перешёл в false.")
        elif self._previous is False and current is True:
            event = Event("localization.restored", "info", timestamp, timestamp, {"is_loc_converged": True, **telemetry_context(reading)}, "Локализация восстановлена: is_loc_converged перешёл в true.")
        self._previous = current
        return [] if event is None else [event]

    def flush(self) -> list[Event]:
        return []