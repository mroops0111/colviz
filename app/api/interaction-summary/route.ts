import { NextResponse } from "next/server";
import { parseOptionalDate, parseSingleOrCsvList } from "@/lib/api-utils";
import { queryListInteractionSummaries, summarizeInteractions } from "@/lib/copilotQueries";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/interaction-summary - Owns *all* aggregate views for the AI:
 * per (from, to, behavior) counts plus a full-scope `summary` block
 * (total_events, by_behavior, by_day) for the entire filtered set.
 *
 * Accepts singular (team, source) or plural (teams, sources) query params.
 * Returns ALL pairs sorted by behavior (BEHAVIOR_ORDER) then count desc.
 * Hard cap: 500 pairs (capped:true added to response if exceeded).
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
  const filters = {
    behavior,
    sources: sources.length > 0 ? sources : undefined,
    teams: teams.length > 0 ? teams : undefined,
    start: start?.toISOString(),
    end: end?.toISOString(),
  };

  // by_day buckets need the dataset's earliest occurredAt as Day 1.
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  const minIsoPromise = dataset
    ? prisma.interaction
        .aggregate({
          where: { datasetId: dataset.id },
          _min: { occurredAt: true },
        })
        .then((r) => r._min.occurredAt?.toISOString() ?? null)
    : Promise.resolve(null);

  const [{ summaries, pair_count, capped }, minIso] = await Promise.all([
    queryListInteractionSummaries(datasetName, filters),
    minIsoPromise,
  ]);
  const summary = await summarizeInteractions(datasetName, filters, minIso);

  return NextResponse.json({
    dataset: datasetName,
    summary,
    summaries,
    pair_count,
    ...(capped ? { capped: true } : {}),
  });
}
