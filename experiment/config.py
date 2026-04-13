from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class RunConfig:
    """Single experiment run configuration."""

    id: str           # user-defined label, doubles as output filename
    question: str
    model: str = "gpt-4o-mini"
    dataset: str = "default"

    # Optional scope constraints injected as prompt hints (Day 1 = earliest date).
    day_start: int | None = None
    day_end: int | None = None
    teams: list[str] | None = None
    pairs: list[dict[str, str]] | None = None  # [{from_id: M2, to_id: M3}, ...]
    behavior: str | None = None
    source: str | None = None

    # Chain runs by passing previous message history as conversation context.
    resume_from: str | None = None

    def build_prompt(self) -> str:
        """Return the question with any active scope constraints appended."""
        constraints: list[str] = []
        if self.behavior:
            constraints.append(f"behavior={self.behavior}")
        if self.source:
            constraints.append(f"source={self.source}")
        if self.teams:
            constraints.append(f"teams={','.join(self.teams)}")
        if self.pairs:
            pairs_str = ", ".join(f"{p['from_id']}→{p['to_id']}" for p in self.pairs)
            constraints.append(f"pairs={pairs_str}")
        if self.day_start is not None:
            constraints.append(f"day_start={self.day_start}")
        if self.day_end is not None:
            constraints.append(f"day_end={self.day_end}")
        if constraints:
            return f"{self.question}\n\n[Scope: {', '.join(constraints)}]"
        return self.question


@dataclass
class ExperimentConfig:
    """Batch of runs executed in dependency-ordered parallel batches."""

    runs: list[RunConfig]
    base_url: str = "http://localhost:3000"
    output_dir: str = "results"
    batch_size: int = 5              # max concurrent runs per batch
    delay_between_runs: float = 1.0  # seconds between batches (rate-limit buffer)

    @staticmethod
    def from_yaml(path: str | Path = "experiment.yaml") -> "ExperimentConfig":
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        runs = [RunConfig(**r) for r in raw.pop("runs", [])]
        return ExperimentConfig(runs=runs, **raw)
