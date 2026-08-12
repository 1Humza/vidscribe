from pathlib import Path

from vidscribe.config import Settings


def test_settings_loads_local_api_keys_env_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("VIDSCRIBE_GROQ_API_KEY", raising=False)
    monkeypatch.delenv("VIDSCRIBE_GEMINI_API_KEY", raising=False)
    (tmp_path / "api_keys.env").write_text(
        "GROQ_API_KEY=groq-test\nGEMINI_API_KEY=gemini-test\n"
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)

    settings = Settings(data_dir=tmp_path / "data")

    assert settings.groq_api_key == "groq-test"
    assert settings.gemini_api_key == "gemini-test"
    assert settings.system_prompt_path is not None
    assert settings.system_prompt_path.name == "system_prompt.md"
    assert settings.system_prompt_path.parent.name == "prompts"


def test_settings_loads_user_level_api_keys_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("VIDSCRIBE_GROQ_API_KEY", raising=False)
    monkeypatch.delenv("VIDSCRIBE_GEMINI_API_KEY", raising=False)
    credentials_dir = tmp_path / ".config" / "vidscribe"
    credentials_dir.mkdir(parents=True)
    (credentials_dir / "api_keys.env").write_text(
        "GROQ_API_KEY=groq-user\nGEMINI_API_KEY=gemini-user\n"
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    worktree = tmp_path / "worktree"
    worktree.mkdir()
    monkeypatch.chdir(worktree)

    settings = Settings(data_dir=tmp_path / "data")

    assert settings.groq_api_key == "groq-user"
    assert settings.gemini_api_key == "gemini-user"
