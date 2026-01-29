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

  // Filters
  const behavior = url.searchParams.get("behavior")?.trim() || null;
  const fromId = url.searchParams.get("from_id")?.trim() || null;
  const toId = url.searchParams.get("to_id")?.trim() || null;
  const sources = parseCsvList(url.searchParams.get("sources"));
  const teams = parseCsvList(url.searchParams.get("teams"));

  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  // Pagination
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10))
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") || "0", 10)
  );

  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return NextResponse.json({ dataset: datasetName, events: [], total: 0 });
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

  // Build where clause for interactions
  const where: Parameters<typeof prisma.interaction.findMany>[0]["where"] = {
    datasetId: dataset.id,
    ...(Object.keys(occurredAtFilter).length > 0
      ? { occurredAt: occurredAtFilter }
      : {}),
    ...(behavior ? { behavior } : {}),
    ...(fromId ? { fromActor: { actorKey: fromId } } : {}),
    ...(toId ? { toActor: { actorKey: toId } } : {}),
    ...(sources.length > 0 ? { source: { key: { in: sources } } } : {}),
    ...(teams.length > 0 ? { team: { actorKey: { in: teams } } } : {}),
  };

  const [interactions, total] = await Promise.all([
    prisma.interaction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        source: true,
        fromActor: true,
        toActor: true,
        team: true,
        rawItem: true,
      },
    }),
    prisma.interaction.count({ where }),
  ]);

  const events = interactions.map((it) => ({
    id: it.id,
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
    // Raw item content (if linked)
    rawItem: it.rawItem
      ? {
          id: it.rawItem.id,
          sourceItemType: it.rawItem.sourceItemType,
          sourceItemId: it.rawItem.sourceItemId,
          title: it.rawItem.title,
          content: it.rawItem.contentText,
          contentFormat: it.rawItem.contentFormat,
          payload: it.rawItem.payloadJson,
        }
      : null,
  }));

  return NextResponse.json({
    dataset: datasetName,
    events,
    total,
    limit,
    offset,
  });
}
