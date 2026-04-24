from datetime import datetime, timedelta

import httpx


# ── date helpers ──────────────────────────────────────────────────────────────

def _start_of_day(dt: datetime) -> datetime:
    """Mirror of TS startOfDay: zero out time component (local/naive)."""
    return dt.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)


def day_to_iso(day_num: int, min_date_iso: str) -> str:
    """Convert a Day-N number to an ISO date string. Mirrors dayNumberToDate() in lib/dayLabel.ts."""
    base = _start_of_day(datetime.fromisoformat(min_date_iso.replace("Z", "")))
    return (base + timedelta(days=day_num - 1)).isoformat()


def iso_to_day_label(iso_str: str, min_date_iso: str) -> str:
    """Convert an ISO date/datetime to 'Day N'. Mirrors dateToDayLabel() in lib/dayLabel.ts."""
    base = _start_of_day(datetime.fromisoformat(min_date_iso.replace("Z", "")))
    target = _start_of_day(datetime.fromisoformat(iso_str.replace("Z", "")))
    return f"Day {(target - base).days + 1}"


def iso_to_day_datetime_label(iso_str: str, min_date_iso: str) -> str:
    """Convert an ISO datetime to 'Day N HH:MM:SS'. Mirrors datetimeToDayLabel() in lib/dayLabel.ts."""
    base = _start_of_day(datetime.fromisoformat(min_date_iso.replace("Z", "")))
    dt = datetime.fromisoformat(iso_str.replace("Z", ""))
    day_num = (_start_of_day(dt) - base).days + 1
    return f"Day {day_num} {dt.strftime('%H:%M:%S')}"


# ── dataset context ───────────────────────────────────────────────────────────

class DatasetContext:
    """Derived metadata from a single /api/interactions fetch."""

    def __init__(self, data: list[dict]) -> None:
        self.min_date: str | None = min((d["datetime"] for d in data), default=None)

        # name → actor_key for members and teams
        self.name_map: dict[str, str] = {}
        for d in data:
            if d.get("from") and d.get("from_id"):
                self.name_map[d["from"]] = d["from_id"]
            if d.get("to") and d.get("to_id"):
                self.name_map[d["to"]] = d["to_id"]
            if d.get("team") and d.get("team_id"):
                self.name_map[d["team"]] = d["team_id"]

    def replace(self, name: str) -> str:
        """Return the actor_key for a name, or the original name if not found."""
        return self.name_map.get(name, name)


# ── anonymization ─────────────────────────────────────────────────────────────

# Payload keys whose string/array values are real names → anonymize to IDs.
_PAYLOAD_NAME_KEYS = frozenset({"members"})
# Payload keys to drop entirely (redundant with top-level event fields or internal metadata).
_PAYLOAD_DROP_KEYS = frozenset({"rowIndex", "datetime", "team", "teams"})
# Meeting-specific keys that duplicate title/content or contain raw names.
_MEETING_DROP_SUFFIXES = ("-intra", "-inter", "-subject", "-description")
_MEETING_DROP_KEYS = frozenset({"meetingGoal"})


def _should_drop_meeting_key(k: str) -> bool:
    return k in _MEETING_DROP_KEYS or k.endswith(_MEETING_DROP_SUFFIXES)


def _anonymize_summary(s: dict) -> dict:
    """Strip real names from an interaction summary record."""
    return {k: v for k, v in s.items() if k not in ("from_name", "to_name")}


def _clean_payload(payload: dict, ctx: "DatasetContext", source: str = "") -> dict:
    """Replace real names inside payload's name-bearing keys with actor IDs.
    Drops empty-string values, internal metadata keys (rowIndex, datetime),
    and meeting-specific keys that duplicate title/content (*-intra, *-inter,
    *-subject, *-description, meetingGoal).
    """
    is_meeting = source == "meeting"
    clean: dict = {}
    for k, v in payload.items():
        if k in _PAYLOAD_DROP_KEYS or v == "":
            continue
        if is_meeting and _should_drop_meeting_key(k):
            continue
        if k in _PAYLOAD_NAME_KEYS:
            if isinstance(v, list):
                clean[k] = [ctx.replace(n) if isinstance(n, str) else n for n in v]
            elif isinstance(v, str):
                clean[k] = ctx.replace(v)
            else:
                clean[k] = v
        else:
            clean[k] = v
    return clean


