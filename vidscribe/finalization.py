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
    normalized_title = unicodedata.normalize("NFKD", result.short_name)
    ascii_title = normalized_title.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_title).strip("-").lower()
    if not slug:
        raise FinalizationError("Short Name cannot produce a safe Completed Session Folder name")
    return f"{session.session_date.isoformat()}-{slug}"


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_copy(source: Path, copied: Path) -> None:
    if not copied.is_file() or _file_hash(source) != _file_hash(copied):
        raise FinalizationError(f"Could not verify {source.name} in staging")


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

    def recover_published(
        self, session: SessionView, result: AnalysisResult, *, cross_volume: bool
    ) -> CompletedSessionAssets:
        basename = session_basename(session, result)
        completed_folder = Path(session.destination_path) / basename
        source_path = completed_folder / f"{basename}{Path(session.source_path).suffix}"
        analysis_audio_path = completed_folder / f"{basename}.24k.ogg"
        record_path = completed_folder / f"{basename}.md"
        if (
            not completed_folder.is_dir()
            or not source_path.is_file()
            or not analysis_audio_path.is_file()
            or not record_path.is_file()
            or record_path.read_text(encoding="utf-8") != result.session_record_markdown
        ):
            raise FinalizationError("Finalization requires attention before it can be recovered")
        original_source = Path(session.source_path)
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

    def overwrite_completed_record(self, session: SessionView, result: AnalysisResult) -> None:
        if session.completed_folder_path is None:
            raise FinalizationError("Completed Session Folder is unavailable")
        completed_folder = Path(session.completed_folder_path)
        basename = completed_folder.name
        record_path = completed_folder / f"{basename}.md"
        if not completed_folder.is_dir() or not record_path.is_file():
            raise FinalizationError("Completed Session Record is unavailable")
        temporary_record = completed_folder / f".{record_path.name}.editing-{uuid4().hex}"
        try:
            temporary_record.write_text(result.session_record_markdown, encoding="utf-8")
            if temporary_record.read_text(encoding="utf-8") != result.session_record_markdown:
                raise FinalizationError("Could not verify the saved Session Record")
            os.replace(temporary_record, record_path)
        except Exception as error:
            temporary_record.unlink(missing_ok=True)
            if isinstance(error, FinalizationError):
                raise
            raise FinalizationError("Could not save the Completed Session Record") from error

    def finalize(self, session: SessionView, result: AnalysisResult) -> CompletedSessionAssets:
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

        basename = session_basename(session, result)
        completed_folder = destination / basename
        if completed_folder.exists():
            raise DestinationConflict("A Completed Session Folder with this name already exists")

        staging_folder = destination / f".{basename}.staging-{uuid4().hex}"
        staged_source = staging_folder / f"{basename}{source.suffix}"
        staged_audio = staging_folder / f"{basename}.24k.ogg"
        staged_record = staging_folder / f"{basename}.md"
        moved_source = False
        published = False
        try:
            staging_folder.mkdir()
            staged_record.write_text(result.session_record_markdown, encoding="utf-8")
            if staged_record.read_text(encoding="utf-8") != result.session_record_markdown:
                raise FinalizationError("Could not verify the Session Record in staging")
            shutil.copy2(analysis_audio, staged_audio)
            _verify_copy(analysis_audio, staged_audio)

            same_volume = self._same_volume(source, destination)
            if same_volume:
                os.replace(source, staged_source)
                moved_source = True
            else:
                shutil.copy2(source, staged_source)
            if not staged_source.is_file() or _file_hash(staged_source) != source_hash:
                raise FinalizationError("Could not verify Source Media in staging")

            _publish_no_replace(staging_folder, completed_folder)
            published = True
            completed_source = completed_folder / staged_source.name
            completed_audio = completed_folder / staged_audio.name
            completed_record = completed_folder / staged_record.name
            if (
                not completed_source.is_file()
                or not completed_audio.is_file()
                or not completed_record.is_file()
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
