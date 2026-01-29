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
  const sources = parseCsvList(url.searchParams.get("sources"));
  const sourceItemTypes = parseCsvList(url.searchParams.get("types"));
  const search = url.searchParams.get("q")?.trim() || null;

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
    return NextResponse.json({ dataset: datasetName, items: [], total: 0 });
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

  // Build where clause
  const where: Parameters<typeof prisma.rawItem.findMany>[0]["where"] = {
    datasetId: dataset.id,
    ...(Object.keys(occurredAtFilter).length > 0
      ? { occurredAt: occurredAtFilter }
      : {}),
    ...(sources.length > 0 ? { source: { key: { in: sources } } } : {}),
    ...(sourceItemTypes.length > 0
      ? { sourceItemType: { in: sourceItemTypes } }
      : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { contentText: { contains: search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.rawItem.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        source: true,
        authorActor: true,
      },
    }),
    prisma.rawItem.count({ where }),
  ]);

  const result = items.map((it) => ({
    id: it.id,
    source: it.source.key,
    sourceItemType: it.sourceItemType,
    sourceItemId: it.sourceItemId,
    occurredAt: it.occurredAt?.toISOString() ?? null,
    author: it.authorActor
      ? {
          id: it.authorActor.actorKey,
          name: it.authorActor.name,
        }
      : null,
    title: it.title,
    content: it.contentText,
    contentFormat: it.contentFormat,
    payload: it.payloadJson,
  }));

  return NextResponse.json({
    dataset: datasetName,
    items: result,
    total,
    limit,
    offset,
  });
}
