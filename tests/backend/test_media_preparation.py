import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vidscribe.media import FFmpegMediaPreparer


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_real_ffmpeg_prepares_one_reusable_mono_24k_opus_ogg(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=4",
            "-ac",
            "2",
            str(source),
        ],
        check=True,
    )
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "artifacts" / "analysis.24k.ogg"
    preparer = FFmpegMediaPreparer()

    prepared = preparer.prepare(source, output)
    first_mtime = output.stat().st_mtime_ns
    reused = preparer.prepare(source, output)

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=format_name,bit_rate:stream=codec_name,channels",
            "-of",
            "json",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    metadata = json.loads(probe.stdout)
    stream = metadata["streams"][0]

    assert prepared == output.resolve()
    assert reused == prepared
    assert output.stat().st_mtime_ns == first_mtime
    assert "ogg" in metadata["format"]["format_name"]
    assert stream["codec_name"] == "opus"
    assert stream["channels"] == 1
    assert 20_000 <= int(metadata["format"]["bit_rate"]) <= 28_000
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
