import platform
import subprocess
from pathlib import Path
from typing import Protocol

from vidscribe.config import Settings


class Picker(Protocol):
    def choose_source(self, initial_path: Path | None = None) -> Path | None: ...

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

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self.destination

    def choose_attachments(self, initial_path: Path | None = None) -> list[Path] | None:
        return self.attachments


class MacOSPicker:
    _SOURCE_SCRIPT = """
        on run argv
            try
                if (count of argv) > 0 then
                    set chosen to choose file with prompt "Choose Source Media" default location POSIX file (item 1 of argv)
                else
                    set chosen to choose file with prompt "Choose Source Media"
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
        return self._choose(self._SOURCE_SCRIPT, initial_path)

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

    def _choose(self, script: str, initial_path: Path | None) -> Path | None:
        if platform.system() != "Darwin":
            raise RuntimeError("Native pickers require macOS")
        command = ["osascript", "-e", script]
        if initial_path is not None:
            command.append(str(initial_path.resolve()))
        completed = subprocess.run(command, capture_output=True, text=True, check=True)
        selected = completed.stdout.strip()
        return Path(selected).resolve() if selected else None


def picker_for(settings: Settings) -> Picker:
    if settings.test_mode:
        return ConfiguredPicker(settings.test_source_path, settings.test_destination_path)
    return MacOSPicker()
