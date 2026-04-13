import asyncio
import json
import pathlib
from dataclasses import dataclass

from pydantic import TypeAdapter
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)

from agent import AgentDeps, get_agent
from api_client import ApiClient
from config import ExperimentConfig, RunConfig
from prompts import COLVIZ_SYSTEM_PROMPT

_messages_adapter = TypeAdapter(list[ModelMessage])


# ── result types ──────────────────────────────────────────────────────────────

@dataclass
class ToolLog:
    tool_name: str
    args: dict
    content: str


@dataclass
class RunResult:
    config_id: str
    run_id: str
    resume_from: str | None
    system_prompt: str
    user_prompt: str
    tool_logs: list[ToolLog]
    content: str
    error: str | None = None


# ── message persistence ───────────────────────────────────────────────────────

def save_messages(messages: list[ModelMessage], path: pathlib.Path) -> None:
    path.write_bytes(_messages_adapter.dump_json(messages))


def load_messages(path: pathlib.Path) -> list[ModelMessage]:
    return _messages_adapter.validate_json(path.read_bytes())


# ── tool log extraction ───────────────────────────────────────────────────────

def extract_tool_logs(messages: list[ModelMessage]) -> list[ToolLog]:
    """Pair ToolCallParts with their ToolReturnParts from message history."""
    calls: dict[str, ToolLog] = {}
    for msg in messages:
        if isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, ToolCallPart):
                    try:
                        args = part.args_as_dict()
                    except Exception:
                        args = {}
                    calls[part.tool_call_id] = ToolLog(part.tool_name, args, "")
        elif isinstance(msg, ModelRequest):
            for part in msg.parts:
                if isinstance(part, ToolReturnPart) and part.tool_call_id in calls:
                    calls[part.tool_call_id].content = part.content
    return list(calls.values())


# ── markdown report ───────────────────────────────────────────────────────────

def _to_markdown(result: RunResult) -> str:
    def json_block(text: str) -> str:
        try:
            return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except Exception:
            return text

    lines: list[str] = [f"# {result.config_id}", ""]
    if result.resume_from:
        lines += [f"**Resumed from:** `{result.resume_from}`", ""]
    lines += [f"**Run ID:** `{result.run_id}`", ""]

    for title, body in [("System Prompt", result.system_prompt), ("User Prompt", result.user_prompt)]:
        lines += ["---", "", f"## {title}", "", body, ""]

    if result.tool_logs:
        lines += ["---", "", "## Tool Calls", ""]
        for i, tl in enumerate(result.tool_logs, 1):
            lines += [
                f"### {i}. `{tl.tool_name}`", "",
                "**Args:**", "```json",
                json.dumps(tl.args, ensure_ascii=False, indent=2),
                "```", "",
                "**Result:**", "```json",
                json_block(tl.content),
                "```", "",
            ]

    lines += ["---", "", "## Answer", "", result.content or f"**ERROR:** {result.error}", ""]
    return "\n".join(lines)


# ── single run ────────────────────────────────────────────────────────────────

MAX_RETRIES = 3
RETRY_DELAY = 2.0  # seconds; multiplied by attempt number


