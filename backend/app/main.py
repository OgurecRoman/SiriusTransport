from __future__ import annotations

import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select

from parser import parse_file
from services.event_engine import EventEngine

from .db import SessionLocal, init_db
from .models import EventModel, ParseErrorModel, ProjectFileModel, ProjectModel, ReadingModel, TelemetryFileModel, UserModel


ROOT = Path(__file__).resolve().parents[2]
UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
init_db()


class FileSummary(BaseModel):
    id: UUID
    name: str
    status: str
    readings_count: int = 0
    events_count: int = 0
    parse_errors_count: int = 0
    format: str = "jsonseq"
    days: list[str] = []


class SeverityCounts(BaseModel):
    info: int = 0
    warning: int = 0
    critical: int = 0


class ProjectCreate(BaseModel):
    name: str


class ProjectSummary(BaseModel):
    id: UUID
    name: str
    file_ids: list[UUID] = []
    created_at: datetime


class ProjectStats(BaseModel):
    project_id: UUID
    files_count: int
    readings_count: int
    events_count: int
    severity_counts: SeverityCounts
    days: list[str] = []


class AuthCredentials(BaseModel):
    email: str
    password: str
    name: str = ""


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: str
    file_id: UUID | None = None
    severity: str
    ts_start: datetime
    ts_end: datetime
    payload_json: dict
    explanation: str


tokens: dict[str, str] = {}


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _days_for_file(db, file_id: str) -> list[str]:
    values = db.scalars(select(ReadingModel.timestamp).where(ReadingModel.file_id == file_id, ReadingModel.timestamp.is_not(None))).all()
    return sorted({(_aware(value) or value).date().isoformat() for value in values})


def _summary(db, model: TelemetryFileModel) -> FileSummary:
    return FileSummary(
        id=UUID(model.id), name=model.name, status=model.status,
        readings_count=model.readings_count, events_count=model.events_count,
        parse_errors_count=model.parse_errors_count, format=model.format,
        days=_days_for_file(db, model.id),
    )


def _file_or_404(db, file_id: UUID) -> TelemetryFileModel:
    model = db.get(TelemetryFileModel, str(file_id))
    if model is None:
        raise HTTPException(status_code=404, detail="file not found")
    return model


def _event_response(event: EventModel) -> EventResponse:
    return EventResponse(
        type=event.type, file_id=UUID(event.file_id), severity=event.severity,
        ts_start=_aware(event.ts_start), ts_end=_aware(event.ts_end),
        payload_json=event.payload_json, explanation=event.explanation,
    )


def parse_uploaded_file(file_id: UUID, path: Path) -> None:
    with SessionLocal() as db:
        model = _file_or_404(db, file_id)
        model.status = "parsing"
        db.commit()
        result = parse_file(path)
        engine = EventEngine()
        events = [event for reading in result.readings for event in engine.feed(reading)]
        events.extend(engine.flush())
        db.execute(delete(ReadingModel).where(ReadingModel.file_id == str(file_id)))
        db.execute(delete(EventModel).where(EventModel.file_id == str(file_id)))
        db.execute(delete(ParseErrorModel).where(ParseErrorModel.file_id == str(file_id)))
        db.add_all(
            ReadingModel(file_id=str(file_id), timestamp=_aware(reading.get("timestamp")), data_json=_json_safe(reading))
            for reading in result.readings
        )
        db.add_all(
            EventModel(file_id=str(file_id), type=event.type, severity=event.severity,
                       ts_start=_aware(event.ts_start), ts_end=_aware(event.ts_end),
                       payload_json=_json_safe(event.payload_json), explanation=event.explanation)
            for event in events
        )
        db.add_all(
            ParseErrorModel(file_id=str(file_id), record_number=error.get("record"), error=error["error"])
            for error in result.parse_errors
        )
        model.status = "ready"
        model.readings_count = len(result.readings)
        model.events_count = len(events)
        model.parse_errors_count = len(result.parse_errors)
        db.commit()


