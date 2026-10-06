from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from detectors.adas import AdasDetector
from detectors.base import Detector, Event
from detectors.brakes import BrakeDetector
from detectors.localization import LocalizationDetector
from detectors.services import ServiceDetector
from detectors.state import FsmDetector, RouteDetector, TelemetryGapDetector, WarningDetector


class EventEngine:
    def __init__(self, detectors: Iterable[Detector] | None = None) -> None:
        self.detectors = list(
            detectors
            or (
                BrakeDetector(),
                AdasDetector(),
                LocalizationDetector(),
                ServiceDetector(),
                WarningDetector(),
                FsmDetector(),
                RouteDetector(),
                TelemetryGapDetector(),
            )
        )

    def feed(self, reading: dict[str, Any]) -> list[Event]:
        events: list[Event] = []
        for detector in self.detectors:
            events.extend(detector.feed(reading))
        return events

    def flush(self) -> list[Event]:
        events: list[Event] = []
        for detector in self.detectors:
            events.extend(detector.flush())
        return events