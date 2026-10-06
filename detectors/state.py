from __future__ import annotations

from datetime import datetime
from typing import Any

from .base import Event, telemetry_context


class WarningDetector:
    def __init__(self) -> None:
        self._previous: int | float | None = None

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        current = reading.get("m_warn_level")
        if not isinstance(timestamp, datetime) or not isinstance(current, (int, float)):
            return []
        event = None
        if current > 0 and (self._previous is None or self._previous <= 0):
            event = Event(
                "warning.level.raised",
                "warning",
                timestamp,
                timestamp,
                {"m_warn_level": current, **telemetry_context(reading)},
                f"Уровень предупреждения вырос выше нуля: m_warn_level={current}.",
            )
        self._previous = current
        return [] if event is None else [event]

    def flush(self) -> list[Event]:
        return []


class FsmDetector:
    def __init__(self) -> None:
        self._previous: Any = None

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        current = reading.get("fsm_state")
        if not isinstance(timestamp, datetime) or current is None:
            return []
        event = None
        if self._previous is not None and current != self._previous:
            event = Event(
                "fsm.state.changed",
                "info",
                timestamp,
                timestamp,
                {"from": self._previous, "to": current, **telemetry_context(reading)},
                f"Состояние FSM изменилось: {self._previous} -> {current}.",
            )
        self._previous = current
        return [] if event is None else [event]

    def flush(self) -> list[Event]:
        return []


class RouteDetector:
    def __init__(self) -> None:
        self._previous: Any = None

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        current = reading.get("m_current_route_name")
        if current is None:
            current = reading.get("route_id")
        if not isinstance(timestamp, datetime) or current is None:
            return []
        event = None
        if self._previous is not None and current != self._previous:
            event = Event(
                "route.changed",
                "info",
                timestamp,
                timestamp,
                {"from": self._previous, "to": current, **telemetry_context(reading)},
                f"Изменился текущий маршрут: {self._previous} -> {current}.",
            )
        self._previous = current
        return [] if event is None else [event]

    def flush(self) -> list[Event]:
        return []


class TelemetryGapDetector:
    def __init__(self) -> None:
        self._previous: datetime | None = None
        self._nominal_seconds: float | None = None

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        timestamp = reading.get("timestamp")
        if not isinstance(timestamp, datetime):
            return []
        if self._previous is None:
            self._previous = timestamp
            return []
        interval = (timestamp - self._previous).total_seconds()
        self._previous = timestamp
        if interval <= 0:
            return []
        if self._nominal_seconds is None:
            self._nominal_seconds = interval
            return []
        if interval > 2 * self._nominal_seconds:
            return [
                Event(
                    "telemetry.gap",
                    "warning",
                    self._previous,
                    timestamp,
                    {"interval_seconds": interval, "nominal_seconds": self._nominal_seconds},
                    f"Разрыв телеметрии: интервал {interval:g} с превышает два номинальных интервала.",
                )
            ]
        self._nominal_seconds = (self._nominal_seconds + interval) / 2
        return []

    def flush(self) -> list[Event]:
        return []