def _slim_event(e: dict, min_date: str | None, ctx: "DatasetContext") -> dict:
    """Slim an event for AI consumption: drop opaque IDs, real names, and the
    duplicated `date` field; flatten rawItem.{title, content, payload} to top
    level; convert datetime to 'Day N HH:MM:SS' so time-of-day is preserved.
    Mirrors slimEvent() in components/copilotkit/FrontendTools.tsx.
    """
    slim: dict = {}

    if min_date and isinstance(e.get("datetime"), str):
        slim["datetime"] = iso_to_day_datetime_label(e["datetime"], min_date)
    elif "datetime" in e:
        slim["datetime"] = e["datetime"]

    for k in ("behavior", "source", "scope", "team_id", "from_id", "to_id", "weight"):
        if k in e:
            slim[k] = e[k]

    raw_item = e.get("rawItem")
    if isinstance(raw_item, dict):
        if raw_item.get("title") is not None:
            slim["title"] = raw_item["title"]
        if raw_item.get("content") is not None:
            slim["content"] = raw_item["content"]
        payload = raw_item.get("payload")
        if isinstance(payload, dict):
            clean = _clean_payload(payload, ctx, source=e.get("source", ""))
            if clean:
                slim["payload"] = clean

    return slim


# ── API client ────────────────────────────────────────────────────────────────

class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._ctx_cache: dict[str, DatasetContext] = {}

    async def _get_context(self, dataset: str) -> DatasetContext:
        """Fetch /api/interactions once and cache the derived DatasetContext."""
        if dataset not in self._ctx_cache:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(
                    f"{self.base_url}/api/interactions",
                    params={"dataset": dataset},
                )
                r.raise_for_status()
                data: list[dict] = r.json().get("data", [])
            self._ctx_cache[dataset] = DatasetContext(data)
        return self._ctx_cache[dataset]

    async def get_min_date(self, dataset: str = "default") -> str | None:
        return (await self._get_context(dataset)).min_date

    async def get_stages(self, dataset: str = "default") -> list[dict]:
        """GET /api/stages — returns stage day ranges derived from DB."""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{self.base_url}/api/stages",
                params={"dataset": dataset},
            )
            r.raise_for_status()
            return r.json().get("stages", [])

    # ── tool endpoints ────────────────────────────────────────────────────────

    async def get_interaction_summary(
        self,
        dataset: str,
        min_date: str | None,
        *,
        behavior: str | None = None,
        team: str | None = None,
        source: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> dict:
        """GET /api/interaction-summary

        Owns *all* aggregate views for the AI: a `summary` block
        ({ total_events, by_behavior, by_day }) for the entire filtered set,
        plus an `interactions` array with ALL (from_id, to_id, behavior) pairs,
        sorted by behavior (awareness → sharing → coordination → improving)
        then count desc. No pagination.

        Returns: { summary: { event_count, by_behavior, by_day }, interactions, pair_count }
        and optionally { capped: true } if the hard cap of 500 pairs was hit.
        """
        params: dict[str, str] = {"dataset": dataset}
        if behavior:
            params["behavior"] = behavior
        if team:
            params["teams"] = team
        if source:
            params["source"] = source
        if start is not None and min_date:
            params["start"] = day_to_iso(start, min_date)
        if end is not None and min_date:
            params["end"] = day_to_iso(end, min_date)

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base_url}/api/interaction-summary", params=params)
            r.raise_for_status()
            data = r.json()

        interactions = [_anonymize_summary(s) for s in data.get("summaries", [])]
        result: dict = {
            "summary": data.get("summary"),
            "interactions": interactions,
            "pair_count": data.get("pair_count", len(interactions)),
        }
        if data.get("capped"):
            result["capped"] = True
        return result

    async def get_interaction_events(
        self,
        dataset: str,
        min_date: str | None,
        *,
        behavior: str | None = None,
        from_id: str | None = None,
        to_id: str | None = None,
        start: int | None = None,
        end: int | None = None,
        source: str | None = None,
        team: str | None = None,
        offset: int | None = None,
    ) -> dict:
        """GET /api/drilldown

        Pure event stream — no aggregates. For totals / breakdowns call
        `get_interaction_summary` first.

        Returns: { events, total, limit, offset, total_pages }
        Events are sorted ascending by datetime.
        """
        params: dict[str, str] = {"dataset": dataset, "order": "asc", "limit": "9999"}
        if behavior:
            params["behavior"] = behavior
        if from_id:
            params["from_id"] = from_id
        if to_id:
            params["to_id"] = to_id
        if source:
            params["source"] = source
        if team:
            params["teams"] = team
        if start is not None and min_date:
            params["start"] = day_to_iso(start, min_date)
        if end is not None and min_date:
            params["end"] = day_to_iso(end, min_date)
        if offset is not None:
            params["offset"] = str(offset)

        ctx = await self._get_context(dataset)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base_url}/api/drilldown", params=params)
            r.raise_for_status()
            data = r.json()

        events = [_slim_event(e, min_date, ctx) for e in data.get("events", [])]
        result: dict = {"events": events}
        for k in ("total", "limit", "offset", "total_pages"):
            if k in data:
                result[k] = data[k]
        return result
