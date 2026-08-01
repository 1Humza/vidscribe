import hashlib
import platform
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

from vidscribe.config import Settings


class Picker(Protocol):
    def choose_source(self, initial_path: Path | None = None) -> Path | None: ...

    def choose_completed_session_folder(self, initial_path: Path | None = None) -> Path | None: ...

    def choose_destination(self, initial_path: Path | None = None) -> Path | None: ...

    def choose_attachments(self, initial_path: Path | None = None) -> list[Path] | None: ...


class ConfiguredPicker:
    def __init__(
        self, source: Path | None, destination: Path | None, attachments: list[Path] | None = None
    ):
        self.source = source
        self.destination = destination
        self.attachments = attachments or []

    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        return self.source

    def choose_completed_session_folder(self, initial_path: Path | None = None) -> Path | None:
        return self.source if self.source is not None and self.source.is_dir() else None

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self.destination

    def choose_attachments(self, initial_path: Path | None = None) -> list[Path] | None:
        return self.attachments


class MacOSPicker:
    _COMPLETED_SESSION_SCRIPT = """
        on run argv
            try
                if (count of argv) > 0 then
                    set chosen to choose folder with prompt "Choose Completed Session Folder" default location POSIX file (item 1 of argv)
                else
                    set chosen to choose folder with prompt "Choose Completed Session Folder"
                end if
                return POSIX path of chosen
            on error number -128
                return ""
            end try
        end run
    """
    _DESTINATION_SCRIPT = """
        on run argv
            try
                if (count of argv) > 0 then
                    set chosen to choose folder with prompt "Choose Destination" default location POSIX file (item 1 of argv)
                else
                    set chosen to choose folder with prompt "Choose Destination"
                end if
                return POSIX path of chosen
            on error number -128
                return ""
            end try
        end run
    """
    _ATTACHMENTS_SCRIPT = """
        on run argv
            try
                set chosen to choose file with prompt "Choose Attached Context" with multiple selections allowed
                set paths to {}
                repeat with itemRef in chosen
                    set end of paths to POSIX path of itemRef
                end repeat
                return paths as text
            on error number -128
                return ""
            end try
        end run
    """

    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        if platform.system() != "Darwin":
            raise RuntimeError("Native pickers require macOS")
        command = [str(self._source_picker_executable())]
        if initial_path is not None:
            command.append(str(initial_path.resolve()))
        return self._run_picker(command)

    def choose_completed_session_folder(self, initial_path: Path | None = None) -> Path | None:
        return self._choose(self._COMPLETED_SESSION_SCRIPT, initial_path)

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self._choose(self._DESTINATION_SCRIPT, initial_path)

    def choose_attachments(self, initial_path: Path | None = None) -> list[Path] | None:
        if platform.system() != "Darwin":
            raise RuntimeError("Native pickers require macOS")
        completed = subprocess.run(
            ["osascript", "-e", self._ATTACHMENTS_SCRIPT],
            capture_output=True,
            text=True,
            check=True,
        )
        selected = completed.stdout.strip()
        return [Path(path).resolve() for path in selected.split(", ") if path] if selected else None

    def _choose(
        self, script: str, initial_path: Path | None, *, language: str | None = None
    ) -> Path | None:
        if platform.system() != "Darwin":
            raise RuntimeError("Native pickers require macOS")
        command = ["osascript"]
        if language is not None:
            command.extend(["-l", language])
        command.extend(["-e", script])
        if initial_path is not None:
            command.append(str(initial_path.resolve()))
        return self._run_picker(command)

    def _source_picker_executable(self) -> Path:
        source = Path(__file__).with_name("macos_source_picker.swift")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
        executable = Path(tempfile.gettempdir()) / f"vidscribe-source-picker-{digest}"
        if executable.is_file():
            return executable
        try:
            subprocess.run(
                ["swiftc", str(source), "-o", str(executable)],
                capture_output=True,
                text=True,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            detail = getattr(error, "stderr", "") or str(error)
            detail = detail.strip() or "macOS did not provide an error message"
            raise RuntimeError(f"Native source picker could not be built: {detail}") from error

        return executable

    @staticmethod
    def _run_picker(command: list[str]) -> Path | None:
        try:
            completed = subprocess.run(command, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as error:
            detail = error.stderr.strip() or "macOS did not provide an error message"
            raise RuntimeError(f"Native picker failed: {detail}") from error
        selected = completed.stdout.strip()
        return Path(selected).resolve() if selected else None


def picker_for(settings: Settings) -> Picker:
    if settings.test_mode:
        return ConfiguredPicker(settings.test_source_path, settings.test_destination_path)
    return MacOSPicker()
