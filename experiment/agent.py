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
    async def list_interactions(
        ctx: RunContext[AgentDeps],
        behavior: str | None = None,
        teams: str | None = None,
        source: str | None = None,
        start: int | None = None,
        end: int | None = None,
        offset: int | None = None,
    ) -> str:
        """
        List aggregated collaboration interaction summaries grouped by (from_id, to_id, behavior).

        Use this tool to get a broad overview of who interacted with whom and how often.
        To inspect the actual events for a specific pair, follow up with get_interaction_events.

        Input parameters:
        - behavior: filter by one behavior — "awareness", "sharing", "coordination", or "improving". Omit for all.
        - teams: comma-separated team IDs to filter by (e.g. "T1,T2,S1"). Omit for all teams.
        - source: filter by one data source — "mattermost", "gitlab", or "meeting". Omit for all.
        - start: filter from this Day number (inclusive). Omit for no lower bound.
        - end: filter up to this Day number (inclusive). Omit for no upper bound.
        - offset: pagination offset (default 0, page size 50).

        Output fields per summary record:
        - from_id: sender member ID (e.g. "M1")
        - to_id: receiver member ID (e.g. "M2")
        - behavior: the collaboration behavior label
        - count: total interaction weight (event count) for this pair and behavior

        Response envelope: { summaries, total, page, total_pages }
        Fetch subsequent pages by incrementing offset by 50.
        """
        result = await ctx.deps.api.list_interactions(
            ctx.deps.dataset,
            ctx.deps.data_min_date,
            behavior=behavior,
            team=teams,
            source=source,
            start=start,
            end=end,
            offset=offset,
        )
        return json.dumps(result, ensure_ascii=False)

    @agent.tool
    async def get_interaction_events(
        ctx: RunContext[AgentDeps],
        behavior: str,
        from_id: str,
        to_id: str,
        start: int | None = None,
        end: int | None = None,
        source: str | None = None,
        teams: str | None = None,
        offset: int | None = None,
    ) -> str:
        """
        Get detailed collaboration events for a specific directed pair (from_id → to_id).

        Use this tool when you need the actual events behind an interaction — e.g. to analyse
        a specific pair's behavior in depth, or when the scope specifies pairs to investigate.
        Call once per directed pair; to cover both directions, call twice (A→B, then B→A).

        Input parameters:
        - behavior: (required) one of "awareness", "sharing", "coordination", "improving".
        - from_id: (required) sender member ID (e.g. "M2"). Must be a valid member ID.
        - to_id: (required) receiver member ID (e.g. "M3"). Must be a valid member ID.
        - start: filter from this Day number (inclusive). Omit for no lower bound.
        - end: filter up to this Day number (inclusive). Omit for no upper bound.
        - source: filter by one data source — "mattermost", "gitlab", or "meeting". Omit for all.
        - teams: comma-separated team IDs to scope the query. Omit for all teams.
        - offset: pagination offset (default 0, page size 50).

        Output fields per event record:
        - from_id / to_id: member IDs
        - behavior: collaboration behavior label
        - date: anonymized date label (e.g. "Day 5")
        - source: data source name
        - scope: "intra" (same team) or "inter" (cross-team)
        - team_id: team context for intra-team events
        - weight: event weight (usually 1)
        - rawItem: raw source record if available (title, content, payload)

        Response envelope: { events, total, page, total_pages }
        Fetch subsequent pages by incrementing offset by 50.
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