async def run_single(config: RunConfig, api: ApiClient, messages_dir: pathlib.Path) -> RunResult:
    prompt = config.build_prompt()
    agent = get_agent(config.model)

    history: list[ModelMessage] | None = None
    if config.resume_from:
        msg_file = messages_dir / f"{config.resume_from}.messages.json"
        if not msg_file.exists():
            raise FileNotFoundError(
                f"No saved messages for resume_from='{config.resume_from}'. "
                f"Run '{config.resume_from}' first."
            )
        history = load_messages(msg_file)

    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            min_date = await api.get_min_date(config.dataset)
            deps = AgentDeps(dataset=config.dataset, data_min_date=min_date, api=api)

            async with agent.iter(prompt, deps=deps, message_history=history) as run:
                async for _ in run:
                    pass

            save_messages(run.all_messages(), messages_dir / f"{config.id}.messages.json")
            return RunResult(
                config_id=config.id,
                run_id=run.run_id,
                resume_from=config.resume_from,
                system_prompt=COLVIZ_SYSTEM_PROMPT,
                user_prompt=prompt,
                tool_logs=extract_tool_logs(run.new_messages()),
                content=run.result.output,
            )

        except Exception as exc:
            last_exc = exc
            if attempt < MAX_RETRIES:
                print(f"  [{config.id}] attempt {attempt} failed, retrying in {RETRY_DELAY * attempt:.0f}s…")
                await asyncio.sleep(RETRY_DELAY * attempt)

    return RunResult(
        config_id=config.id,
        run_id="error",
        resume_from=config.resume_from,
        system_prompt=COLVIZ_SYSTEM_PROMPT,
        user_prompt=prompt,
        tool_logs=[],
        content="",
        error=str(last_exc),
    )


# ── batch runner ──────────────────────────────────────────────────────────────

def _ready_and_waiting(
    runs: list[RunConfig],
    completed: set[str],
    messages_dir: pathlib.Path,
) -> tuple[list[RunConfig], list[RunConfig]]:
    """Partition runs into (ready, waiting).

    A run is ready when its resume_from dependency is already satisfied —
    either completed in this session or present as a saved messages file.
    """
    ready, waiting = [], []
    for r in runs:
        dep = r.resume_from
        satisfied = (
            dep is None
            or dep in completed
            or (messages_dir / f"{dep}.messages.json").exists()
        )
        (ready if satisfied else waiting).append(r)
    return ready, waiting


def _log_result(result: RunResult, done: int, total: int) -> None:
    if result.error:
        print(f"  [{done}/{total}] ✗ {result.config_id}: {result.error}")
    else:
        print(f"  [{done}/{total}] ✓ {result.config_id}: {len(result.tool_logs)} tool call(s)")
        for tl in result.tool_logs:
            args = ", ".join(f"{k}={v!r}" for k, v in tl.args.items() if v is not None)
            print(f"    · {tl.tool_name}({args})")


async def run_experiment(experiment: ExperimentConfig) -> list[RunResult]:
    api = ApiClient(experiment.base_url)

    out_dir = pathlib.Path(experiment.output_dir)
    reports_dir, messages_dir = out_dir / "reports", out_dir / "messages"
    reports_dir.mkdir(parents=True, exist_ok=True)
    messages_dir.mkdir(parents=True, exist_ok=True)

    total = len(experiment.runs)
    print(f"Running {total} experiment(s) → {out_dir}/\n")

    results: list[RunResult] = []
    completed: set[str] = set()
    remaining = list(experiment.runs)
    done = 0

    while remaining:
        ready, remaining = _ready_and_waiting(remaining, completed, messages_dir)
        if not ready:
            raise RuntimeError(
                f"Unresolvable resume_from dependencies: {[r.id for r in remaining]}"
            )

        for i in range(0, len(ready), experiment.batch_size):
            batch = ready[i : i + experiment.batch_size]
            print(f"── batch [{done + 1}–{done + len(batch)}/{total}]: {', '.join(r.id for r in batch)}")

            async def _tracked(cfg: RunConfig) -> tuple[RunConfig, RunResult]:
                return cfg, await run_single(cfg, api, messages_dir)

            for coro in asyncio.as_completed([_tracked(r) for r in batch]):
                config, result = await coro
                done += 1
                completed.add(config.id)
                _log_result(result, done, total)
                (reports_dir / f"{config.id}.md").write_text(_to_markdown(result), encoding="utf-8")
                results.append(result)

            if done < total:
                await asyncio.sleep(experiment.delay_between_runs)

    print(f"\nDone. reports → {reports_dir}/  |  messages → {messages_dir}/")
    return results
