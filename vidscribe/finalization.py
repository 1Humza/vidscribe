import ctypes
import errno
import hashlib
import os
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from uuid import uuid4

from vidscribe.models import AnalysisResult, SessionView
from vidscribe.session_manifest import MANIFEST_FILENAME, write_session_manifest
from vidscribe.snapshots import SnapshotError, SnapshotProposal, validate_snapshot_section


class FinalizationError(Exception):
    """A Session could not be safely materialized in its Destination."""


class DestinationConflict(FinalizationError):
    """The approved Completed Session Folder already exists."""


@dataclass(frozen=True)
class CompletedSessionAssets:
    folder_path: Path
    source_path: Path
    analysis_audio_path: Path


def session_basename(session: SessionView, result: AnalysisResult) -> str:
    title = re.sub(r"\s+", " ", unicodedata.normalize("NFC", result.short_name).strip())
    # Keep provider titles readable while making the basename Finder-safe and consistent.
    title = re.sub(r"\s*:\s*", " - ", title)
    if not title or title in {".", ".."}:
        raise FinalizationError("Short Name cannot be blank")
    if "\x00" in title or "/" in title or title.startswith("."):
        raise FinalizationError("Short Name contains an unsafe filesystem character")

    # Finder is the primary archive browser, so preserve the human title instead of slugging it.
    basename = f"[{session.session_date.isoformat()}] {title}"
    if len(basename.encode("utf-8")) > 200:
        raise FinalizationError("Completed Session name is too long for the filesystem")
    return basename


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_copy(source: Path, copied: Path) -> None:
    if not copied.is_file() or _file_hash(source) != _file_hash(copied):
        raise FinalizationError(f"Could not verify {source.name} in staging")


def _restore_missing_completed_source(source: Path, completed_source: Path) -> None:
    """Recover a source manually moved back while a publish was interrupted."""
    if completed_source.is_file():
        return
    if not source.is_file() or source == completed_source:
        raise FinalizationError("Completed Session media is unavailable")
    try:
        if source.stat().st_dev == completed_source.parent.stat().st_dev:
            os.replace(source, completed_source)
            return
        temporary = completed_source.with_name(f".{completed_source.name}.recovery-{uuid4().hex}")
        try:
            shutil.copy2(source, temporary)
            _verify_copy(source, temporary)
            os.replace(temporary, completed_source)
        finally:
            temporary.unlink(missing_ok=True)
    except OSError as error:
        raise FinalizationError("Completed Session media is unavailable") from error


def _kept_snapshot_paths(result: AnalysisResult) -> list[tuple[SnapshotProposal, Path]]:
    try:
        validate_snapshot_section(
            result.session_record_markdown, result.source_media_has_video, result.snapshots
        )
    except SnapshotError as error:
        raise FinalizationError(str(error)) from error
    paths: list[tuple[SnapshotProposal, Path]] = []
    for snapshot in result.snapshots:
        if not snapshot.kept:
            continue
        image_path = Path(snapshot.image_path)
        if not image_path.is_file() or image_path.stat().st_size == 0:
            raise FinalizationError(f"Snapshot {snapshot.filename} is no longer available")
        paths.append((snapshot, image_path))
    return paths


def _publish_no_replace(staging_folder: Path, completed_folder: Path) -> None:
    if sys.platform == "darwin":
        libc = ctypes.CDLL("libc.dylib", use_errno=True)
        renamex_np = libc.renamex_np
        renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        renamex_np.restype = ctypes.c_int
        rename_exclusive = 0x00000004
        result = renamex_np(
            os.fsencode(staging_folder), os.fsencode(completed_folder), rename_exclusive
        )
        if result == 0:
            return
        error_number = ctypes.get_errno()
        if error_number == errno.EEXIST:
            raise DestinationConflict("A Completed Session Folder with this name already exists")
        raise OSError(error_number, os.strerror(error_number), completed_folder)
    if completed_folder.exists():
        raise DestinationConflict("A Completed Session Folder with this name already exists")
    os.rename(staging_folder, completed_folder)


