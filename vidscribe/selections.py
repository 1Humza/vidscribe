import secrets
from pathlib import Path
from typing import Literal


SelectionKind = Literal["source", "destination"]


class SelectionRegistry:
    def __init__(self) -> None:
        self._selections: dict[str, tuple[SelectionKind, Path]] = {}

    def issue(self, kind: SelectionKind, path: Path) -> str:
        selection_id = secrets.token_urlsafe(32)
        self._selections[selection_id] = (kind, path.resolve())
        return selection_id

    def resolve(self, selection_id: str, kind: SelectionKind) -> Path:
        selected = self._selections.get(selection_id)
        if selected is None or selected[0] != kind:
            raise KeyError(selection_id)
        return selected[1]

