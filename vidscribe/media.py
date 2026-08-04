import json
import subprocess
from pathlib import Path
from uuid import uuid4


class MediaPreparationError(RuntimeError):
    pass


class FFmpegMediaPreparer:
    def __init__(self, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe"):
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path

    def prepare(self, source: Path, output: Path) -> Path:
        source = source.resolve()
        output = output.resolve()
        if self.is_valid(output):
            return output
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.name}.{uuid4().hex}.tmp.ogg")
        try:
            subprocess.run(
                [
                    self.ffmpeg_path,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-y",
                    "-i",
                    str(source),
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "24k",
                    "-vbr",
                    "off",
                    "-application",
                    "audio",
                    "-f",
                    "ogg",
                    str(temporary),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            if not self.is_valid(temporary):
                raise MediaPreparationError("FFmpeg produced invalid Analysis Audio")
            temporary.replace(output)
            return output
        except subprocess.CalledProcessError as error:
            message = error.stderr.strip() or "FFmpeg could not prepare Analysis Audio"
            raise MediaPreparationError(message) from error
        finally:
            temporary.unlink(missing_ok=True)

    def is_valid(self, path: Path) -> bool:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        try:
            completed = subprocess.run(
                [
                    self.ffprobe_path,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=format_name:stream=codec_name,channels",
                    "-of",
                    "json",
                    str(path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            payload = json.loads(completed.stdout)
            stream = payload["streams"][0]
            return (
                "ogg" in payload["format"]["format_name"]
                and stream["codec_name"] == "opus"
                and stream["channels"] == 1
            )
        except (subprocess.CalledProcessError, KeyError, IndexError, json.JSONDecodeError):
            return False