class SessionFinalizer:
    def __init__(
        self, *, same_volume: Callable[[Path, Path], bool] | None = None
    ) -> None:
        self._same_volume = same_volume or self._paths_share_volume

    @staticmethod
    def _paths_share_volume(source: Path, destination: Path) -> bool:
        return source.stat().st_dev == destination.stat().st_dev

    def paths_share_volume(self, source: Path, destination: Path) -> bool:
        return self._same_volume(source, destination)

    def _rename_completed_identity_assets(
        self, session: SessionView, result: AnalysisResult, assets: CompletedSessionAssets
    ) -> CompletedSessionAssets:
        """Keep an edited Session Identity aligned with its completed folder and core assets."""
        previous_basename = assets.folder_path.name
        basename = session_basename(session, result)
        if basename == previous_basename:
            return assets
        renamed_folder = Path(session.destination_path) / basename
        if renamed_folder.exists():
            raise DestinationConflict("A Completed Session Folder with this name already exists")
        renamed_assets = (
            (assets.source_path, assets.folder_path / f"{basename}{assets.source_path.suffix}"),
            (assets.analysis_audio_path, assets.folder_path / f"{basename}.24k.ogg"),
            (assets.folder_path / f"{previous_basename}.md", assets.folder_path / f"{basename}.md"),
        )
        moved: list[tuple[Path, Path]] = []
        try:
            for current, renamed in renamed_assets:
                if renamed.exists():
                    raise FinalizationError(f"Completed asset {renamed.name} already exists")
                os.rename(current, renamed)
                moved.append((current, renamed))
            _publish_no_replace(assets.folder_path, renamed_folder)
        except Exception as error:
            for current, renamed in reversed(moved):
                if renamed.exists() and not current.exists():
                    os.rename(renamed, current)
            if isinstance(error, FinalizationError):
                raise
            raise FinalizationError("Could not safely rename the Completed Session") from error
        return CompletedSessionAssets(
            renamed_folder,
            renamed_folder / f"{basename}{assets.source_path.suffix}",
            renamed_folder / f"{basename}.24k.ogg",
        )

    def recover_published(
        self,
        session: SessionView,
        result: AnalysisResult,
        *,
        cross_volume: bool,
    ) -> CompletedSessionAssets:
        basename = session_basename(session, result)
        completed_folder = Path(session.destination_path) / basename
        source_path = completed_folder / f"{basename}{Path(session.source_path).suffix}"
        analysis_audio_path = completed_folder / f"{basename}.24k.ogg"
        record_path = completed_folder / f"{basename}.md"
        kept_snapshots = _kept_snapshot_paths(result)
        original_source = Path(session.source_path)
        if (
            not completed_folder.is_dir()
            or not analysis_audio_path.is_file()
            or not record_path.is_file()
            or record_path.read_text(encoding="utf-8") != result.session_record_markdown
            or any(not (completed_folder / snapshot.filename).is_file() for snapshot, _ in kept_snapshots)
        ):
            raise FinalizationError("Finalization requires attention before it can be recovered")
        _restore_missing_completed_source(original_source, source_path)
        if cross_volume and original_source.exists():
            if _file_hash(original_source) != _file_hash(source_path):
                raise FinalizationError(
                    "Source Media changed after publication and must be resolved manually"
                )
            try:
                original_source.unlink()
            except OSError as error:
                raise FinalizationError("Published Session could not remove the original Source Media") from error
        return CompletedSessionAssets(completed_folder, source_path, analysis_audio_path)

    def overwrite_completed_record(
        self,
        session: SessionView,
        result: AnalysisResult,
        *,
        committed_attempt_id: str | None = None,
    ) -> CompletedSessionAssets:
        if session.completed_folder_path is None:
            raise FinalizationError("Completed Session Folder is unavailable")
        completed_folder = Path(session.completed_folder_path)
        basename = completed_folder.name
        record_path = completed_folder / f"{basename}.md"
        if not completed_folder.is_dir() or not record_path.is_file():
            raise FinalizationError("Completed Session Record is unavailable")
        source_path = completed_folder / f"{basename}{Path(session.source_path).suffix}"
        analysis_audio_path = completed_folder / f"{basename}.24k.ogg"
        if not source_path.is_file() or not analysis_audio_path.is_file():
            raise FinalizationError("Completed Session media is unavailable")
        kept_snapshots = _kept_snapshot_paths(result)
        staging_folder = completed_folder / f".{basename}.snapshot-sync-{uuid4().hex}"
        staged_record = staging_folder / record_path.name
        target_basename = session_basename(session, result)
        staged_manifest = staging_folder / MANIFEST_FILENAME
        manifest_path = completed_folder / MANIFEST_FILENAME
        backup_folder = staging_folder / "backup"
        managed_snapshots = {
            snapshot.filename
            for attempt in session.attempts
            if attempt.result is not None
            for snapshot in attempt.result.snapshots
        }
        managed_snapshots.update(snapshot.filename for snapshot in result.snapshots)
        published_snapshot_names: list[str] = []
        record_replaced = False
        manifest_replaced = False
        try:
            staging_folder.mkdir()
            staged_record.write_text(result.session_record_markdown, encoding="utf-8")
            if staged_record.read_text(encoding="utf-8") != result.session_record_markdown:
                raise FinalizationError("Could not verify the saved Session Record")
            for snapshot, image_path in kept_snapshots:
                staged_snapshot = staging_folder / snapshot.filename
                shutil.copy2(image_path, staged_snapshot)
                _verify_copy(image_path, staged_snapshot)

            write_session_manifest(
                staged_manifest,
                session,
                result,
                record_filename=f"{target_basename}.md",
                source_filename=f"{target_basename}{Path(session.source_path).suffix}",
                analysis_audio_filename=f"{target_basename}.24k.ogg",
                record_file=staged_record,
                source_file=source_path,
                analysis_audio_file=analysis_audio_path,
                snapshot_files={
                    snapshot.filename: staging_folder / snapshot.filename
                    for snapshot, _ in kept_snapshots
                },
                committed_attempt_id=committed_attempt_id,
            )

            backup_folder.mkdir()
            for filename in managed_snapshots:
                target = completed_folder / filename
                if target.exists() and not target.is_file():
                    raise FinalizationError(f"Completed Snapshot {filename} is unavailable")
                if target.is_file():
                    os.replace(target, backup_folder / filename)
            if manifest_path.is_file():
                os.replace(manifest_path, backup_folder / MANIFEST_FILENAME)
            os.replace(record_path, backup_folder / record_path.name)
            for snapshot, _ in kept_snapshots:
                os.replace(staging_folder / snapshot.filename, completed_folder / snapshot.filename)
                published_snapshot_names.append(snapshot.filename)
            os.replace(staged_record, record_path)
            record_replaced = True
            os.replace(staged_manifest, manifest_path)
            manifest_replaced = True
        except Exception as error:
            for filename in published_snapshot_names:
                (completed_folder / filename).unlink(missing_ok=True)
            if record_replaced:
                record_path.unlink(missing_ok=True)
            if manifest_replaced:
                manifest_path.unlink(missing_ok=True)
            if backup_folder.is_dir():
                for backup in backup_folder.iterdir():
                    os.replace(backup, completed_folder / backup.name)
            shutil.rmtree(staging_folder, ignore_errors=True)
            if isinstance(error, FinalizationError):
                raise
            raise FinalizationError("Could not safely save the Completed Session Record") from error
        shutil.rmtree(staging_folder, ignore_errors=True)
        return self._rename_completed_identity_assets(
            session,
            result,
            CompletedSessionAssets(completed_folder, source_path, analysis_audio_path),
        )

    def finalize(
        self,
        session: SessionView,
        result: AnalysisResult,
        *,
        committed_attempt_id: str | None = None,
    ) -> CompletedSessionAssets:
        source = Path(session.source_path)
        analysis_audio = Path(session.analysis_audio_path or "")
        destination = Path(session.destination_path)
        if not source.is_file():
            raise FinalizationError("Source Media is no longer available")
        if not analysis_audio.is_file():
            raise FinalizationError("Analysis Audio is no longer available")
        if not destination.is_dir():
            raise FinalizationError("Destination is no longer available")
        source_hash = _file_hash(source)
        kept_snapshots = _kept_snapshot_paths(result)

        basename = session_basename(session, result)
        completed_folder = destination / basename
        if completed_folder.exists():
            raise DestinationConflict("A Completed Session Folder with this name already exists")

        staging_folder = destination / f".{basename}.staging-{uuid4().hex}"
        staged_source = staging_folder / f"{basename}{source.suffix}"
        staged_audio = staging_folder / f"{basename}.24k.ogg"
        staged_record = staging_folder / f"{basename}.md"
        staged_manifest = staging_folder / MANIFEST_FILENAME
        moved_source = False
        published = False
        try:
            staging_folder.mkdir()
            staged_record.write_text(result.session_record_markdown, encoding="utf-8")
            if staged_record.read_text(encoding="utf-8") != result.session_record_markdown:
                raise FinalizationError("Could not verify the Session Record in staging")
            shutil.copy2(analysis_audio, staged_audio)
            _verify_copy(analysis_audio, staged_audio)
            for snapshot, image_path in kept_snapshots:
                staged_snapshot = staging_folder / snapshot.filename
                shutil.copy2(image_path, staged_snapshot)
                _verify_copy(image_path, staged_snapshot)

            same_volume = self._same_volume(source, destination)
            if same_volume:
                os.replace(source, staged_source)
                moved_source = True
            else:
                shutil.copy2(source, staged_source)
            if not staged_source.is_file() or _file_hash(staged_source) != source_hash:
                raise FinalizationError("Could not verify Source Media in staging")

            write_session_manifest(
                staged_manifest,
                session,
                result,
                record_filename=staged_record.name,
                source_filename=staged_source.name,
                analysis_audio_filename=staged_audio.name,
                record_file=staged_record,
                source_file=staged_source,
                analysis_audio_file=staged_audio,
                snapshot_files={
                    snapshot.filename: staging_folder / snapshot.filename
                    for snapshot, _ in kept_snapshots
                },
                committed_attempt_id=committed_attempt_id,
            )

            _publish_no_replace(staging_folder, completed_folder)
            published = True
            completed_source = completed_folder / staged_source.name
            completed_audio = completed_folder / staged_audio.name
            completed_record = completed_folder / staged_record.name
            if (
                not completed_source.is_file()
                or not completed_audio.is_file()
                or not completed_record.is_file()
                or not (completed_folder / MANIFEST_FILENAME).is_file()
                or any(
                    not (completed_folder / snapshot.filename).is_file()
                    for snapshot, _ in kept_snapshots
                )
            ):
                raise FinalizationError("Published Completed Session Folder did not verify")
            if not same_volume:
                source.unlink()
            return CompletedSessionAssets(completed_folder, completed_source, completed_audio)
        except Exception as error:
            if moved_source and not published and staged_source.exists() and not source.exists():
                try:
                    os.replace(staged_source, source)
                except OSError as restore_error:
                    raise FinalizationError(
                        "Finalization failed and Source Media could not be restored"
                    ) from restore_error
            if not published:
                shutil.rmtree(staging_folder, ignore_errors=True)
            if isinstance(error, FinalizationError):
                raise
            raise FinalizationError("Could not safely finalize this Session") from error
