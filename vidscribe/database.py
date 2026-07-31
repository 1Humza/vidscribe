import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from vidscribe.models import ResolvedSessionIntake, SessionView


class SessionRepository:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _migrate(self) -> None:
        with self.connection() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    source_path TEXT NOT NULL,
                    destination_path TEXT NOT NULL,
                    extra_instructions TEXT NOT NULL,
                    extraction_options TEXT NOT NULL,
                    analysis_audio_path TEXT,
                    transcript TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analysis_attempts (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    model TEXT NOT NULL,
                    effort TEXT NOT NULL,
                    raw_stream TEXT NOT NULL DEFAULT '',
                    result TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def create(self, request: ResolvedSessionIntake) -> SessionView:
        session_id = str(uuid4())
        now = datetime.now(UTC).isoformat()
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO sessions (
                    id, status, stage, progress, source_path, destination_path,
                    extra_instructions, extraction_options, created_at, updated_at
                ) VALUES (?, 'ready', 'intake', 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    str(Path(request.source_path).resolve()),
                    str(Path(request.destination_path).resolve()),
                    request.extra_instructions,
                    request.extraction_options.model_dump_json(),
                    now,
                    now,
                ),
            )
        return self.get(session_id)

    def get(self, session_id: str) -> SessionView:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if row is None:
                raise KeyError(session_id)
            attempts = connection.execute(
                "SELECT * FROM analysis_attempts WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            ).fetchall()
        payload = dict(row)
        payload["extraction_options"] = json.loads(payload["extraction_options"])
        payload["attempts"] = [
            {
                **dict(attempt),
                "result": json.loads(attempt["result"]) if attempt["result"] else None,
            }
            for attempt in attempts
        ]
        return SessionView.model_validate(payload)

    def update_session(self, session_id: str, **changes: object) -> SessionView:
        allowed = {
            "status",
            "stage",
            "progress",
            "analysis_audio_path",
            "transcript",
        }
        unexpected = set(changes) - allowed
        if unexpected:
            raise ValueError(f"Unsupported Session fields: {sorted(unexpected)}")
        if not changes:
            return self.get(session_id)
        changes["updated_at"] = datetime.now(UTC).isoformat()
        assignments = ", ".join(f"{field} = ?" for field in changes)
        with self.connection() as connection:
            cursor = connection.execute(
                f"UPDATE sessions SET {assignments} WHERE id = ?",
                (*changes.values(), session_id),
            )
            if cursor.rowcount == 0:
                raise KeyError(session_id)
        return self.get(session_id)

    def create_attempt(self, session_id: str, model: str, effort: str) -> str:
        attempt_id = str(uuid4())
        now = datetime.now(UTC).isoformat()
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO analysis_attempts (
                    id, session_id, status, model, effort, created_at, updated_at
                ) VALUES (?, ?, 'streaming', ?, ?, ?, ?)
                """,
                (attempt_id, session_id, model, effort, now, now),
            )
        return attempt_id

    def append_attempt_stream(self, attempt_id: str, chunk: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE analysis_attempts
                SET raw_stream = raw_stream || ?, updated_at = ?
                WHERE id = ?
                """,
                (chunk, datetime.now(UTC).isoformat(), attempt_id),
            )

    def complete_attempt(self, attempt_id: str, result_json: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE analysis_attempts
                SET status = 'completed', result = ?, error = NULL, updated_at = ?
                WHERE id = ?
                """,
                (result_json, datetime.now(UTC).isoformat(), attempt_id),
            )

    def fail_attempt(self, attempt_id: str, message: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE analysis_attempts
                SET status = 'error', error = ?, updated_at = ?
                WHERE id = ?
                """,
                (message, datetime.now(UTC).isoformat(), attempt_id),
            )
