from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    projects: Mapped[list[ProjectModel]] = relationship(back_populates="owner")


class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    owner: Mapped[UserModel | None] = relationship(back_populates="projects")
    files: Mapped[list[ProjectFileModel]] = relationship(back_populates="project", cascade="all, delete-orphan")


class TelemetryFileModel(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    readings_count: Mapped[int] = mapped_column(Integer, default=0)
    events_count: Mapped[int] = mapped_column(Integer, default=0)
    parse_errors_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    projects: Mapped[list[ProjectFileModel]] = relationship(back_populates="file", cascade="all, delete-orphan")
    readings: Mapped[list[ReadingModel]] = relationship(back_populates="file", cascade="all, delete-orphan")
    events: Mapped[list[EventModel]] = relationship(back_populates="file", cascade="all, delete-orphan")
    parse_errors: Mapped[list[ParseErrorModel]] = relationship(back_populates="file", cascade="all, delete-orphan")


class ProjectFileModel(Base):
    __tablename__ = "project_files"
    __table_args__ = (UniqueConstraint("project_id", "file_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    project: Mapped[ProjectModel] = relationship(back_populates="files")
    file: Mapped[TelemetryFileModel] = relationship(back_populates="projects")


class ReadingModel(Base):
    __tablename__ = "readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    data_json: Mapped[dict] = mapped_column(JSON)
    file: Mapped[TelemetryFileModel] = relationship(back_populates="readings")


class EventModel(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    type: Mapped[str] = mapped_column(String(120), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    ts_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ts_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_json: Mapped[dict] = mapped_column(JSON)
    explanation: Mapped[str] = mapped_column(Text)
    file: Mapped[TelemetryFileModel] = relationship(back_populates="events")


class ParseErrorModel(Base):
    __tablename__ = "parse_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    record_number: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str] = mapped_column(Text)
    file: Mapped[TelemetryFileModel] = relationship(back_populates="parse_errors")