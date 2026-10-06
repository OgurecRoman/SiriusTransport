from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

from parser import parse_file
from services.event_engine import EventEngine


ROOT = Path(__file__).resolve().parents[2]
UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


class FileSummary(BaseModel):
    id: UUID
    name: str
    status: str
    readings_count: int = 0
    events_count: int = 0
    parse_errors_count: int = 0


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: str
    severity: str
    ts_start: datetime
    ts_end: datetime
    payload_json: dict
    explanation: str


class FileStore:
    def __init__(self) -> None:
        self._files: dict[UUID, FileSummary] = {}
        self._readings: dict[UUID, list[dict]] = {}
        self._events: dict[UUID, list[EventResponse]] = {}
        self._lock = Lock()

    def add(self, file_id: UUID, name: str) -> FileSummary:
        summary = FileSummary(id=file_id, name=name, status="queued")
        with self._lock:
            self._files[file_id] = summary
        return summary

    def parse(self, file_id: UUID, path: Path) -> None:
        with self._lock:
            self._files[file_id].status = "parsing"
        result = parse_file(path)
        engine = EventEngine()
        events = [event for reading in result.readings for event in engine.feed(reading)]
        events.extend(engine.flush())
        with self._lock:
            self._readings[file_id] = result.readings
            self._events[file_id] = [EventResponse.model_validate(event) for event in events]
            self._files[file_id] = self._files[file_id].model_copy(
                update={
                    "status": "ready",
                    "readings_count": len(result.readings),
                    "events_count": len(events),
                    "parse_errors_count": len(result.parse_errors),
                }
            )

    def file(self, file_id: UUID) -> FileSummary:
        try:
            return self._files[file_id]
        except KeyError as error:
            raise HTTPException(status_code=404, detail="file not found") from error


store = FileStore()
app = FastAPI(title="Tram Telemetry API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/files", response_model=FileSummary, status_code=202)
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> FileSummary:
    file_id = uuid4()
    destination = UPLOAD_DIR / f"{file_id}.jsonseq"
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    summary = store.add(file_id, file.filename or destination.name)
    background_tasks.add_task(store.parse, file_id, destination)
    return summary


@app.get("/api/files", response_model=list[FileSummary])
def list_files() -> list[FileSummary]:
    return list(store._files.values())


@app.get("/api/files/{file_id}", response_model=FileSummary)
def get_file(file_id: UUID) -> FileSummary:
    return store.file(file_id)


@app.get("/api/files/{file_id}/sessions")
def get_sessions(file_id: UUID) -> list[dict]:
    store.file(file_id)
    return []


@app.get("/api/files/{file_id}/events", response_model=list[EventResponse])
def get_file_events(file_id: UUID, event_type: str | None = None, severity: str | None = None) -> list[EventResponse]:
    store.file(file_id)
    events = store._events.get(file_id, [])
    return [event for event in events if (event_type is None or event.type == event_type) and (severity is None or event.severity == severity)]


@app.get("/api/files/{file_id}/context", response_model=list[dict])
def get_context(file_id: UUID, at: datetime, before: float = 30, after: float = 30) -> list[dict]:
    """Return the readings around an event for map and motion replay."""

    store.file(file_id)
    if before < 0 or after < 0 or before > 300 or after > 300:
        raise HTTPException(status_code=400, detail="context window must be between 0 and 300 seconds")
    readings = store._readings.get(file_id, [])
    start = at.timestamp() - before
    end = at.timestamp() + after
    return [
        reading
        for reading in readings
        if isinstance(reading.get("timestamp"), datetime)
        and start <= reading["timestamp"].timestamp() <= end
    ]


@app.get("/api/events/{file_id}/{event_index}", response_model=EventResponse)
def get_event(file_id: UUID, event_index: int) -> EventResponse:
    events = get_file_events(file_id)
    try:
        return events[event_index]
    except IndexError as error:
        raise HTTPException(status_code=404, detail="event not found") from error


@app.get("/api/readings", response_model=list[dict])
def get_readings(file_id: UUID, limit: int = 100, offset: int = 0) -> list[dict]:
    store.file(file_id)
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    return store._readings.get(file_id, [])[offset : offset + limit]


@app.get("/api/readings/{file_id}/{reading_index}", response_model=dict)
def get_reading(file_id: UUID, reading_index: int) -> dict:
    readings = get_readings(file_id, limit=1000)
    try:
        return readings[reading_index]
    except IndexError as error:
        raise HTTPException(status_code=404, detail="reading not found") from error