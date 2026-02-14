import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePayloadJson, normalizePayloadFiles } from "@/lib/payload";

export const runtime = "nodejs";

/** Message row returned for a channel (source-agnostic shape; payload parsing is source-specific). */
export interface ChannelMessage {
  id: string;
  occurredAt: string;
  author: string;
  authorId: string;
  content: string;
  files: string[];
  behavior: string | null;
  thread: string | null;
  scope: string | null;
}

/** Map source key to RawItem sourceItemType (DB convention). */
const SOURCE_ITEM_TYPES: Record<string, string> = {
  mattermost: "mattermost_message",
  // future: slack: "slack_message", etc.
};

/**
 * GET /api/channel-messages?dataset=default&channel=Community&source=mattermost
 * Returns messages in the given channel for the given source (Dataset + Source in DB).
 * source defaults to "mattermost"; channel is required (interpretation is source-specific, e.g. Mattermost channel name).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";
  const channel = url.searchParams.get("channel")?.trim();
  const sourceKey = url.searchParams.get("source")?.trim() || "mattermost";

  if (!channel) {
    return NextResponse.json(
      { error: "Missing required query: channel" },
      { status: 400 }
    );
  }

  const sourceItemType = SOURCE_ITEM_TYPES[sourceKey];
  if (!sourceItemType) {
    return NextResponse.json(
      { error: `Unsupported source: ${sourceKey}` },
      { status: 400 }
    );
  }

  try {
    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName },
    });
    if (!dataset) {
      return NextResponse.json(
        { error: `Dataset not found: ${datasetName}` },
        { status: 404 }
      );
    }

    const source = await prisma.source.findUnique({
      where: { key: sourceKey },
    });
    if (!source) {
      return NextResponse.json(
        { error: `Source not found: ${sourceKey}` },
        { status: 404 }
      );
    }

    const raw = await prisma.rawItem.findMany({
      where: {
        datasetId: dataset.id,
        sourceId: source.id,
        sourceItemType,
      },
      include: { authorActor: true },
      orderBy: { occurredAt: "asc" },
    });

    const messages: ChannelMessage[] = [];
    for (const row of raw) {
      const p = parsePayloadJson(row.payloadJson);
      const rowChannel =
        p && typeof p.channel === "string" ? p.channel.trim() : "";
      if (rowChannel !== channel) continue;

      let behavior: string | null = null;
      let threadVal: string | null = null;
      let scope: string | null = null;
      let files: string[] = [];
      if (p) {
        const cat = (p.category as string) || "";
        const lower = cat.toLowerCase();
        if (lower.includes("awareness")) behavior = "awareness";
        else if (lower.includes("sharing")) behavior = "sharing";
        else if (lower.includes("coordination")) behavior = "coordination";
        else if (lower.includes("improving") || lower.includes("collaboration"))
          behavior = "improving";
        threadVal = typeof p.thread === "string" ? p.thread : null;
        scope = typeof p.scope === "string" ? p.scope : null;
        files = normalizePayloadFiles(p.files);
      }

      messages.push({
        id: row.id,
        occurredAt: (row.occurredAt ?? new Date(0)).toISOString(),
        author: row.authorActor?.name ?? "—",
        authorId: row.authorActor?.actorKey ?? row.authorActor?.id ?? "—",
        content: row.contentText ?? "",
        files,
        behavior,
        thread: threadVal,
        scope,
      });
    }

    return NextResponse.json({
      channel,
      source: sourceKey,
      messages,
    });
  } catch (err) {
    console.error("channel-messages API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch channel messages" },
      { status: 500 }
    );
  }
}
