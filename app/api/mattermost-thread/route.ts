import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePayloadJson } from "@/lib/payload";

export const runtime = "nodejs";

export interface MattermostThreadMessage {
  id: string;
  occurredAt: string;
  author: string;
  content: string;
  behavior: string | null;
  thread: string | null;
  scope: string | null;
}

/**
 * GET /api/mattermost-thread?dataset=default&channel=Community
 * Returns all mattermost messages in the channel (payload filtered in app code).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const datasetName = url.searchParams.get("dataset")?.trim() || "default";
  const channel = url.searchParams.get("channel")?.trim();

  if (!channel) {
    return NextResponse.json(
      { error: "Missing required query: channel" },
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
      where: { key: "mattermost" },
    });
    if (!source) {
      return NextResponse.json(
        { error: "Mattermost source not found" },
        { status: 404 }
      );
    }

    const raw = await prisma.rawItem.findMany({
      where: {
        datasetId: dataset.id,
        sourceId: source.id,
        sourceItemType: "mattermost_message",
      },
      include: { authorActor: true },
      orderBy: { occurredAt: "asc" },
    });

    const messages: MattermostThreadMessage[] = [];
    for (const row of raw) {
      const p = parsePayloadJson(row.payloadJson);
      const rowChannel =
        p && typeof p.channel === "string" ? p.channel.trim() : "";
      if (rowChannel !== channel) continue;

      let behavior: string | null = null;
      let threadVal: string | null = null;
      let scope: string | null = null;
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
      }

      messages.push({
        id: row.id,
        occurredAt: (row.occurredAt ?? new Date(0)).toISOString(),
        author: row.authorActor?.name ?? "—",
        content: row.contentText ?? "",
        behavior,
        thread: threadVal,
        scope,
      });
    }

    return NextResponse.json({
      channel,
      messages,
    });
  } catch (err) {
    console.error("mattermost-thread API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 }
    );
  }
}
