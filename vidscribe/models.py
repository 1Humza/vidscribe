from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_selection_id: str
    destination_selection_id: str
    extra_instructions: str = ""
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)
    session_date: date | None = None
    attachment_selection_ids: list[str] = Field(default_factory=list)


class ResolvedSessionIntake(BaseModel):
    source_path: str
    destination_path: str
    extra_instructions: str = ""
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)
    session_date: date
    attachment_paths: list[str] = Field(default_factory=list)


class PickerRequest(BaseModel):
    initial_path: str | None = None


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
    corrected_transcript_turns: list["CorrectedTranscriptTurn"] = Field(default_factory=list)


class CorrectedTranscriptTurn(BaseModel):
    speaker_label: str
    text: str
    source_word_start: int = Field(ge=0)
    source_word_end: int = Field(ge=0)

    @model_validator(mode="after")
    def range_is_ascending(self) -> "CorrectedTranscriptTurn":
        if self.source_word_end < self.source_word_start:
            raise ValueError("source_word_end must not precede source_word_start")
        return self


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_record_markdown: str | None = None
    session_date: date | None = None
    short_name: str | None = None
    speaker_renames: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_a_change(self) -> "ReviewUpdate":
        if (
            self.session_record_markdown is None
            and self.session_date is None
            and self.short_name is None
            and not self.speaker_renames
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
    status: Literal["ready", "processing", "review", "error"]
    stage: Literal["intake", "preparing", "transcribing", "analyzing", "review"]
    progress: int
    source_path: str
    destination_path: str
    extra_instructions: str
    speaker_hints: list[str] = Field(default_factory=list)
    extraction_options: ExtractionOptions
    analysis_audio_path: str | None = None
    transcript: str | None = None
    session_date: date
    attachment_paths: list[str] = Field(default_factory=list)
    transcript_word_timings: list[dict[str, object]] = Field(default_factory=list)
    attempts: list[AnalysisAttempt] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
