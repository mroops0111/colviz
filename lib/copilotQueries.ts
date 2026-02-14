/**
 * Shared query logic for CopilotKit backend actions and drilldown API.
 * Used by getInteractionEvents, listInteractions, and app/api/drilldown/route.ts.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parsePayloadJson } from "@/lib/payload";
import type { DrilldownEventRecord } from "@/lib/types";

/** Common filter inputs for edge/event queries */
export interface EdgeQueryFilters {
  dataset?: string;
  behavior?: string;
  from_id?: string;
  to_id?: string;
  sources?: string[];
  teams?: string[];
  start?: string;
  end?: string;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCsvList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve actor key case-insensitively so "m4" matches DB "M4".
 * Returns the actual actorKey from DB or null if not found.
 */
async function resolveActorKey(
  datasetId: string,
  key: string
): Promise<string | null> {
  const row = await prisma.$queryRawUnsafe<[{ actor_key: string }]>(
    "SELECT actor_key FROM actors WHERE dataset_id = ? AND LOWER(actor_key) = LOWER(?) LIMIT 1",
    datasetId,
    key
  );
  return row[0]?.actor_key ?? null;
}

/**
 * Build Prisma where clause for interactions from filter params.
 */
export function buildDrilldownWhere(
  datasetId: string,
  filters: EdgeQueryFilters
): Prisma.InteractionWhereInput {
  const start = parseOptionalDate(filters.start ?? null);
  const end = parseOptionalDate(filters.end ?? null);
  const sources = parseCsvList(filters.sources);
  const teams = parseCsvList(filters.teams);

  const occurredAtFilter: { gte?: Date; lte?: Date } = {};
  if (start) occurredAtFilter.gte = start;
  if (end) occurredAtFilter.lte = end;

  return {
    datasetId,
    ...(Object.keys(occurredAtFilter).length > 0
      ? { occurredAt: occurredAtFilter }
      : {}),
    ...(filters.behavior ? { behavior: filters.behavior } : {}),
    ...(filters.from_id ? { fromActor: { actorKey: filters.from_id } } : {}),
    ...(filters.to_id ? { toActor: { actorKey: filters.to_id } } : {}),
    ...(sources.length > 0 ? { source: { key: { in: sources } } } : {}),
    ...(teams.length > 0 ? { team: { actorKey: { in: teams } } } : {}),
  };
}

type InteractionWithRelations = Prisma.InteractionGetPayload<{
  include: {
    source: true;
    fromActor: true;
    toActor: true;
    team: true;
    rawItem: true;
  };
}>;

function mapInteractionToEvent(it: InteractionWithRelations): DrilldownEventRecord {
  return {
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
    rawItem: it.rawItem
      ? {
          id: it.rawItem.id,
          sourceItemType: it.rawItem.sourceItemType,
          sourceItemId: it.rawItem.sourceItemId,
          title: it.rawItem.title,
          content: it.rawItem.contentText,
          contentFormat: it.rawItem.contentFormat,
          payload: parsePayloadJson(it.rawItem.payloadJson),
        }
      : null,
  };
}

/**
 * Query events for a single edge (or filtered set). Same logic as drilldown API.
 */
export async function queryEdgeEvents(
  datasetName: string,
  filters: EdgeQueryFilters,
  limit: number = 50,
  offset: number = 0
): Promise<{ events: DrilldownEventRecord[]; total: number }> {
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return { events: [], total: 0 };
  }

  // Resolve actor keys case-insensitively (e.g. "m4" -> "M4") so AI-provided ids match DB
  const [resolvedFrom, resolvedTo] = await Promise.all([
    filters.from_id ? resolveActorKey(dataset.id, filters.from_id) : null,
    filters.to_id ? resolveActorKey(dataset.id, filters.to_id) : null,
  ]);
  const effectiveFilters: EdgeQueryFilters = {
    ...filters,
    from_id: filters.from_id ? (resolvedFrom ?? filters.from_id) : undefined,
    to_id: filters.to_id ? (resolvedTo ?? filters.to_id) : undefined,
  };

  const where = buildDrilldownWhere(dataset.id, effectiveFilters);

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

  const events = interactions.map(mapInteractionToEvent);
  return { events, total };
}

export interface InteractionSummary {
  behavior: string;
  from_id: string;
  to_id: string;
  from_name: string;
  to_name: string;
  count: number;
}

/**
 * List interactions aggregated by (from, to, behavior) with total weight as count.
 */
export async function queryListInteractionSummaries(
  datasetName: string,
  filters: Omit<EdgeQueryFilters, "from_id" | "to_id">,
  limit: number = 50
): Promise<{ summaries: InteractionSummary[]; total: number }> {
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return { summaries: [], total: 0 };
  }

  const where = buildDrilldownWhere(dataset.id, filters);

  const interactions = await prisma.interaction.findMany({
    where,
    select: {
      fromActorId: true,
      toActorId: true,
      behavior: true,
      weight: true,
      fromActor: { select: { actorKey: true, name: true } },
      toActor: { select: { actorKey: true, name: true } },
    },
  });

  const key = (fromId: string, toId: string, behavior: string) =>
    `${fromId}\t${toId}\t${behavior}`;
  const map = new Map<
    string,
    { behavior: string; from_id: string; to_id: string; from_name: string; to_name: string; count: number }
  >();

  for (const it of interactions) {
    const k = key(it.fromActorId, it.toActorId, it.behavior);
    const existing = map.get(k);
    const fromKey = it.fromActor.actorKey;
    const toKey = it.toActor.actorKey;
    const fromName = it.fromActor.name;
    const toName = it.toActor.name;
    if (existing) {
      existing.count += it.weight;
    } else {
      map.set(k, {
        behavior: it.behavior,
        from_id: fromKey,
        to_id: toKey,
        from_name: fromName,
        to_name: toName,
        count: it.weight,
      });
    }
  }

  const summaries = Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { summaries, total: map.size };
}
