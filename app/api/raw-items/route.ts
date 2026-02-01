import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCsvList, parseOptionalDate } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";

  const sources = parseCsvList(url.searchParams.get("sources"));
  const sourceItemTypes = parseCsvList(url.searchParams.get("types"));
  const search = url.searchParams.get("q")?.trim() || null;
  const start = parseOptionalDate(url.searchParams.get("start"));
  const end = parseOptionalDate(url.searchParams.get("end"));

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
  if (start) occurredAtFilter.gte = start;
  if (end) occurredAtFilter.lte = end;

  // Build where clause
  const where: Prisma.RawItemWhereInput = {
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
