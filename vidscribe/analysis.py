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
    timed_words: list[tuple[int, int, str]] = Field(default_factory=list)
    source_media_has_video: bool = False


def analysis_response_json_schema() -> dict:
    """Return the provider contract, excluding server-produced snapshot assets."""
    schema = AnalysisResult.model_json_schema()
    server_owned_fields = {"snapshots", "source_media_has_video"}
    for field in server_owned_fields:
        schema["properties"].pop(field, None)
    schema["required"] = [
        field for field in schema.get("required", []) if field not in server_owned_fields
    ]
    mention = schema.get("$defs", {}).get("Mention")
    if isinstance(mention, dict):
        mention.get("properties", {}).pop("replacement", None)
        mention["required"] = [
            field for field in mention.get("required", []) if field != "replacement"
        ]
    return schema


def parse_provider_analysis_result(raw_stream: str) -> AnalysisResult:
    """Ignore obsolete provider snapshot assets; the server materializes verified JPEGs."""
    payload = json.loads(raw_stream)
    if isinstance(payload, dict):
        for field in ("snapshots", "source_media_has_video", "corrected_transcript_turns"):
            payload.pop(field, None)
    return AnalysisResult.model_validate(payload)


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
                    "response_json_schema": analysis_response_json_schema(),
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
            "Recall Brief, Snapshots, and Transcript are mandatory; Transcript is last. Selected top-level sections "
            "must be present even when empty, while unselected sections must be absent. Recall Brief must be hyper-concise "
            "distinct context at a glance: no introductory or generic summary sentence, only the useful details that make this "
            "Session recognizable. When Action Summary is selected, it must be no more than 350 words total and repeat the record "
            "header first. Then use a channel-friendly layout: a Participants line when participants are known, followed by "
            "context-appropriate emoji-led discussion topics formatted as `[emoji] *Topic*`. Under each topic, use clear labeled "
            "prose or a short bullet list. Omit empty subsections. Never use checkbox or todo syntax. Include `🚧 *Blockers*` only "
            "when blockers genuinely exist. Include `🗓️ *Next Steps*` only when real follow-up exists, with one `**Owner** — action` "
            "line per owner. Never put a Recall Brief heading inside Action Summary. When Chapters are selected, start at `00:00` and "
            "write concise `MM:SS Chapter title` lines. Titles must be short, specific, and natural; capture actual topic shifts, bugs, "
            "fixes, design decisions, and action items. Merge silence or rambling into the nearest useful topic, use only actual transcript "
            "timestamps, and never invent details. Match the style `02:38 Giant hole / spawn issue`. Chapters require at least three ascending entries. "
            "Within Transcript, put each speaker turn and each Silence Marker on one line (single spaced). Write every silence "
            "exactly as `(Silence MM:SS)`. Require a new timestamped turn at natural pauses, completed thoughts, action/topic "
            "shifts, and changes in conversational cadence—even when the same speaker continues—so the transcript stays readable "
            "and time-anchored. Format every speaker turn exactly as `[HH:MM:SS] Speaker: `, for example `[01:42:48] Speaker: `. "
            "Do not split mechanically by a "
            "fixed duration; keep genuinely continuous speech together. "
            "Snapshots are automatic only when Source Media has video. Propose a Snapshot Cue only when speech explicitly "
            "points to useful visible information (a screen, setting, diagram, comparison, or demonstrated state). Never "
            "propose ordinary talking heads, vague references, purely verbal insights, decorative frames, or duplicate views. "
            "For each possible Snapshot, privately examine the immediately related sequence before and after the cue. A topic "
            "introduction, setup, or future intent is not a final rejection: scan forward for the earliest completion, reveal, "
            "or demonstrated result, then anchor at that result's first stable word. Merely naming a tool, object, or phrase such "
            "as 'this plugin is X' is an introduction, not a direct visible pointer; keep scanning. A direct visible pointer such "
            "as 'look here' or 'you can see' anchors immediately. For a completion/result cue, inspect slightly backward to find "
            "the beginning of that completed visible state, then anchor there before the screen can move on. If no nearby visual "
            "completion or direct pointer is "
            "present, do not propose a Snapshot. Return at most one `overview` Snapshot Cue when an early, stable, broad frame "
            "would clearly communicate what the session is about; it must meet the same visible-evidence standard. All other cues "
            "are `detail`. Each Snapshot Cue must include a concise subject, the exact supporting transcript "
            "phrase, the one exact anchor word within that phrase that best aligns with the visible reveal, and its speaker_label "
            "chosen exactly from speaker_labels. Return the anchor's zero-based canonical Whisper word index; never provide an "
            "approximate timestamp or filename. "
            "Return mentions for any non-plain-English term or phrase: names, technical or domain terms, unknown terms, and "
            "words or phrases that seem low-confidence, nonsensical, or unusual in ordinary language. Include familiar terms too. "
            "Return each distinct mention only once, case-insensitively, with no leading or trailing punctuation. Each Mention is "
            "only its inclusive canonical word range and a speaker_label chosen exactly from speaker_labels. "
            "Input Context is server-owned and added after generation: do not output its heading, Extra Instructions, or Attached Context "
            "content anywhere in the Markdown. Report only filenames actually consulted in consulted_attachment_filenames. "
            "Use the attached Analysis Audio to correct speakers, names, terminology, "
            "and punctuation, but preserve every spoken passage from the complete "
            "Whisper Transcript. Never invent speech. Preserve deterministic Silence "
            "Markers. Return only the requested schema.\n\n"
            f"Session Date: {analysis_input.session_date}\n\n"
            f"Extraction Options:\n{analysis_input.extraction_options.model_dump_json()}\n\n"
            f"Source Media has video: {json.dumps(analysis_input.source_media_has_video)}\n\n"
            f"Timed Whisper Words ([zero-based index, start milliseconds, word]):\n{json.dumps(analysis_input.timed_words)}\n\n"
            f"Extra Instructions:\n{analysis_input.extra_instructions or '(none)'}\n\n"
            "Attached Context (use only when relevant; report only consulted filenames):\n"
            f"{json.dumps(analysis_input.attached_context) if analysis_input.attached_context else '(none)'}\n\n"
            "Use Timed Whisper Words as the complete spoken baseline; preserve every spoken passage in Transcript."
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
