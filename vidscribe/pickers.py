import platform
import subprocess
from pathlib import Path
from typing import Protocol

from vidscribe.config import Settings


class Picker(Protocol):
    def choose_source(self, initial_path: Path | None = None) -> Path | None: ...

    def choose_destination(self, initial_path: Path | None = None) -> Path | None: ...


class ConfiguredPicker:
    def __init__(self, source: Path | None, destination: Path | None):
        self.source = source
        self.destination = destination

    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        return self.source

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self.destination


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

    def choose_source(self, initial_path: Path | None = None) -> Path | None:
        return self._choose(self._SOURCE_SCRIPT, initial_path)

    def choose_destination(self, initial_path: Path | None = None) -> Path | None:
        return self._choose(self._DESTINATION_SCRIPT, initial_path)

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

