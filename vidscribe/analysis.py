import json
import time
from pathlib import Path
from typing import Iterator, Protocol

from pydantic import BaseModel, Field

from vidscribe.models import AnalysisPlan, AnalysisResult, ExtractionOptions
from vidscribe.prompts import default_system_prompt


class AnalysisInput(BaseModel):
    transcript: str
    extra_instructions: str = ""
    extraction_options: ExtractionOptions
    session_date: str = ""
    attached_context: list[tuple[str, str]] = Field(default_factory=list)
    source_words: list[tuple[int, str]] = Field(default_factory=list)
    source_media_has_video: bool = False
    model: str = ""
    effort: str = ""
    system_prompt: str = ""


DEFAULT_SYSTEM_PROMPT = default_system_prompt()


def analysis_response_json_schema() -> dict:
    """Return Gemini's compact plan contract, excluding all server-rendered fields."""
    return AnalysisPlan.model_json_schema(by_alias=True)


def parse_provider_analysis_result(raw_stream: str) -> AnalysisPlan | AnalysisResult:
    """Read the compact plan, retaining old result payloads for existing Sessions."""
    payload = json.loads(raw_stream)
    if not isinstance(payload, dict):
        raise ValueError("Gemini returned an invalid Analysis Plan")
    if "session_record_markdown" in payload:
        for field in ("snapshots", "source_media_has_video", "corrected_transcript_turns"):
            payload.pop(field, None)
        return AnalysisResult.model_validate(payload)
    return AnalysisPlan.model_validate(payload)


class Analyzer(Protocol):
    model: str
    effort: str

    def stream(
        self, audio_path: Path, analysis_input: AnalysisInput
    ) -> Iterator[str]: ...


class AnalysisGenerationError(RuntimeError):
    pass


class GeminiAnalyzer:
    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3-flash-preview",
        effort: str = "medium",
        client=None,
    ):
        self.model = model
        self.effort = effort
        if client is None:
            try:
                from google import genai
            except ImportError as error:
                raise RuntimeError(
                    "Install the 'live' dependency to use Gemini analysis"
                ) from error
            client = genai.Client(api_key=api_key)
        self.client = client

    def stream(self, audio_path: Path, analysis_input: AnalysisInput) -> Iterator[str]:
        prompt = self._prompt(analysis_input)
        uploaded_audio = None
        try:
            uploaded_audio = self.client.files.upload(file=str(audio_path))
            response = self.client.models.generate_content_stream(
                model=analysis_input.model or self.model,
                contents=[prompt, uploaded_audio],
                config={
                    "response_mime_type": "application/json",
                    "response_json_schema": analysis_response_json_schema(),
                    "thinking_config": {"thinking_level": analysis_input.effort or self.effort},
                },
            )
            for chunk in response:
                text = getattr(chunk, "text", None)
                if text:
                    yield text
        except Exception as error:
            raise AnalysisGenerationError("Gemini analysis was interrupted") from error
        finally:
            if uploaded_audio is not None:
                delete = getattr(self.client.files, "delete", None)
                uploaded_name = getattr(uploaded_audio, "name", None)
                if callable(delete) and uploaded_name:
                    try:
                        delete(name=uploaded_name)
                    except Exception:
                        pass

    def _prompt(self, analysis_input: AnalysisInput) -> str:
        return (
            f"{(analysis_input.system_prompt or DEFAULT_SYSTEM_PROMPT).strip()}\n\n"
            f"Session Date: {analysis_input.session_date}\n\n"
            f"Extraction Options:\n{analysis_input.extraction_options.model_dump_json()}\n\n"
            f"Source Media has video: {json.dumps(analysis_input.source_media_has_video)}\n\n"
            f"Canonical Whisper Words ([zero-based index, word]):\n{json.dumps(analysis_input.source_words)}\n\n"
            f"Extra Instructions:\n{analysis_input.extra_instructions or '(none)'}\n\n"
            "Attached Context (use only when relevant; report only consulted filenames):\n"
            f"{json.dumps(analysis_input.attached_context) if analysis_input.attached_context else '(none)'}\n\n"
            "Use canonical Whisper words as the complete spoken baseline. Return only the requested AnalysisPlan JSON."
        )


class DeterministicAnalyzer:
    model = "deterministic-analysis"
    effort = "medium"

    def __init__(self, *, delay_seconds: float = 0.075, fail_after_first: bool = False):
        self.delay_seconds = delay_seconds
        self.fail_after_first = fail_after_first

    def stream(self, audio_path: Path, analysis_input: AnalysisInput) -> Iterator[str]:
        organization_heading = "Action Summary" if analysis_input.extraction_options.action_summary else "Topics"
        organization_content = (
            "A deterministic recording used to prove the local pipeline."
            if organization_heading == "Action Summary"
            else "- Deterministic pipeline verification."
        )
        highlights = "## Highlights\n\nNo Highlights qualify.\n\n" if analysis_input.extraction_options.highlights else ""
        chapters = "## Chapters\n\n00:00 Opening\n00:10 Pause\n00:17 Close\n\n" if analysis_input.extraction_options.chapters else ""
        header = f"📝 **Pipeline Test Sync** · {analysis_input.session_date[5:7]}-{analysis_input.session_date[8:]}-{analysis_input.session_date[:4]}"
        markdown = (
            f"{header}\n\n"
            "## Recall Brief\n\nA deterministic recording used to prove the local pipeline.\n\n"
            f"{highlights}"
            f"## {organization_heading}\n\n"
            f"{header}\n\n{organization_content}\n\n"
            f"{chapters}"
            f"## Snapshots\n\n{'No Snapshot qualified for this video Session.' if analysis_input.source_media_has_video else 'Source Media was audio.'}\n\n"
            "## Transcript\n\n"
            f"{analysis_input.transcript}"
        )
        raw = json.dumps(
            {
                "session_record_markdown": markdown,
                "short_name": "Pipeline Test Sync",
                "session_date": f"{analysis_input.session_date[5:7]}-{analysis_input.session_date[8:]}-{analysis_input.session_date[:4]}",
                "speaker_labels": ["Speaker 1"],
            },
            separators=(",", ":"),
        )
        split_at = max(1, len(raw) // 2)
        chunks = (raw[:split_at], raw[split_at:])
        for index, chunk in enumerate(chunks):
            if self.delay_seconds:
                time.sleep(self.delay_seconds)
            yield chunk
            if index == 0 and self.fail_after_first:
                raise AnalysisGenerationError("Deterministic analysis failure")
