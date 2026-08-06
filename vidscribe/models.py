from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from vidscribe.snapshots import SnapshotCue, SnapshotProposal


class ExtractionOptions(BaseModel):
    action_summary: bool = True
    topics: bool = False
    chapters: bool = True
    highlights: bool = False

    @model_validator(mode="after")
    def choose_one_organization(self) -> "ExtractionOptions":
        if self.action_summary == self.topics:
            raise ValueError("select exactly one of action_summary or topics")
        return self


class AnalysisSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: Literal["gemini-3-flash-preview", "gemini-2.5-flash"] = "gemini-3-flash-preview"
    effort: Literal["minimal", "low", "medium", "high"] = "medium"

    @model_validator(mode="after")
    def validate_model_effort(self) -> "AnalysisSelection":
        if self.model == "gemini-2.5-flash" and self.effort == "minimal":
            raise ValueError("Gemini 2.5 Flash supports low, medium, or high effort")
        return self


class CreateSessionRequest(AnalysisSelection):
    source_selection_id: str
    destination_selection_id: str
    extra_instructions: str = ""
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)
    session_date: date | None = None
    attachment_selection_ids: list[str] = Field(default_factory=list)


class OpenCompletedSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_selection_id: str


class OpenSourceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_selection_id: str


class ExecuteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: Literal["gemini-3-flash-preview", "gemini-2.5-flash"] | None = None
    effort: Literal["minimal", "low", "medium", "high"] | None = None

    @model_validator(mode="after")
    def validate_model_effort(self) -> "ExecuteSessionRequest":
        if (self.model is None) != (self.effort is None):
            raise ValueError("Select both an analysis model and effort")
        if self.model == "gemini-2.5-flash" and self.effort == "minimal":
            raise ValueError("Gemini 2.5 Flash supports low, medium, or high effort")
        return self


class ResolvedSessionIntake(AnalysisSelection):
    source_path: str
    source_fingerprint: str
    destination_path: str
    extra_instructions: str = ""
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)
    session_date: date
    attachment_paths: list[str] = Field(default_factory=list)


class PickerRequest(BaseModel):
    initial_path: str | None = None


class SystemPromptUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=100_000)

    @model_validator(mode="after")
    def prompt_is_not_blank(self) -> "SystemPromptUpdate":
        if not self.prompt.strip():
            raise ValueError("System prompt cannot be blank")
        return self


class SystemPromptView(BaseModel):
    prompt: str
    locked_contract: dict[str, object]


class PickerSelection(BaseModel):
    selection_id: str
    path: str
    name: str
    media_kind: Literal["audio", "video"] | None = None


class AnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_record_markdown: str
    short_name: str
    session_date: str
    speaker_labels: list[str] = Field(default_factory=list)
    consulted_attachment_filenames: list[str] = Field(default_factory=list)
    mentions: list["Mention"] = Field(default_factory=list)
    snapshot_cues: list[SnapshotCue] = Field(default_factory=list)
    snapshots: list[SnapshotProposal] = Field(default_factory=list)
    source_media_has_video: bool = False

    @model_validator(mode="before")
    @classmethod
    def discard_legacy_provider_fields(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        normalized.pop("corrected_transcript_turns", None)
        normalized.setdefault("mentions", normalized.pop("uncertain_phrases", []))
        return normalized


class Mention(BaseModel):
    source_word_start: int = Field(ge=0)
    source_word_end: int = Field(ge=0)
    speaker_label: str = ""
    replacement: str | None = None

    @model_validator(mode="after")
    def range_is_ascending(self) -> "Mention":
        if self.source_word_end < self.source_word_start:
            raise ValueError("Mention end must not precede its start")
        return self


class PhraseCorrection(BaseModel):
    source_word_start: int = Field(ge=0)
    source_word_end: int = Field(ge=0)
    replacement: str = Field(min_length=1)

    @model_validator(mode="after")
    def range_is_ascending(self) -> "PhraseCorrection":
        if self.source_word_end < self.source_word_start:
            raise ValueError("Phrase Correction end must not precede its start")
        return self


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_record_markdown: str | None = None
    session_date: date | None = None
    session_time: time | None = None
    short_name: str | None = None
    speaker_renames: dict[str, str] = Field(default_factory=dict)
    snapshot_keeps: dict[str, bool] = Field(default_factory=dict)
    phrase_corrections: list[PhraseCorrection] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_a_change(self) -> "ReviewUpdate":
        if (
            self.session_record_markdown is None
            and self.session_date is None
            and self.session_time is None
            and self.short_name is None
            and not self.speaker_renames
            and not self.snapshot_keeps
            and not self.phrase_corrections
        ):
            raise ValueError("Provide at least one review edit")
        if self.short_name is not None and not self.short_name.strip():
            raise ValueError("Short Name cannot be blank")
        if any(not label.strip() for label in self.speaker_renames.values()):
            raise ValueError("Speaker Labels cannot be blank")
        return self


class AnalysisAttempt(BaseModel):
    id: str
    status: Literal["streaming", "completed", "error"]
    model: str
    effort: str
    raw_stream: str = ""
    result: AnalysisResult | None = None
    error: str | None = None


class SessionView(BaseModel):
    id: str
    status: Literal[
        "ready", "processing", "review", "error", "finalizing", "needs_attention", "completed"
    ]
    stage: Literal["intake", "preparing", "transcribing", "analyzing", "review", "completed"]
    progress: int
    source_path: str
    destination_path: str
    extra_instructions: str
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions
    model: Literal["gemini-3-flash-preview", "gemini-2.5-flash"]
    effort: Literal["minimal", "low", "medium", "high"]
    analysis_audio_path: str | None = None
    transcript: str | None = None
    session_date: date
    session_time: time
    attachment_paths: list[str] = Field(default_factory=list)
    transcript_word_timings: list[dict[str, object]] = Field(default_factory=list)
    completed_folder_path: str | None = None
    attempts: list[AnalysisAttempt] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
