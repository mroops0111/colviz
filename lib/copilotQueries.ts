/**
 * Shared query logic for CopilotKit backend actions and drilldown API.
 * Used by getInteractionEvents, getInteractionSummary, and app/api/drilldown/route.ts.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parsePayloadJson } from "@/lib/payload";
import { BEHAVIOR_ORDER } from "@/lib/dataProcessor";
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
  offset: number = 0,
  order: "asc" | "desc" = "desc"
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
      orderBy: { occurredAt: order },
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

/**
 * Extract a single behavior label from a payload `category` string (best effort).
 * Returns "" if no known behavior is present (untagged message).
 */
function extractBehaviorFromCategory(category: unknown): string {
  if (typeof category !== "string") return "";
  const lower = category.toLowerCase();
  for (const b of BEHAVIOR_ORDER) {
    if (lower.includes(b)) return b;
  }
  if (lower.includes("collaboration")) return "improving";
  return "";
}

/**
 * Mattermost-only: query the raw message stream from RawItem so we include
 * messages without a behavior tag (which never enter the Interaction table).
 *
 * Returns events shaped like DrilldownEventRecord. For untagged rows
 * `behavior` is "" (extracted best-effort from payload.category) and
 * `to_id`/`to` are "" (raw messages have no recipient). `team_id`/`team` come
 * from the rawItem's own Interaction when one exists, otherwise from the
 * channel's primary team derived from tagged interactions in the same date
 * range — so team_id is always a real actor key (T1/S1/...) when the channel
 * has any tagged activity, never a channel name.
 *
 * Opt-in via `include_untagged=true`. UI / charts do not opt in.
 */
export async function queryRawChannelEvents(
  datasetName: string,
  filters: EdgeQueryFilters,
  limit: number = 50,
  offset: number = 0,
  order: "asc" | "desc" = "desc"
): Promise<{ events: DrilldownEventRecord[]; total: number }> {
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return { events: [], total: 0 };
  }

  const resolvedFrom = filters.from_id
    ? await resolveActorKey(dataset.id, filters.from_id)
    : null;

  const start = parseOptionalDate(filters.start ?? null);
  const end = parseOptionalDate(filters.end ?? null);
  const teams = parseCsvList(filters.teams);

  const occurredAtFilter: { gte?: Date; lte?: Date } = {};
  if (start) occurredAtFilter.gte = start;
  if (end) occurredAtFilter.lte = end;

  // Build channel → primary team mapping from tagged interactions in the date
  // range. We use this for two things:
  //   (1) when `teams` is set, restrict to channels whose tagged interactions
  //       touch one of those teams (the channel becomes the unit of relevance,
  //       not the author — author-based filtering pulled in cross-stage chatter
  //       in unrelated channels)
  //   (2) assign team_id to untagged events whose RawItem has no Interaction
  //       row (so team_id is always a real actor key like T1/S1, never a
  //       channel name)
  type TeamInfo = { actorKey: string; name: string };
  const taggedRows = await prisma.interaction.findMany({
    where: {
      datasetId: dataset.id,
      source: { key: "mattermost" },
      ...(Object.keys(occurredAtFilter).length > 0
        ? { occurredAt: occurredAtFilter }
        : {}),
      team: { isNot: null },
      rawItem: { isNot: null },
    },
    select: {
      team: { select: { actorKey: true, name: true } },
      rawItem: { select: { payloadJson: true } },
    },
  });
  const channelTeamCounts = new Map<string, Map<string, { team: TeamInfo; count: number }>>();
  for (const row of taggedRows) {
    const payload = parsePayloadJson(row.rawItem?.payloadJson ?? null);
    const channel = payload && typeof payload.channel === "string" ? payload.channel : "";
    const team = row.team;
    if (!channel || !team) continue;
    if (!channelTeamCounts.has(channel)) channelTeamCounts.set(channel, new Map());
    const inner = channelTeamCounts.get(channel)!;
    const existing = inner.get(team.actorKey);
    if (existing) existing.count += 1;
    else inner.set(team.actorKey, { team: { actorKey: team.actorKey, name: team.name }, count: 1 });
  }
  const channelPrimary = new Map<string, TeamInfo>();
  for (const [channel, counts] of channelTeamCounts) {
    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    if (teams.length > 0) {
      const match = sorted.find((c) => teams.includes(c.team.actorKey));
      if (match) channelPrimary.set(channel, match.team);
    } else if (sorted.length > 0) {
      channelPrimary.set(channel, sorted[0].team);
    }
  }
  if (teams.length > 0 && channelPrimary.size === 0) {
    return { events: [], total: 0 };
  }

  const where: Prisma.RawItemWhereInput = {
    datasetId: dataset.id,
    sourceItemType: "mattermost_message",
    source: { key: "mattermost" },
    ...(Object.keys(occurredAtFilter).length > 0
      ? { occurredAt: occurredAtFilter }
      : {}),
    ...(filters.from_id
      ? { authorActor: { actorKey: resolvedFrom ?? filters.from_id } }
      : {}),
  };

  // Channel filter lives in payloadJson, which Prisma can't filter on for
  // SQLite. Fetch all matching raw items, then filter & slice in memory. The
  // dataset is small enough (a few thousand rows max) that this is fine.
  const allRawItems = await prisma.rawItem.findMany({
    where,
    orderBy: { occurredAt: order },
    include: {
      source: true,
      authorActor: true,
      interactions: {
        take: 1,
        select: { team: { select: { actorKey: true, name: true } } },
      },
    },
  });

  const wantBehavior = filters.behavior;
  const wantToId = filters.to_id;
  const matched: DrilldownEventRecord[] = [];

  for (const r of allRawItems) {
    const payload = parsePayloadJson(r.payloadJson);
    const channel =
      payload && typeof payload.channel === "string" ? payload.channel : "";
    const scope =
      payload && typeof payload.scope === "string" ? payload.scope : "";
    const behavior = extractBehaviorFromCategory(payload?.category);

    if (teams.length > 0 && !channelPrimary.has(channel)) continue;
    if (wantBehavior && behavior !== wantBehavior) continue;
    // RawItem has no recipient — if caller insists on a to_id, drop the row.
    if (wantToId) continue;

    // Prefer the actual tagged team for this rawItem; fall back to the
    // channel's primary team for untagged messages.
    const taggedTeam = r.interactions[0]?.team ?? null;
    const primary = channelPrimary.get(channel);
    const teamInfo = taggedTeam ?? primary ?? null;

    matched.push({
      id: r.id,
      datetime: (r.occurredAt ?? new Date(0)).toISOString(),
      date: (r.occurredAt ?? new Date(0)).toISOString().slice(0, 10),
      source: r.source.key,
      scope,
      team_id: teamInfo?.actorKey ?? "",
      team: teamInfo?.name ?? "",
      behavior,
      from_id: r.authorActor?.actorKey ?? "",
      from: r.authorActor?.name ?? "",
      to_id: "",
      to: "",
      weight: 1,
      rawItem: {
        id: r.id,
        sourceItemType: r.sourceItemType,
        sourceItemId: r.sourceItemId,
        title: r.title,
        content: r.contentText ?? "",
        contentFormat: r.contentFormat ?? "plain",
        payload,
      },
    });
  }

  const total = matched.length;
  const events = matched.slice(offset, offset + limit);
  return { events, total };
}