app = FastAPI(title="Tram Telemetry API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)


@app.post("/api/files", response_model=FileSummary, status_code=202)
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> FileSummary:
    file_id = uuid4()
    file_format = "csv" if Path(file.filename or "").suffix.lower() == ".csv" else "jsonseq"
    destination = UPLOAD_DIR / f"{file_id}.{file_format}"
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    with SessionLocal() as db:
        model = TelemetryFileModel(id=str(file_id), name=file.filename or destination.name,
                                   path=str(destination), format=file_format)
        db.add(model)
        db.commit()
        db.refresh(model)
        summary = _summary(db, model)
    background_tasks.add_task(parse_uploaded_file, file_id, destination)
    return summary


@app.get("/api/files", response_model=list[FileSummary])
def list_files() -> list[FileSummary]:
    with SessionLocal() as db:
        models = db.scalars(select(TelemetryFileModel).order_by(TelemetryFileModel.created_at.desc())).all()
        return [_summary(db, model) for model in models]


@app.get("/api/files/{file_id}", response_model=FileSummary)
def get_file(file_id: UUID) -> FileSummary:
    with SessionLocal() as db:
        return _summary(db, _file_or_404(db, file_id))


@app.get("/api/files/{file_id}/sessions")
def get_sessions(file_id: UUID) -> list[dict]:
    with SessionLocal() as db:
        _file_or_404(db, file_id)
    return []


@app.get("/api/files/{file_id}/events", response_model=list[EventResponse])
def get_file_events(file_id: UUID, event_type: str | None = None,
                    severity: str | None = None, day: str | None = None) -> list[EventResponse]:
    with SessionLocal() as db:
        _file_or_404(db, file_id)
        query = select(EventModel).where(EventModel.file_id == str(file_id)).order_by(EventModel.ts_start)
        if event_type:
            query = query.where(EventModel.type == event_type)
        if severity:
            query = query.where(EventModel.severity == severity)
        events = db.scalars(query).all()
        if day:
            events = [event for event in events if (_aware(event.ts_start) or event.ts_start).date().isoformat() == day]
        return [_event_response(event) for event in events]


@app.get("/api/projects/{project_id}/events", response_model=list[EventResponse])
def get_project_events(project_id: UUID, severity: str | None = None, day: str | None = None) -> list[EventResponse]:
    with SessionLocal() as db:
        project = db.get(ProjectModel, str(project_id))
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        file_ids = [link.file_id for link in project.files]
        query = select(EventModel).where(EventModel.file_id.in_(file_ids)).order_by(EventModel.ts_start) if file_ids else select(EventModel).where(False)
        if severity:
            query = query.where(EventModel.severity == severity)
        events = db.scalars(query).all()
        if day:
            events = [event for event in events if (_aware(event.ts_start) or event.ts_start).date().isoformat() == day]
        return [_event_response(event) for event in events]


@app.get("/api/files/{file_id}/severity-counts", response_model=SeverityCounts)
def get_severity_counts(file_id: UUID, day: str | None = None) -> SeverityCounts:
    events = get_file_events(file_id, day=day)
    counts = {"info": 0, "warning": 0, "critical": 0}
    for event in events:
        if event.severity in counts:
            counts[event.severity] += 1
    return SeverityCounts(**counts)


@app.get("/api/files/{file_id}/context", response_model=list[dict])
def get_context(file_id: UUID, at: datetime, before: float = 30, after: float = 30) -> list[dict]:
    if before < 0 or after < 0 or before > 300 or after > 300:
        raise HTTPException(status_code=400, detail="context window must be between 0 and 300 seconds")
    with SessionLocal() as db:
        _file_or_404(db, file_id)
        start, end = at.timestamp() - before, at.timestamp() + after
        readings = db.scalars(select(ReadingModel).where(ReadingModel.file_id == str(file_id), ReadingModel.timestamp.is_not(None))).all()
        return [reading.data_json for reading in readings if start <= (_aware(reading.timestamp) or reading.timestamp).timestamp() <= end]


@app.get("/api/events/{file_id}/{event_index}", response_model=EventResponse)
def get_event(file_id: UUID, event_index: int) -> EventResponse:
    events = get_file_events(file_id)
    try:
        return events[event_index]
    except IndexError as error:
        raise HTTPException(status_code=404, detail="event not found") from error


@app.get("/api/readings", response_model=list[dict])
def get_readings(file_id: UUID, limit: int = 100, offset: int = 0) -> list[dict]:
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    with SessionLocal() as db:
        _file_or_404(db, file_id)
        return list(db.scalars(select(ReadingModel.data_json).where(ReadingModel.file_id == str(file_id)).offset(offset).limit(limit)).all())


@app.get("/api/readings/{file_id}/{reading_index}", response_model=dict)
def get_reading(file_id: UUID, reading_index: int) -> dict:
    readings = get_readings(file_id, limit=1, offset=reading_index)
    if not readings:
        raise HTTPException(status_code=404, detail="reading not found")
    return readings[0]


def _password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


@app.post("/api/auth/register", response_model=UserResponse, status_code=201)
def register(credentials: AuthCredentials) -> UserResponse:
    with SessionLocal() as db:
        if db.scalar(select(UserModel).where(UserModel.email == credentials.email)):
            raise HTTPException(status_code=409, detail="account already exists")
        user = UserModel(email=credentials.email, name=credentials.name or credentials.email.split("@")[0], password_hash=_password_hash(credentials.password))
        db.add(user)
        db.commit()
        db.refresh(user)
        return UserResponse(id=UUID(user.id), email=user.email, name=user.name)


@app.post("/api/auth/login")
def login(credentials: AuthCredentials) -> dict[str, str | UserResponse]:
    with SessionLocal() as db:
        user = db.scalar(select(UserModel).where(UserModel.email == credentials.email))
        if user is None or user.password_hash != _password_hash(credentials.password):
            raise HTTPException(status_code=401, detail="invalid credentials")
        response = UserResponse(id=UUID(user.id), email=user.email, name=user.name)
        user_id = user.id
    token = str(uuid4())
    tokens[token] = user_id
    return {"token": token, "user": response}


@app.get("/api/auth/me", response_model=UserResponse)
def current_user(authorization: str | None = Header(default=None)) -> UserResponse:
    user_id = tokens.get(authorization.removeprefix("Bearer ") if authorization else "")
    with SessionLocal() as db:
        user = db.get(UserModel, user_id) if user_id else None
        if user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        return UserResponse(id=UUID(user.id), email=user.email, name=user.name)


@app.post("/api/projects", response_model=ProjectSummary, status_code=201)
def create_project(project: ProjectCreate) -> ProjectSummary:
    with SessionLocal() as db:
        model = ProjectModel(name=project.name)
        db.add(model)
        db.commit()
        db.refresh(model)
        return ProjectSummary(id=UUID(model.id), name=model.name, created_at=model.created_at, file_ids=[])


@app.get("/api/projects", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    with SessionLocal() as db:
        models = db.scalars(select(ProjectModel).order_by(ProjectModel.created_at.desc())).all()
        return [ProjectSummary(id=UUID(project.id), name=project.name, created_at=project.created_at, file_ids=[UUID(link.file_id) for link in project.files]) for project in models]


@app.post("/api/projects/{project_id}/files/{file_id}", response_model=ProjectSummary)
def add_project_file(project_id: UUID, file_id: UUID) -> ProjectSummary:
    with SessionLocal() as db:
        project = db.get(ProjectModel, str(project_id))
        _file_or_404(db, file_id)
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        exists = db.scalar(select(ProjectFileModel).where(ProjectFileModel.project_id == str(project_id), ProjectFileModel.file_id == str(file_id)))
        if exists is None:
            db.add(ProjectFileModel(project_id=str(project_id), file_id=str(file_id)))
            db.commit()
        db.refresh(project)
        return ProjectSummary(id=UUID(project.id), name=project.name, created_at=project.created_at, file_ids=[UUID(link.file_id) for link in project.files])


@app.get("/api/projects/{project_id}/stats", response_model=ProjectStats)
def project_stats(project_id: UUID, day: str | None = None) -> ProjectStats:
    with SessionLocal() as db:
        project = db.get(ProjectModel, str(project_id))
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        file_ids = [link.file_id for link in project.files]
        events = db.scalars(select(EventModel).where(EventModel.file_id.in_(file_ids))).all() if file_ids else []
        if day:
            events = [event for event in events if (_aware(event.ts_start) or event.ts_start).date().isoformat() == day]
        readings_count = db.scalar(select(func.count(ReadingModel.id)).where(ReadingModel.file_id.in_(file_ids))) if file_ids else 0
        counts = {"info": 0, "warning": 0, "critical": 0}
        for event in events:
            if event.severity in counts:
                counts[event.severity] += 1
        timestamps = db.scalars(select(ReadingModel.timestamp).where(ReadingModel.file_id.in_(file_ids), ReadingModel.timestamp.is_not(None))).all() if file_ids else []
        days = sorted({(_aware(timestamp) or timestamp).date().isoformat() for timestamp in timestamps})
        return ProjectStats(project_id=project_id, files_count=len(file_ids), readings_count=readings_count or 0, events_count=len(events), severity_counts=SeverityCounts(**counts), days=days)
