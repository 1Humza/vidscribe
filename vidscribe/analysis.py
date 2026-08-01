import json
import time
from pathlib import Path
from typing import Iterator, Protocol

from pydantic import BaseModel, Field

from vidscribe.models import AnalysisResult, ExtractionOptions


class AnalysisInput(BaseModel):
    transcript: str
    extra_instructions: str = ""
    extraction_options: ExtractionOptions
    session_date: str = ""
    attached_context: list[tuple[str, str]] = Field(default_factory=list)
    canonical_word_count: int = 0


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
                model=self.model,
                contents=[prompt, uploaded_audio],
                config={
                    "response_mime_type": "application/json",
                    "response_json_schema": AnalysisResult.model_json_schema(),
                    "thinking_config": {"thinking_level": self.effort},
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
            "Create one evidence-grounded Vidscribe Analysis Result. The Markdown must begin "
            "with `📝 **{title}** · {MM-DD-YYYY}` and have this exact order: optional Input Context, "
            "Recall Brief, optional Highlights, Action Summary or Topics, optional Chapters, Snapshots, Transcript. "
            "Recall Brief, Snapshots, and Transcript are mandatory; Transcript is last. Selected sections "
            "must be present even when empty, while unselected sections must be absent. Action Summary repeats "
            "the header and Recall Brief. Chapters begin at 00:00 and have at least three ascending entries. "
            "For every corrected transcript turn, return its speaker, corrected text, and the inclusive "
            "source word-index range from the canonical Whisper Transcript; never use model prose timestamps as anchors. "
            "Report only filenames actually consulted in consulted_attachment_filenames. "
            "Use the attached Analysis Audio to correct speakers, names, terminology, "
            "and punctuation, but preserve every spoken passage from the complete "
            "Whisper Transcript. Never invent speech. Preserve deterministic Silence "
            "Markers. Return only the requested schema.\n\n"
            f"Session Date: {analysis_input.session_date}\n\n"
            f"Extraction Options:\n{analysis_input.extraction_options.model_dump_json()}\n\n"
            f"Extra Instructions:\n{analysis_input.extra_instructions or '(none)'}\n\n"
            "Attached Context (use only when relevant; report only consulted filenames):\n"
            f"{json.dumps(analysis_input.attached_context) if analysis_input.attached_context else '(none)'}\n\n"
            f"Complete Whisper Transcript:\n{analysis_input.transcript}"
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
            "## Snapshots\n\nNo Snapshot qualifies for this deterministic recording.\n\n"
            "## Transcript\n\n"
            f"{analysis_input.transcript}"
        )
        raw = json.dumps(
            {
                "session_record_markdown": markdown,
                "short_name": "Pipeline Test Sync",
                "session_date": f"{analysis_input.session_date[5:7]}-{analysis_input.session_date[8:]}-{analysis_input.session_date[:4]}",
                "speaker_labels": ["Speaker 1"],
                "corrected_transcript_turns": [
                    {"speaker_label": "Speaker 1", "text": "Before", "source_word_start": 0, "source_word_end": 0},
                    {"speaker_label": "Speaker 1", "text": "After", "source_word_start": 1, "source_word_end": 1},
                ],
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
