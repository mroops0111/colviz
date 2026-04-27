import { NextResponse } from "next/server";
import { calcTotalPages, parseOptionalDate, parseSingleOrCsvList } from "@/lib/api-utils";
import { queryEdgeEvents, queryRawChannelEvents } from "@/lib/copilotQueries";

export const runtime = "nodejs";

/** GET /api/drilldown - Accepts singular (team, source) or plural (teams, sources) query params.
 *
 * Optional query params (used by the AI tool layer; UI callers can ignore):
 * - order=asc|desc (default desc)  — chronological direction of events
 * - include_untagged=true          — Mattermost-only: query the raw message
 *   stream so messages without a behavior tag are included. Untagged rows have
 *   `behavior`, `to_id`/`to`, and (sometimes) `team_id`/`team` set to "" since
 *   raw messages have no recipient. UI / charts MUST NOT pass this flag —
 *   it's intended for AI-side context recovery (mid-conversation gaps).
 *
 * Aggregate stats (counts / breakdowns) live on /api/interaction-summary; this
 * endpoint is purely for the raw event stream.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";

  const behavior = url.searchParams.get("behavior")?.trim() || undefined;
  const from_id = url.searchParams.get("from_id")?.trim() || undefined;
  const to_id = url.searchParams.get("to_id")?.trim() || undefined;
  const sources = parseSingleOrCsvList(
    url.searchParams.get("source"),
    url.searchParams.get("sources")
  );
  const teams = parseSingleOrCsvList(
    url.searchParams.get("team"),
    url.searchParams.get("teams")
  );
  const start = parseOptionalDate(url.searchParams.get("start"));
  const end = parseOptionalDate(url.searchParams.get("end"));

  const maxLimit = Number.parseInt(process.env.DRILLDOWN_MAX_LIMIT || "100", 10);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10))
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") || "0", 10)
  );
  const order: "asc" | "desc" =
    url.searchParams.get("order")?.trim().toLowerCase() === "asc" ? "asc" : "desc";

  const includeUntagged =
    url.searchParams.get("include_untagged")?.trim().toLowerCase() === "true";
  const useRawMattermost =
    includeUntagged && sources.length === 1 && sources[0] === "mattermost";

  const filters = {
    dataset: datasetName,
    behavior,
    from_id,
    to_id,
    sources: sources.length > 0 ? sources : undefined,
    teams: teams.length > 0 ? teams : undefined,
    start: start?.toISOString(),
    end: end?.toISOString(),
  };

  const { events, total } = useRawMattermost
    ? await queryRawChannelEvents(datasetName, filters, limit, offset, order)
    : await queryEdgeEvents(datasetName, filters, limit, offset, order);

  return NextResponse.json({
    dataset: datasetName,
    events,
    total,
    limit,
    offset,
    total_pages: calcTotalPages(total, limit),
  });
}
