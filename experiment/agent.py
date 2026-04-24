import json
from dataclasses import dataclass

from pydantic_ai import Agent, RunContext

from api_client import ApiClient
from prompts import COLVIZ_SYSTEM_PROMPT


@dataclass
class AgentDeps:
    dataset: str
    data_min_date: str | None
    api: ApiClient


# Cache agents by model string to avoid recreating them on every run.
_agent_cache: dict[str, Agent[AgentDeps, str]] = {}


def get_agent(model: str) -> Agent[AgentDeps, str]:
    if model not in _agent_cache:
        _agent_cache[model] = _build_agent(model)
    return _agent_cache[model]


def _build_agent(model: str) -> Agent[AgentDeps, str]:
    agent: Agent[AgentDeps, str] = Agent(
        f"openai:{model}",
        deps_type=AgentDeps,
        system_prompt=COLVIZ_SYSTEM_PROMPT,
    )

    @agent.tool
    async def get_interaction_summary(
        ctx: RunContext[AgentDeps],
        behavior: str | None = None,
        teams: str | None = None,
        source: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> str:
        """
        Aggregate counts only — the *shape* of the data, not the events.

        Use this FIRST to learn (a) how much activity exists, (b) how it
        distributes over behaviors and Day-N buckets, and (c) which (from_id,
        to_id, behavior) pairs are active. Then call `get_interaction_events`
        only for the slices that actually deserve drilling into.

        Input parameters (all optional):
        - behavior: filter by one behavior — "awareness", "sharing", "coordination", or "improving". Omit for all.
        - teams: comma-separated team IDs to filter by (e.g. "T1,T2,S1"). Omit for all teams.
        - source: filter by one data source — "mattermost", "gitlab", or "meeting". Omit for all.
        - start: filter from this Day number (inclusive). Omit for no lower bound.
        - end: filter up to this Day number (inclusive). Omit for no upper bound.

        Response envelope: { summary, interactions, pair_count }
        - summary: { event_count, by_behavior, by_day } across the FULL filtered set
        - interactions: ALL (from_id, to_id, behavior) pairs sorted by behavior
          (awareness → sharing → coordination → improving) then count desc.
          No pagination — all pairs are returned in a single response.
        - pair_count: total number of unique (from_id, to_id, behavior) pairs.
        - capped: true (only present) if the 500-pair hard cap was hit.
        No event content is included.
        """
        result = await ctx.deps.api.get_interaction_summary(
            ctx.deps.dataset,
            ctx.deps.data_min_date,
            behavior=behavior,
            team=teams,
            source=source,
            start=start,
            end=end,
        )
        return json.dumps(result, ensure_ascii=False)

    @agent.tool
    async def get_interaction_events(
        ctx: RunContext[AgentDeps],
        behavior: str | None = None,
        from_id: str | None = None,
        to_id: str | None = None,
        start: int | None = None,
        end: int | None = None,
        source: str | None = None,
        teams: str | None = None,
        offset: int | None = None,
    ) -> str:
        """
        Raw chronological event stream (ascending) with the actual content.
        No aggregate counts — for totals / distributions call
        `get_interaction_summary` first.

        PREFER scoping by `teams` + `start` + `end` to get one unified time-series
        for the whole team in a single call — every event row preserves
        `from_id` / `to_id`, so directional information is not lost. This
        replaces the legacy pattern of fanning out one call per directed pair,
        which fragments the timeline.

        Provide `from_id` / `to_id` only when zooming into a specific edge;
        provide `behavior` only when intentionally narrowing.

        Input parameters (all optional, but at least one scope filter is recommended):
        - behavior: one of "awareness", "sharing", "coordination", "improving".
        - from_id: sender member ID (e.g. "M2").
        - to_id: receiver member ID (e.g. "M3").
        - teams: comma-separated team IDs to scope the query (e.g. "T2").
        - source: one of "mattermost", "gitlab", "meeting".
        - start / end: Day-N range (inclusive).
        - offset: pagination offset (default 0, page size 50).

        Output fields per event record:
        - datetime: "Day N HH:MM:SS" anonymized timestamp
        - behavior, source, scope ("intra"/"inter"), team_id
        - from_id, to_id, weight
        - title, content, payload: raw source content (when available)

        Response envelope: { events, total, limit, offset, total_pages }
        Events are sorted ascending by datetime. Fetch subsequent pages by
        incrementing offset by 50.
        """
        result = await ctx.deps.api.get_interaction_events(
            ctx.deps.dataset,
            ctx.deps.data_min_date,
            behavior=behavior,
            from_id=from_id,
            to_id=to_id,
            start=start,
            end=end,
            source=source,
            team=teams,
            offset=offset,
        )
        return json.dumps(result, ensure_ascii=False)

    return agent
