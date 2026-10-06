"""Split a concatenated JSON stream into complete objects."""

from __future__ import annotations

import io
from collections.abc import Iterator
from typing import TextIO


class IncompleteJSONError(ValueError):
    """Raised when the input ends while an object is still open."""

    def __init__(self, line: int, fragment: str) -> None:
        super().__init__(f"incomplete JSON object at line {line}")
        self.line = line
        self.fragment = fragment


def iter_json_objects(stream: TextIO, chunk_size: int = 64 * 1024) -> Iterator[str]:
    """Yield JSON object texts while ignoring comments outside string literals."""

    buffer: list[str] = []
    depth = 0
    in_string = False
    escaped = False
    in_comment = False
    line = 1
    object_line = 1
    previous_char = ""

    while True:
        chunk = stream.read(chunk_size)
        if not chunk:
            break
        for char in chunk:
            if char == "\n":
                line += 1

            if in_comment:
                if char == "\n":
                    in_comment = False
                continue

            if in_string:
                buffer.append(char)
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                previous_char = char
                continue

            if char == '"':
                in_string = True
                buffer.append(char)
            elif char == "/" and previous_char == "/":
                if buffer and buffer[-1] == "/":
                    buffer.pop()
                in_comment = True
            elif char == "{" and depth == 0:
                object_line = line
                depth = 1
                buffer = [char]
            elif depth:
                buffer.append(char)
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        yield "".join(buffer)
                        buffer = []
            previous_char = char

    if depth:
        raise IncompleteJSONError(object_line, "".join(buffer))


def objects_from_text(text: str) -> list[str]:
    """Convenience adapter used by focused parser tests."""

    return list(iter_json_objects(io.StringIO(text)))