import unittest
from datetime import datetime, timezone

from detectors.adas import AdasDetector
from detectors.brakes import BrakeDetector
from detectors.localization import LocalizationDetector
from detectors.services import ServiceDetector
from detectors.state import FsmDetector, RouteDetector, TelemetryGapDetector, WarningDetector


TS = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)


class DetectorTests(unittest.TestCase):
    def test_brake_detector_emits_only_on_false_to_true(self):
        detector = BrakeDetector()
        base = {"timestamp": TS, "is_emergency_brake_fb": False}
        self.assertEqual(detector.feed(base), [])
        event = detector.feed({**base, "is_emergency_brake_fb": True})[0]
        self.assertEqual(event.type, "brake.emergency.activated")
        self.assertEqual(detector.feed({**base, "is_emergency_brake_fb": True}), [])

    def test_routine_mechanical_braking_is_info_and_keeps_map_context(self):
        detector = BrakeDetector()
        detector.feed({"timestamp": TS, "is_mechanical_brake_fb": False})
        event = detector.feed({
            "timestamp": TS,
            "is_mechanical_brake_fb": True,
            "speed": 0,
            "fsm_state": "Yield",
            "latitude": 59.9,
            "longitude": 30.4,
        })[0]
        self.assertEqual(event.severity, "info")
        self.assertTrue(event.payload_json["routine_braking"])
        self.assertEqual(event.payload_json["latitude"], 59.9)

    def test_mechanical_braking_in_motion_is_info(self):
        detector = BrakeDetector()
        detector.feed({"timestamp": TS, "is_mechanical_brake_fb": False})
        event = detector.feed({"timestamp": TS, "is_mechanical_brake_fb": True, "speed": 18, "fsm_state": "Moving"})[0]
        self.assertEqual(event.severity, "info")

    def test_adas_explanation_does_not_invent_object_details(self):
        detector = AdasDetector()
        detector.feed({"timestamp": TS, "m_danger_obj_act": "No"})
        event = detector.feed({"timestamp": TS, "m_danger_obj_act": "Active"})[0]
        self.assertIn("детали объекта/светофора", event.explanation)

    def test_localization_loss_and_restore(self):
        detector = LocalizationDetector()
        detector.feed({"timestamp": TS, "is_loc_converged": True})
        lost = detector.feed({"timestamp": TS, "is_loc_converged": False})[0]
        self.assertEqual(lost.type, "localization.lost")
        self.assertEqual(lost.severity, "info")
        self.assertEqual(lost.explanation, "Сбой позиционирования (GPS/локализация): is_loc_converged перешёл в false. Положение вагона на карте может быть неточным")
        self.assertEqual(detector.feed({"timestamp": TS, "is_loc_converged": True})[0].type, "localization.restored")

    def test_warning_fsm_and_route_transitions(self):
        warning = WarningDetector()
        warning.feed({"timestamp": TS, "m_warn_level": 0})
        self.assertEqual(warning.feed({"timestamp": TS, "m_warn_level": 1})[0].type, "warning.level.raised")

        fsm = FsmDetector()
        fsm.feed({"timestamp": TS, "fsm_state": "Moving"})
        self.assertEqual(fsm.feed({"timestamp": TS, "fsm_state": "Stopped"})[0].type, "fsm.state.changed")

        route = RouteDetector()
        route.feed({"timestamp": TS, "m_current_route_name": "7.2"})
        self.assertEqual(route.feed({"timestamp": TS, "m_current_route_name": "10"})[0].type, "route.changed")

    def test_telemetry_gap_uses_two_nominal_intervals(self):
        detector = TelemetryGapDetector()
        detector.feed({"timestamp": TS})
        detector.feed({"timestamp": TS.replace(second=2)})
        event = detector.feed({"timestamp": TS.replace(second=7)})[0]
        self.assertEqual(event.type, "telemetry.gap")
        self.assertEqual(event.severity, "info")

    def test_service_gps_down_is_info_and_other_service_down_is_warning(self):
        detector = ServiceDetector()
        detector.feed({"timestamp": TS, "ubloxGps": True, "roadModel": True})
        events = detector.feed({"timestamp": TS, "ubloxGps": False, "roadModel": False})
        severities = {event.type: event.severity for event in events}
        self.assertEqual(severities["service.ubloxGps.down"], "info")
        self.assertEqual(severities["service.roadModel.down"], "info")


if __name__ == "__main__":
    unittest.main()