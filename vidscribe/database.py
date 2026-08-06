import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from vidscribe.models import AnalysisResult, ResolvedSessionIntake, SessionView


@dataclass(frozen=True)
class CommitClaim:
    session: SessionView
    resumes_finalization: bool
    cross_volume: bool | None = None


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
                    source_fingerprint TEXT,
                    destination_path TEXT NOT NULL,
                    extra_instructions TEXT NOT NULL,
                    speaker_hints TEXT NOT NULL DEFAULT '[]',
                    extraction_options TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
                    effort TEXT NOT NULL DEFAULT 'medium',
                    analysis_audio_path TEXT,
                    transcript TEXT,
                    session_date TEXT,
                    session_time TEXT NOT NULL DEFAULT '00:00:00',
                    attachment_paths TEXT NOT NULL DEFAULT '[]',
                    transcript_word_timings TEXT NOT NULL DEFAULT '[]',
                    completed_folder_path TEXT,
                    finalizing_attempt_id TEXT,
                    finalizing_service_id TEXT,
                    finalizing_cross_volume INTEGER,
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
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(sessions)")
            }
            if "session_date" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN session_date TEXT")
            if "session_time" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN session_time TEXT NOT NULL DEFAULT '00:00:00'")
            if "model" not in columns:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT 'gemini-3-flash-preview'"
                )
            if "effort" not in columns:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'medium'"
                )
            if "source_fingerprint" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN source_fingerprint TEXT")
            if "attachment_paths" not in columns:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN attachment_paths TEXT NOT NULL DEFAULT '[]'"
                )
            if "speaker_hints" not in columns:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN speaker_hints TEXT NOT NULL DEFAULT '[]'"
                )
            if "transcript_word_timings" not in columns:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN transcript_word_timings TEXT NOT NULL DEFAULT '[]'"
                )
            if "completed_folder_path" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN completed_folder_path TEXT")
            if "finalizing_attempt_id" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN finalizing_attempt_id TEXT")
            if "finalizing_service_id" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN finalizing_service_id TEXT")
            if "finalizing_cross_volume" not in columns:
                connection.execute("ALTER TABLE sessions ADD COLUMN finalizing_cross_volume INTEGER")
            connection.execute(
                "CREATE INDEX IF NOT EXISTS sessions_source_fingerprint ON sessions(source_fingerprint)"
            )

    def create(self, request: ResolvedSessionIntake) -> SessionView:
        now = datetime.now(UTC).isoformat()
        with self.connection() as connection:
            existing = connection.execute(
                "SELECT id, status FROM sessions WHERE source_fingerprint = ? ORDER BY updated_at DESC LIMIT 1",
                (request.source_fingerprint,),
            ).fetchone()
            if existing is not None:
                session_id = existing["id"]
                if existing["status"] != "completed":
                    connection.execute(
                        "UPDATE sessions SET source_path = ?, updated_at = ? WHERE id = ?",
                        (str(Path(request.source_path).resolve()), now, session_id),
                    )
            else:
                session_id = str(uuid4())
                connection.execute(
                    """
                    INSERT INTO sessions (
                        id, status, stage, progress, source_path, source_fingerprint, destination_path,
                        extra_instructions, speaker_hints, extraction_options, model, effort, session_date, session_time, attachment_paths, created_at, updated_at
                    ) VALUES (?, 'ready', 'intake', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        str(Path(request.source_path).resolve()),
                        request.source_fingerprint,
                        str(Path(request.destination_path).resolve()),
                        request.extra_instructions,
                        json.dumps(request.speaker_hints),
                        request.extraction_options.model_dump_json(),
                        request.model,
                        request.effort,
                        request.session_date.isoformat(),
                        datetime.now().time().replace(microsecond=0).isoformat(),
                        json.dumps(request.attachment_paths),
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
        payload["speaker_hints"] = json.loads(payload["speaker_hints"])
        payload["attachment_paths"] = json.loads(payload["attachment_paths"])
        payload["transcript_word_timings"] = json.loads(payload["transcript_word_timings"])
        payload["attempts"] = [
            {
                **dict(attempt),
                "result": json.loads(attempt["result"]) if attempt["result"] else None,
            }
            for attempt in attempts
        ]
        return SessionView.model_validate(payload)

    def get_by_completed_folder(self, folder_path: Path) -> SessionView:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id FROM sessions WHERE completed_folder_path = ?",
                (str(folder_path.resolve()),),
            ).fetchone()
        if row is None:
            raise KeyError(str(folder_path))
        return self.get(row["id"])

    def get_by_source_fingerprint(self, fingerprint: str, source_path: Path) -> SessionView:
        now = datetime.now(UTC).isoformat()
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id, status FROM sessions WHERE source_fingerprint = ? ORDER BY updated_at DESC LIMIT 1",
                (fingerprint,),
            ).fetchone()
            if row is None:
                raise KeyError(fingerprint)
            if row["status"] != "completed":
                connection.execute(
                    "UPDATE sessions SET source_path = ?, updated_at = ? WHERE id = ?",
                    (str(source_path.resolve()), now, row["id"]),
                )
        return self.get(row["id"])

    def recover_interrupted_sessions(self) -> None:
        now = datetime.now(UTC).isoformat()
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE analysis_attempts
                SET status = 'error', error = COALESCE(error, ?), updated_at = ?
                WHERE status = 'streaming'
                  AND session_id IN (SELECT id FROM sessions WHERE status = 'processing')
                """,
                ("Analysis generation was interrupted. Execute again to retry.", now),
            )
            connection.execute(
                """
                UPDATE sessions
                SET status = 'ready', stage = 'intake', progress = 0, updated_at = ?
                WHERE status = 'processing'
                """,
                (now,),
            )

    def purge_expired_raw_streams(self, *, now: datetime | None = None) -> None:
        """Discard stale provider text while retaining the Session and its reusable preparation."""
        cutoff = (now or datetime.now(UTC)) - timedelta(days=30)
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE analysis_attempts
                SET raw_stream = ''
                WHERE raw_stream != ''
                  AND updated_at < ?
                  AND session_id IN (
                    SELECT id FROM sessions
                    WHERE status NOT IN ('ready', 'processing', 'error', 'finalizing', 'needs_attention')
                  )
                """,
                (cutoff.isoformat(),),
            )

    def update_session(self, session_id: str, **changes: object) -> SessionView:
        allowed = {
            "status",
            "stage",
            "progress",
            "analysis_audio_path",
            "transcript",
            "transcript_word_timings",
            "source_path",
            "completed_folder_path",
            "model",
            "effort",
            "finalizing_attempt_id",
            "finalizing_service_id",
            "finalizing_cross_volume",
        }
        unexpected = set(changes) - allowed
        if unexpected:
            raise ValueError(f"Unsupported Session fields: {sorted(unexpected)}")
        if not changes:
            return self.get(session_id)
        if "transcript_word_timings" in changes:
            changes["transcript_word_timings"] = json.dumps(changes["transcript_word_timings"])
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

    def mark_commit_complete(
        self,
        session_id: str,
        *,
        source_path: str,
        analysis_audio_path: str,
        completed_folder_path: str,
    ) -> SessionView:
        """Finish a commit and remove private, redundant provider output in one transaction."""
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE sessions
                SET status = 'completed', stage = 'completed', progress = 100,
                    source_path = ?, analysis_audio_path = ?, completed_folder_path = ?,
                    finalizing_attempt_id = NULL, finalizing_service_id = NULL,
                    finalizing_cross_volume = NULL, updated_at = ?
                WHERE id = ?
                """,
                (
                    source_path,
                    analysis_audio_path,
                    completed_folder_path,
                    datetime.now(UTC).isoformat(),
                    session_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(session_id)
            connection.execute(
                "UPDATE analysis_attempts SET raw_stream = '' WHERE session_id = ?",
                (session_id,),
            )
        return self.get(session_id)

    def claim_commit(
        self, session_id: str, attempt_id: str, *, service_id: str, cross_volume: bool
    ) -> CommitClaim:
        with self.connection() as connection:
            session = connection.execute(
                "SELECT * FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if session is None:
                raise KeyError(session_id)
            attempt = connection.execute(
                "SELECT result FROM analysis_attempts WHERE id = ? AND session_id = ? AND status = 'completed'",
                (attempt_id, session_id),
            ).fetchone()
            if attempt is None or attempt["result"] is None:
                raise LookupError(attempt_id)
            if session["status"] == "completed":
                return CommitClaim(
                    session=self.get(session_id), resumes_finalization=False
                )
            if session["status"] == "finalizing":
                if session["finalizing_attempt_id"] != attempt_id:
                    raise RuntimeError("A different Analysis Attempt is already committing")
                if session["finalizing_service_id"] == service_id:
                    raise RuntimeError("Session commit is already in progress")
                return CommitClaim(
                    session=self.get(session_id),
                    resumes_finalization=True,
                    cross_volume=bool(session["finalizing_cross_volume"]),
                )
            cursor = connection.execute(
                """
                UPDATE sessions SET status = 'finalizing', finalizing_attempt_id = ?,
                finalizing_service_id = ?, finalizing_cross_volume = ?, updated_at = ?
                WHERE id = ? AND status IN ('review', 'needs_attention')
                """,
                (attempt_id, service_id, cross_volume, datetime.now(UTC).isoformat(), session_id),
            )
            if cursor.rowcount == 0:
                raise RuntimeError("Session is not ready to commit")
        return CommitClaim(
            session=self.get(session_id), resumes_finalization=False, cross_volume=cross_volume
        )

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

    def update_attempt_result(
        self,
        session_id: str,
        attempt_id: str,
        result: AnalysisResult,
        session_date: date | None = None,
        session_time: time | None = None,
    ) -> SessionView:
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE analysis_attempts
                SET result = ?, updated_at = ?
                WHERE id = ? AND session_id = ? AND status = 'completed'
                """,
                (
                    result.model_dump_json(),
                    datetime.now(UTC).isoformat(),
                    attempt_id,
                    session_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(attempt_id)
            if session_date is not None:
                connection.execute(
                    "UPDATE sessions SET session_date = ?, updated_at = ? WHERE id = ?",
                    (session_date.isoformat(), datetime.now(UTC).isoformat(), session_id),
                )
            if session_time is not None:
                connection.execute(
                    "UPDATE sessions SET session_time = ?, updated_at = ? WHERE id = ?",
                    (session_time.isoformat(), datetime.now(UTC).isoformat(), session_id),
                )
        return self.get(session_id)

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