/**
 * Aggregate stats for the *entire* filtered set (across all pages).
 *
 * Owns *all* aggregate views the AI gets: how many events total, how they
 * split across behaviors, and how the volume distributes over Day-N buckets.
 * Per-pair counts are intentionally NOT here — they're carried by
 * queryListInteractionSummaries() (one row per from×to×behavior). This way
 * getInteractionSummary owns "shape of the data" and getInteractionEvents
 * owns "the events themselves" with no overlap.
 */
export interface InteractionAggregateSummary {
  event_count: number;
  by_behavior: Record<string, number>;
  by_day: Record<string, number>;
}

export async function summarizeInteractions(
  datasetName: string,
  filters: EdgeQueryFilters,
  /** ISO date of Day 1; required to bucket by_day under "Day N" labels. */
  minDateIso: string | null
): Promise<InteractionAggregateSummary> {
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return { event_count: 0, by_behavior: {}, by_day: {} };
  }

  const [resolvedFrom, resolvedTo] = await Promise.all([
    filters.from_id ? resolveActorKey(dataset.id, filters.from_id) : null,
    filters.to_id ? resolveActorKey(dataset.id, filters.to_id) : null,
  ]);
  const where = buildDrilldownWhere(dataset.id, {
    ...filters,
    from_id: filters.from_id ? (resolvedFrom ?? filters.from_id) : undefined,
    to_id: filters.to_id ? (resolvedTo ?? filters.to_id) : undefined,
  });

  const rows = await prisma.interaction.findMany({
    where,
    select: { behavior: true, occurredAt: true },
  });

  const by_behavior: Record<string, number> = {};
  const by_day: Record<string, number> = {};

  // Day-N bucketing mirrors lib/dayLabel.dateToDayNumber (whole-day diff from min date).
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const minDayMs = minDateIso
    ? new Date(new Date(minDateIso).getFullYear(), new Date(minDateIso).getMonth(), new Date(minDateIso).getDate()).getTime()
    : null;

  for (const r of rows) {
    by_behavior[r.behavior] = (by_behavior[r.behavior] ?? 0) + 1;

    if (minDayMs != null) {
      const d = r.occurredAt;
      const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayNum = Math.round((localMidnight - minDayMs) / MS_PER_DAY) + 1;
      const key = `Day ${dayNum}`;
      by_day[key] = (by_day[key] ?? 0) + 1;
    }
  }

  return { event_count: rows.length, by_behavior, by_day };
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
const SUMMARY_HARD_CAP = 500;

export async function queryListInteractionSummaries(
  datasetName: string,
  filters: Omit<EdgeQueryFilters, "from_id" | "to_id">
): Promise<{ summaries: InteractionSummary[]; pair_count: number; capped: boolean }> {
  const dataset = await prisma.dataset.findUnique({
    where: { name: datasetName },
    select: { id: true },
  });
  if (!dataset) {
    return { summaries: [], pair_count: 0, capped: false };
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

  const behaviorRank = new Map<string, number>(BEHAVIOR_ORDER.map((b, i) => [b, i]));
  const all = Array.from(map.values()).sort((a, b) => {
    const bRank = (behaviorRank.get(a.behavior) ?? 99) - (behaviorRank.get(b.behavior) ?? 99);
    if (bRank !== 0) return bRank;
    return b.count - a.count;
  });
  const capped = all.length > SUMMARY_HARD_CAP;
  const summaries = capped ? all.slice(0, SUMMARY_HARD_CAP) : all;
  return { summaries, pair_count: all.length, capped };
}

