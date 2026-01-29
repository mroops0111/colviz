import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function parseCsvList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";

  const sources = parseCsvList(url.searchParams.get("sources"));
  const teams = parseCsvList(url.searchParams.get("teams"));

  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return NextResponse.json({ dataset: datasetName, data: [] });
  }

  const occurredAtFilter: { gte?: Date; lte?: Date } = {};
  if (start) {
    const d = new Date(start);
    if (!Number.isNaN(d.getTime())) occurredAtFilter.gte = d;
  }
  if (end) {
    const d = new Date(end);
    if (!Number.isNaN(d.getTime())) occurredAtFilter.lte = d;
  }

  const where = {
    datasetId: dataset.id,
    ...(Object.keys(occurredAtFilter).length > 0
      ? { occurredAt: occurredAtFilter }
      : {}),
    ...(sources.length > 0 ? { source: { key: { in: sources } } } : {}),
    ...(teams.length > 0 ? { team: { actorKey: { in: teams } } } : {}),
  } as const;

  const interactions = await prisma.interaction.findMany({
    where,
    orderBy: { occurredAt: "asc" },
      include: {
        source: true,
        fromActor: true,
        toActor: true,
        team: true,
      },
  });

  const data = interactions.map((it) => ({
    datetime: it.occurredAt.toISOString(),
    date: it.date,
    source: it.source.key,
    scope: it.scope,
    team_id: it.team?.actorKey ?? "",
    team: it.team?.name ?? "",
    behavior: it.behavior,
    from_id: it.fromActor.actorKey,
    from: it.fromActor.name,
    to_id: it.toActor.actorKey,
    to: it.toActor.name,
    weight: it.weight,
  }));

  return NextResponse.json({ dataset: datasetName, data });
}

