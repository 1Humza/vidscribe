from pathlib import Path

from vidscribe.config import Settings


def test_settings_loads_local_api_keys_env_file(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "api_keys.env").write_text(
        "GROQ_API_KEY=groq-test\nGEMINI_API_KEY=gemini-test\n"
    )
    monkeypatch.chdir(tmp_path)

    settings = Settings(data_dir=tmp_path / "data")

    assert settings.groq_api_key == "groq-test"
    assert settings.gemini_api_key == "gemini-test"
