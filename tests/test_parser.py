import os
import tempfile
import unittest
from datetime import datetime
from io import StringIO

from parser.loader import parse_file
from parser.normalizer import decode_and_normalize
from parser.tokenizer import IncompleteJSONError, iter_json_objects, objects_from_text


class TokenizerTests(unittest.TestCase):
    def test_comments_and_braces_in_strings_are_preserved(self):
        text = '{"note":"http://tram/{ok}", "value": "1"} // comment\n {"x": 2}'
        objects = objects_from_text(text)
        self.assertEqual(len(objects), 2)
        self.assertIn("http://tram/{ok}", objects[0])

    def test_incomplete_object_is_reported(self):
        with self.assertRaises(IncompleteJSONError):
            list(iter_json_objects(StringIO('{"x": 1')))


class NormalizerTests(unittest.TestCase):
    def test_empty_is_none_and_timestamp_is_aware(self):
        record = decode_and_normalize(
            '{"empty":"", "enabled":"false", "speed":"1.5", '
            '"timestamp":"2026-09-27T15:10:59.800+03:00"}'
        )
        self.assertIsNone(record["empty"])
        self.assertIs(record["enabled"], False)
        self.assertEqual(record["speed"], 1.5)
        self.assertIsNotNone(record["timestamp"].tzinfo)


class LoaderTests(unittest.TestCase):
    def test_duplicate_timestamps_and_truncated_tail(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonseq", delete=False, encoding="utf-8") as fixture:
            path = fixture.name
            fixture.write(
                '{"timestamp":"2026-09-27T15:10:59+03:00", "speed":"0"}\n'
                '{"timestamp":"2026-09-27T15:10:59+03:00", "speed":"1"}\n'
                '{"timestamp":"2026-09-27T15:11:00+03:00"'
            )
        try:
            result = parse_file(path)
        finally:
            os.remove(path)
        self.assertEqual(len(result.readings), 2)
        self.assertFalse(result.readings[0]["is_duplicate_ts"])
        self.assertTrue(result.readings[1]["is_duplicate_ts"])
        self.assertEqual(len(result.parse_errors), 1)
        self.assertIsInstance(result.readings[0]["timestamp"], datetime)


if __name__ == "__main__":
    unittest.main()