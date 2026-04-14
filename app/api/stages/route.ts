import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

export const runtime = "nodejs";

/**
 * GET /api/stages?dataset=default
 *
 * Returns stage actors with their day ranges derived from interaction dates.
 * Day numbers are relative to the dataset's earliest interaction date (Day 1).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";

  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return NextResponse.json({ dataset: datasetName, stages: [] });
  }

  // Find the dataset's global min date for day-number calculation
  const globalMin = await prisma.interaction.aggregate({
    where: { datasetId: dataset.id },
    _min: { occurredAt: true },
  });
  const minDate = globalMin._min.occurredAt;
  if (!minDate) {
    return NextResponse.json({ dataset: datasetName, stages: [] });
  }
  const minTime = new Date(
    minDate.getFullYear(),
    minDate.getMonth(),
    minDate.getDate(),
  ).getTime();
  const msPerDay = 1000 * 60 * 60 * 24;

  // Fetch all stage and team actors
  const allGroupActors = await prisma.actor.findMany({
    where: { datasetId: dataset.id, actorType: { in: ["stage", "team"] } },
    select: { id: true, actorKey: true, name: true, actorType: true },
  });
  const stageActors = allGroupActors.filter((a) => a.actorType === "stage");
  const teamActors = allGroupActors.filter((a) => a.actorType === "team");

  // Get date ranges for every group actor in one query
  const dateRanges: { team_id: string; min_at: bigint; max_at: bigint }[] =
    await prisma.$queryRaw`
      SELECT team_id, MIN(occurred_at) AS min_at, MAX(occurred_at) AS max_at
        FROM interactions
       WHERE dataset_id = ${dataset.id} AND team_id IS NOT NULL
       GROUP BY team_id
    `;

  const toDayNum = (ts: bigint) => {
    const dt = new Date(Number(ts));
    return (
      Math.round(
        (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - minTime) / msPerDay,
      ) + 1
    );
  };

  const rangeMap = new Map<string, { minDay: number; maxDay: number }>();
  for (const row of dateRanges) {
    rangeMap.set(row.team_id, { minDay: toDayNum(row.min_at), maxDay: toDayNum(row.max_at) });
  }

  // Match each team to the stage with the most temporal overlap
  const stageChildIds = new Map<string, string[]>();
  for (const s of stageActors) stageChildIds.set(s.id, []);

  for (const team of teamActors) {
    const tr = rangeMap.get(team.id);
    if (!tr) continue;
    let bestId = "";
    let bestOverlap = 0;
    for (const stage of stageActors) {
      const sr = rangeMap.get(stage.id);
      if (!sr) continue;
      const overlap = Math.max(0, Math.min(tr.maxDay, sr.maxDay) - Math.max(tr.minDay, sr.minDay) + 1);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = stage.id;
      }
    }
    if (bestId) stageChildIds.get(bestId)!.push(team.id);
  }

  // Compute final stage ranges (stage + child teams)
  const stages = stageActors.map((actor) => {
    const childIds = stageChildIds.get(actor.id) ?? [];
    const allIds = [actor.id, ...childIds];

    let startDay = Infinity;
    let endDay = -Infinity;
    for (const id of allIds) {
      const r = rangeMap.get(id);
      if (r) {
        startDay = Math.min(startDay, r.minDay);
        endDay = Math.max(endDay, r.maxDay);
      }
    }
    if (startDay === Infinity) return null;

    return { key: actor.actorKey, name: actor.name, startDay, endDay };
  });

  const validStages = stages
    .filter(Boolean)
    .sort((a, b) => a!.startDay - b!.startDay);

  return NextResponse.json({ dataset: datasetName, stages: validStages });
}
