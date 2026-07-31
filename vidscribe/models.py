from datetime import datetime
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
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)


class ResolvedSessionIntake(BaseModel):
    source_path: str
    destination_path: str
    extra_instructions: str = ""
    extraction_options: ExtractionOptions = Field(default_factory=ExtractionOptions)


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
    extraction_options: ExtractionOptions
    analysis_audio_path: str | None = None
    transcript: str | None = None
    attempts: list[AnalysisAttempt] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
