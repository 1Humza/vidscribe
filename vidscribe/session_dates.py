import re
import subprocess
from datetime import date, datetime
from pathlib import Path


_FILENAME_DATE = re.compile(
    r"(?<!\d)(20\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])(?!\d)"
)


def infer_session_date(source: Path, ffprobe_path: str = "ffprobe") -> date | None:
    """Return recording date from an explicit filename date or reliable media metadata."""
    match = _FILENAME_DATE.search(source.name)
    if match:
        try:
            return date(*map(int, match.groups()))
        except ValueError:
            pass
    try:
        completed = subprocess.run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format_tags=creation_time,date",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(source),
            ],
            capture_output=True,
            check=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    for value in completed.stdout.splitlines():
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(value.strip())
            except ValueError:
                continue
    return None
