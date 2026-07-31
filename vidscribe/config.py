from pathlib import Path

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VIDSCRIBE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Path.home() / "Library" / "Application Support" / "Vidscribe"
    database_path: Path | None = None
    workspace_path: Path | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    test_mode: bool = False
    test_source_path: Path | None = None
    test_destination_path: Path | None = None
    test_analysis_failure: bool = False
    groq_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GROQ_API_KEY", "VIDSCRIBE_GROQ_API_KEY"),
    )
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "VIDSCRIBE_GEMINI_API_KEY"),
    )
    groq_model: str = "whisper-large-v3-turbo"
    gemini_model: str = "gemini-3-flash-preview"
    gemini_effort: str = "medium"
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    @field_validator("host")
    @classmethod
    def loopback_host_only(cls, value: str) -> str:
        if value.lower() not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("VIDSCRIBE_HOST must be a loopback address")
        return value

    @model_validator(mode="after")
    def derive_storage_paths(self) -> "Settings":
        if self.database_path is None:
            self.database_path = self.data_dir / "state.sqlite3"
        if self.workspace_path is None:
            self.workspace_path = self.data_dir / "sessions"
        return self
