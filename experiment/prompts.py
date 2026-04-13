import pathlib

_PROMPT_FILE = (
    pathlib.Path(__file__).parent.parent
    / "prompts"
    / "system-message-python.md"
)

COLVIZ_SYSTEM_PROMPT: str = _PROMPT_FILE.read_text(encoding="utf-8").strip()
