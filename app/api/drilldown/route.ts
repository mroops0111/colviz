import { NextResponse } from "next/server";
import { calcTotalPages, parseOptionalDate, parseSingleOrCsvList } from "@/lib/api-utils";
import { queryEdgeEvents } from "@/lib/copilotQueries";

export const runtime = "nodejs";

/** GET /api/drilldown - Accepts singular (team, source) or plural (teams, sources) query params. */
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

  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10))
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") || "0", 10)
  );

  const { events, total } = await queryEdgeEvents(
    datasetName,
    {
      dataset: datasetName,
      behavior,
      from_id,
      to_id,
      sources: sources.length > 0 ? sources : undefined,
      teams: teams.length > 0 ? teams : undefined,
      start: start?.toISOString(),
      end: end?.toISOString(),
    },
    limit,
    offset
  );

  return NextResponse.json({
    dataset: datasetName,
    events,
    total,
    limit,
    offset,
    total_pages: calcTotalPages(total, limit),
  });
}
