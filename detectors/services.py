from __future__ import annotations

from datetime import datetime
from typing import Any

from .base import Event


class ServiceDetector:
    _SERVICES = ("ubloxGps", "tramSlaveVisor", "minsEth", "tramPlannerService", "leftImage", "t25Front", "dbwFbTram", "odoFbTram", "roadModel")

    def __init__(self) -> None:
        self._previous: dict[str, bool] = {}

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        if not isinstance(timestamp, datetime):
            return []
        events: list[Event] = []
        for service in self._SERVICES:
            current = reading.get(service)
            if not isinstance(current, bool):
                continue
            previous = self._previous.get(service)
            if previous is not None and previous != current:
                state = "поднят" if current else "отвалился"
                events.append(Event(f"service.{service}.{'up' if current else 'down'}", "info" if current else "warning", timestamp, timestamp, {service: current}, f"Сервис {service} {state}: значение изменилось с {previous} на {current}."))
            self._previous[service] = current
        return events

    def flush(self) -> list[Event]:
        return []