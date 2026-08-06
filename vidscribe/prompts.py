import os
from pathlib import Path


def default_system_prompt() -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / "system_prompt.md").read_text(encoding="utf-8").strip()


class SystemPromptStore:
    """Persist the tracked, repository-owned analysis prompt as plain Markdown."""

    def __init__(self, path: Path, default_prompt: str):
        self.path = path
        self.default_prompt = default_prompt

    def get(self) -> str:
        try:
            prompt = self.path.read_text(encoding="utf-8").strip()
            return prompt or self.default_prompt
        except OSError:
            return self.default_prompt

    def save(self, prompt: str) -> str:
        normalized = prompt.strip()
        if not normalized:
            raise ValueError("System prompt cannot be blank")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(normalized + "\n", encoding="utf-8")
        os.replace(temporary, self.path)
        return normalized
