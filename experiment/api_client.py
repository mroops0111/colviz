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

_PAYLOAD_NAME_KEYS = frozenset({"members", "team", "teams"})


def _anonymize_summary(s: dict) -> dict:
    """Strip real names from an interaction summary record."""
    return {k: v for k, v in s.items() if k not in ("from_name", "to_name")}


def _anonymize_event(e: dict, min_date: str | None, ctx: "DatasetContext") -> dict:
    """Replace real names with IDs and convert date fields to Day N labels."""
    result = {k: v for k, v in e.items() if k not in ("from", "to")}

    if min_date:
        if isinstance(result.get("date"), str):
            result["date"] = iso_to_day_label(result["date"], min_date)
        if isinstance(result.get("datetime"), str):
            result["datetime"] = iso_to_day_label(result["datetime"], min_date)

    # Replace name fields inside rawItem.payload with actor IDs
    raw_item = result.get("rawItem")
    if isinstance(raw_item, dict):
        payload = raw_item.get("payload")
        if isinstance(payload, dict):
            clean: dict = {}
            for k, v in payload.items():
                if k in _PAYLOAD_NAME_KEYS:
                    if isinstance(v, list):
                        clean[k] = [ctx.replace(n) if isinstance(n, str) else n for n in v]
                    elif isinstance(v, str):
                        clean[k] = ctx.replace(v)
                else:
                    clean[k] = v
            result["rawItem"] = {**raw_item, "payload": clean}

    return result


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

    async def list_interactions(
        self,
        dataset: str,
        min_date: str | None,
        *,
        behavior: str | None = None,
        team: str | None = None,
        source: str | None = None,
        start: int | None = None,
        end: int | None = None,
        offset: int | None = None,
    ) -> dict:
        """GET /api/interaction-summary"""
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
        if offset is not None:
            params["offset"] = str(offset)

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base_url}/api/interaction-summary", params=params)
            r.raise_for_status()
            data = r.json()
            data["summaries"] = [_anonymize_summary(s) for s in data.get("summaries", [])]
            return data

    async def get_interaction_events(
        self,
        dataset: str,
        min_date: str | None,
        *,
        behavior: str,
        from_id: str,
        to_id: str,
        start: int | None = None,
        end: int | None = None,
        source: str | None = None,
        team: str | None = None,
        offset: int | None = None,
    ) -> dict:
        """GET /api/drilldown"""
        params: dict[str, str] = {
            "dataset": dataset,
            "behavior": behavior,
            "from_id": from_id,
            "to_id": to_id,
        }
        if source:
            params["source"] = source
        if team:
            params["team"] = team
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
            data["events"] = [_anonymize_event(e, min_date, ctx) for e in data.get("events", [])]
            return data
