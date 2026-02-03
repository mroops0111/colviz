import { NextResponse } from "next/server";
import { parseOptionalDate, parseSingleOrCsvList } from "@/lib/api-utils";
import { queryListInteractionSummaries } from "@/lib/copilotQueries";

export const runtime = "nodejs";

/**
 * GET /api/interaction-summary - List collaboration interaction summaries (aggregated by from, to, behavior).
 * Accepts singular (team, source) or plural (teams, sources) query params. Limit optional (default 50).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";
  const behavior = url.searchParams.get("behavior")?.trim() || undefined;
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

  const { summaries, total } = await queryListInteractionSummaries(
    datasetName,
    {
      behavior,
      sources: sources.length > 0 ? sources : undefined,
      teams: teams.length > 0 ? teams : undefined,
      start: start?.toISOString(),
      end: end?.toISOString(),
    },
    limit
  );

  return NextResponse.json({ dataset: datasetName, summaries, total, limit });
}
