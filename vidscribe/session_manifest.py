"""Portable metadata for completed Sessions.

SQLite remains the operational index for active work. A completed Session owns
this manifest so its folder can be moved and reopened independently.
"""

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from vidscribe.models import AnalysisResult, SessionView


MANIFEST_FILENAME = "session.json"
MANIFEST_FORMAT = "speech-distiller.session"
MANIFEST_SCHEMA_VERSION = 1


class SessionManifestError(ValueError):
    """A completed Session manifest is missing, malformed, or unsafe."""


@dataclass(frozen=True)
class LoadedSessionManifest:
    session: SessionView
    source_fingerprint: str


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _portable_result(result: dict[str, object]) -> dict[str, object]:
    normalized = dict(result)
    snapshots = []
    for snapshot in normalized.get("snapshots", []):
        snapshot = dict(snapshot)
        # Workspace extraction paths are intentionally not exported.
        snapshot["image_path"] = snapshot["filename"]
        snapshots.append(snapshot)
    normalized["snapshots"] = snapshots
    return normalized


def _asset(path: str, source: Path | None, *, kept: bool | None = None) -> dict[str, object]:
    item: dict[str, object] = {"path": path}
    if source is not None and source.is_file():
        item["sha256"] = _file_hash(source)
        item["size_bytes"] = source.stat().st_size
    if kept is not None:
        item["kept"] = kept
    return item


def build_session_manifest(
    session: SessionView,
    result: AnalysisResult,
    *,
    record_filename: str,
    source_filename: str,
    analysis_audio_filename: str,
    record_file: Path,
    source_file: Path,
    analysis_audio_file: Path,
    snapshot_files: dict[str, Path],
    committed_attempt_id: str | None,
) -> dict[str, object]:
    session_payload = session.model_dump(mode="json")
    session_payload.update(
        {
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "source_path": source_filename,
            "destination_path": ".",
            "analysis_audio_path": analysis_audio_filename,
            "completed_folder_path": ".",
            # Attachments stay external by design; retain their names below.
            "attachment_paths": [],
        }
    )

    attempts: list[dict[str, object]] = []
    for attempt in session.attempts:
        attempt_payload = attempt.model_dump(mode="json")
        attempt_payload["raw_stream"] = ""
        if attempt_payload.get("result") is not None:
            attempt_payload["result"] = _portable_result(attempt_payload["result"])
        if committed_attempt_id == attempt.id:
            attempt_payload["result"] = _portable_result(result.model_dump(mode="json"))
        attempts.append(attempt_payload)

    result_payload = _portable_result(result.model_dump(mode="json"))
    manifest: dict[str, object] = {
        "format": MANIFEST_FORMAT,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "session": session_payload,
        "committed_attempt_id": committed_attempt_id,
        "committed_result": result_payload,
        "attempts": attempts,
        "intake": {
            "attachment_filenames": [Path(path).name for path in session.attachment_paths],
        },
        "assets": {
            "record": _asset(record_filename, record_file),
            "source_media": _asset(source_filename, source_file),
            "analysis_audio": _asset(analysis_audio_filename, analysis_audio_file),
            "snapshots": [
                _asset(snapshot.filename, snapshot_files.get(snapshot.filename), kept=snapshot.kept)
                for snapshot in result.snapshots
                if snapshot.kept
            ],
        },
    }
    return manifest


def write_session_manifest(
    path: Path,
    session: SessionView,
    result: AnalysisResult,
    *,
    record_filename: str,
    source_filename: str,
    analysis_audio_filename: str,
    record_file: Path,
    source_file: Path,
    analysis_audio_file: Path,
    snapshot_files: dict[str, Path],
    committed_attempt_id: str | None,
) -> None:
    manifest = build_session_manifest(
        session,
        result,
        record_filename=record_filename,
        source_filename=source_filename,
        analysis_audio_filename=analysis_audio_filename,
        record_file=record_file,
        source_file=source_file,
        analysis_audio_file=analysis_audio_file,
        snapshot_files=snapshot_files,
        committed_attempt_id=committed_attempt_id,
    )
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _resolve_asset(folder: Path, value: object, label: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise SessionManifestError(f"Session manifest has an unsafe {label} path")
    resolved_folder = folder.resolve()
    resolved = (folder / value).resolve()
    try:
        resolved.relative_to(resolved_folder)
    except ValueError as error:
        raise SessionManifestError(f"Session manifest has an unsafe {label} path") from error
    return resolved


def load_session_manifest(folder: Path) -> LoadedSessionManifest:
    folder = folder.resolve()
    manifest_path = folder / MANIFEST_FILENAME
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SessionManifestError("Completed Session manifest could not be read") from error
    if not isinstance(payload, dict):
        raise SessionManifestError("Completed Session manifest must be a JSON object")
    if payload.get("format") != MANIFEST_FORMAT or payload.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise SessionManifestError("Completed Session manifest format is unsupported")

    try:
        session_payload = dict(payload["session"])
        assets = dict(payload["assets"])
        source_asset = dict(assets["source_media"])
        audio_asset = dict(assets["analysis_audio"])
        source_path = _resolve_asset(folder, source_asset["path"], "Source Media")
        audio_path = _resolve_asset(folder, audio_asset["path"], "Analysis Audio")
        record_path = _resolve_asset(folder, dict(assets["record"])["path"], "Session Record")
        # The source recording is useful for reprocessing, but not required to reopen
        # the completed record and its saved analysis.
        if not audio_path.is_file() or not record_path.is_file():
            raise SessionManifestError("Completed Session manifest references missing assets")
        if (
            source_path.is_file()
            and source_asset.get("sha256")
            and source_asset["sha256"] != _file_hash(source_path)
        ):
            raise SessionManifestError("Source Media does not match the Session manifest")
        if audio_asset.get("sha256") and audio_asset["sha256"] != _file_hash(audio_path):
            raise SessionManifestError("Analysis Audio does not match the Session manifest")

        attempts = []
        for attempt in payload.get("attempts", []):
            attempt_payload = dict(attempt)
            if attempt_payload.get("result") is not None:
                result_payload = dict(attempt_payload["result"])
                for snapshot in result_payload.get("snapshots", []):
                    snapshot["image_path"] = str(folder / snapshot["filename"])
                attempt_payload["result"] = result_payload
            attempts.append(attempt_payload)
        session_payload.update(
            {
                "source_path": str(source_path),
                "destination_path": str(folder.parent.resolve()),
                "analysis_audio_path": str(audio_path),
                "completed_folder_path": str(folder),
                "attempts": attempts,
                "attachment_paths": [],
            }
        )
        session = SessionView.model_validate(session_payload)
    except (KeyError, TypeError, ValidationError, SessionManifestError) as error:
        if isinstance(error, SessionManifestError):
            raise
        raise SessionManifestError("Completed Session manifest is malformed") from error
    source_fingerprint = str(source_asset.get("sha256") or "")
    if source_path.is_file() and not source_fingerprint:
        source_fingerprint = _file_hash(source_path)
    return LoadedSessionManifest(session, source_fingerprint)
