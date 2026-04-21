"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useCopilotReadable,
  useFrontendTool,
  useCopilotChatInternal,
} from "@copilotkit/react-core";
import type { Message as AGUIMessage, Parameter } from "@copilotkit/shared";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { List, GitBranch, PanelRightOpen } from "lucide-react";
import { BEHAVIOR_ORDER } from "../../lib/dataProcessor";
import type { ProjectContext } from "../../lib/types";
import { dateToDayLabel, datetimeToDayLabel, dayNumberToDate } from "../../lib/dayLabel";
import { getColvizSystemPrompt } from "../../prompts/system-message";
import { ToolExecutionCard } from "./ToolExecutionCard";
import { resolveCardStatusAndHint } from "./toolCardStatus";
import { SaveReportCard, buildEventsFromMessages } from "./SaveReportCard";

// -----------------------------------------------------------------------------
// URL builders
// -----------------------------------------------------------------------------

function appendParams(params: URLSearchParams, args: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = args[k];
    if (v == null || v === "") continue;
    params.set(k, typeof v === "number" ? String(v) : String(v));
  }
}

function buildDrilldownUrl(args: Record<string, unknown>): string {
  const p = new URLSearchParams();
  p.set("dataset", (args.dataset as string) || "default");
  appendParams(p, args, ["behavior", "from_id", "to_id", "start", "end", "source", "team"]);
  return `/api/drilldown?${p.toString()}`;
}

function buildInteractionSummaryUrl(args: Record<string, unknown>): string {
  const p = new URLSearchParams();
  p.set("dataset", (args.dataset as string) || "default");
  appendParams(p, args, ["behavior", "source", "team", "start", "end"]);
  return `/api/interaction-summary?${p.toString()}`;
}

// -----------------------------------------------------------------------------
// Tool parameter schemas
// -----------------------------------------------------------------------------

const getInteractionEventsParameters: Parameter[] = [
  { name: "behavior", type: "string", description: "One of: " + BEHAVIOR_ORDER.join(", "), required: true },
  { name: "from_id", type: "string", description: "Member ID (e.g., M1)", required: true },
  { name: "to_id", type: "string", description: "Member ID (e.g., M2)", required: true },
  { name: "start", type: "number", description: "Start day number (e.g. 1 for Day 1)", required: false },
  { name: "end", type: "number", description: "End day number (e.g. 10 for Day 10)", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "team", type: "string", description: "Team name (omit for all)", required: false },
  { name: "offset", type: "number", description: "Pagination offset (default 0). Use with total_pages in the response to fetch subsequent pages.", required: false },
];

const listInteractionsParameters: Parameter[] = [
  { name: "behavior", type: "string", description: `Optional filter. One of: ${BEHAVIOR_ORDER.join(", ")}`, required: false },
  { name: "team", type: "string", description: "Team name (omit for all)", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "start", type: "number", description: "Start day number (e.g. 1 for Day 1)", required: false },
  { name: "end", type: "number", description: "End day number (e.g. 10 for Day 10)", required: false },
  { name: "offset", type: "number", description: "Pagination offset (default 0). Use with total_pages in the response to fetch subsequent pages.", required: false },
];

// -----------------------------------------------------------------------------
// Argument validation
// -----------------------------------------------------------------------------

function validateBehaviorTeamSource(
  args: Record<string, unknown>,
  ctx: ProjectContext | undefined
): string | null {
  if (!ctx) return null;
  const behavior = args.behavior as string | undefined;
  if (behavior?.trim() && !ctx.behaviors.includes(behavior.trim())) {
    return `Invalid behavior "${behavior}". Allowed: ${ctx.behaviors.join(", ")}.`;
  }
  const team = args.team as string | undefined;
  const teamIds = ctx.teams.map((t) => t.id);
  if (team?.trim() && !teamIds.includes(team.trim())) {
    return `Invalid team "${team}". Allowed: ${teamIds.join(", ")}.`;
  }
  const source = args.source as string | undefined;
  if (source?.trim() && !ctx.sources.includes(source.trim())) {
    return `Invalid source "${source}". Allowed: ${ctx.sources.join(", ")}.`;
  }
  return null;
}

function getAllowedActorIds(ctx: ProjectContext | undefined): Set<string> {
  if (!ctx) return new Set();
  return new Set(ctx.members.map((m) => m.id));
}

function actorIdInSet(id: string, allowedIds: Set<string>): boolean {
  const trimmed = id.trim();
  if (allowedIds.has(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return [...allowedIds].some((a) => a.toLowerCase() === lower);
}

function memberIdError(
  id: string,
  allowedIds: Set<string>,
  param: "from_id" | "to_id" = "from_id"
): string {
  const ids = Array.from(allowedIds).slice(0, 20);
  return `Invalid ${param} "${id}". Use a member ID (e.g. ${ids.join(", ")}${allowedIds.size > 20 ? "…" : ""}).`;
}

function validateGetInteractionEvents(
  args: Record<string, unknown>,
  ctx: ProjectContext | undefined
): string | null {
  const err = validateBehaviorTeamSource(args, ctx);
  if (err) return err;
  if (!ctx) return null;
  const allowedIds = getAllowedActorIds(ctx);
  const from_id = args.from_id as string | undefined;
  if (from_id?.trim() && !actorIdInSet(from_id, allowedIds)) return memberIdError(from_id, allowedIds, "from_id");
  const to_id = args.to_id as string | undefined;
  if (to_id?.trim() && !actorIdInSet(to_id, allowedIds)) return memberIdError(to_id, allowedIds, "to_id");
  return null;
}

function validateOpenDrilldown(
  args: { from_id?: string; to_id?: string },
  ctx: ProjectContext | undefined
): string | null {
  if (!ctx) return null;
  const allowedIds = getAllowedActorIds(ctx);
  const from_id = args.from_id?.trim();
  if (from_id && !actorIdInSet(from_id, allowedIds)) return memberIdError(from_id, allowedIds, "from_id");
  const to_id = args.to_id?.trim();
  if (to_id && !actorIdInSet(to_id, allowedIds)) return memberIdError(to_id, allowedIds, "to_id");
  return null;
}

// -----------------------------------------------------------------------------
// Day-number → ISO conversion + payload anonymization
// -----------------------------------------------------------------------------

/** Convert day-number args (start/end) to ISO date strings for API calls. */
function convertDayArgs(
  args: Record<string, unknown>,
  dataMinDate: string | undefined
): Record<string, unknown> {
  if (!dataMinDate) return args;
  const result = { ...args };
  const startDay = args.start != null ? Number(args.start) : null;
  const endDay = args.end != null ? Number(args.end) : null;
  if (startDay != null && !Number.isNaN(startDay)) {
    result.start = dayNumberToDate(startDay, dataMinDate).toISOString();
  }
  if (endDay != null && !Number.isNaN(endDay)) {
    result.end = dayNumberToDate(endDay, dataMinDate).toISOString();
  }
  return result;
}

/** Build a name→id map from project context (mirrors DatasetContext.name_map in api_client.py). */
function buildNameMap(ctx: ProjectContext | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!ctx) return map;
  for (const m of ctx.members) map.set(m.name, m.id);
  for (const t of ctx.teams) map.set(t.name, t.id);
  return map;
}

function replaceWithId(value: unknown, nameMap: Map<string, string>): unknown {
  if (typeof value === "string") return nameMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceWithId(v, nameMap));
  return value;
}

const PAYLOAD_NAME_KEYS = new Set(["members", "team", "teams"]);

/** Replace name fields in rawItem.payload with actor IDs (mirrors _anonymize_event in api_client.py). */
function anonymizePayload(
  event: Record<string, unknown>,
  nameMap: Map<string, string>
): Record<string, unknown> {
  const rawItem = event.rawItem;
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return event;
  const ri = rawItem as Record<string, unknown>;
  const payload = ri.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return event;
  const cleanPayload = Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([k, v]) =>
      PAYLOAD_NAME_KEYS.has(k) ? [k, replaceWithId(v, nameMap)] : [k, v]
    )
  );
  return { ...event, rawItem: { ...ri, payload: cleanPayload } };
}

/** Anonymize a single drilldown event: strip names, replace payload IDs, convert dates to Day N. */
function anonymizeEvent(
  e: unknown,
  dataMinDate: string | undefined,
  nameMap: Map<string, string>
): Record<string, unknown> {
  const { from, to, ...ev } = e as Record<string, unknown>;
  void from;
  void to;
  const dated = {
    ...ev,
    ...(dataMinDate && typeof ev.date === "string"
      ? { date: dateToDayLabel(ev.date, dataMinDate) }
      : {}),
    ...(dataMinDate && typeof ev.datetime === "string"
      ? { datetime: datetimeToDayLabel(ev.datetime, dataMinDate) }
      : {}),
  };
  return anonymizePayload(dated, nameMap);
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface FrontendToolsProps {
  onOpenDrilldown?: (args: { from_id: string; to_id: string }) => void;
  projectContext?: ProjectContext;
  dataMinDate?: string;
}

export function FrontendTools({
  onOpenDrilldown,
  projectContext,
  dataMinDate,
}: FrontendToolsProps = {}) {
  // NOTE: deliberately use the *internal* hook here. In this version of
  // CopilotKit the public `useCopilotMessagesContext` returns a state slot
  // that nothing populates (the live chat log lives on the agent), and
  // `useCopilotChat` strips the `messages` field from its return type. The
  // internal hook is the only OSS-friendly way to read AG-UI messages + the
  // current threadId in a single reactive subscription.
  const chat = useCopilotChatInternal() as unknown as {
    messages: AGUIMessage[];
    threadId?: string;
  };

  // useFrontendTool only captures the initial handler reference, so the
  // handler closure can otherwise see a stale `messages` array. Mirror the
  // latest values into refs on every render so the handler always reads
  // them fresh.
  const messagesRef = useRef<AGUIMessage[]>(chat.messages);
  const threadIdRef = useRef<string | undefined>(chat.threadId);
  useEffect(() => {
    messagesRef.current = chat.messages;
  }, [chat.messages]);
  useEffect(() => {
    threadIdRef.current = chat.threadId;
  }, [chat.threadId]);

  // Default suggestions: cumulative N-day summaries using stage end days as milestones
  const suggestions = useMemo(() => {
    const stages = projectContext?.stages ?? [];
    if (stages.length === 0) return [];
    return stages.map((s) => ({
      title: `${s.name} collaboration summary`,
      message: `Provide a collaboration summary from Day ${s.startDay} to Day ${s.endDay}. Include key behavior patterns, notable member pairs, and any areas that may need attention. Save the analysis to disk directly and do not repeat the analysis.`,
    }));
  }, [projectContext?.stages]);
  useCopilotChatSuggestions(
    {
      suggestions,
      available: suggestions.length > 0 ? "before-first-message" : "disabled",
    },
    [suggestions]
  );

  const readableValue = useMemo(
    () =>
      projectContext
        ? {
            sources: projectContext.sources,
            teams: projectContext.teams,
            members: projectContext.members,
            behaviors: projectContext.behaviors,
            dataRange: projectContext.dataRange,
          }
        : null,
    [projectContext]
  );
  useCopilotReadable(
    {
      description:
        "ColViz dataset context: allowed sources, teams, members (ID + name), and behaviors.",
      value: readableValue,
      available: readableValue ? "enabled" : "disabled",
    },
    [readableValue]
  );

  useFrontendTool({
    name: "getInteractionEvents",
    description:
      "Get detailed collaboration events and raw data for interactions between two members (from_id → to_id), filtered by behavior, team, source, start, end.",
    parameters: getInteractionEventsParameters,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateGetInteractionEvents(args, projectContext);
        if (err) return JSON.stringify({ error: err, events: [], total: 0 });
        const apiArgs = convertDayArgs(args, dataMinDate);
        const res = await fetch(buildDrilldownUrl(apiArgs));
        const json = (await res.json()) as { events?: unknown[]; total?: number; error?: string };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", events: [], total: 0 });
        const nameMap = buildNameMap(projectContext);
        const events = (json.events ?? []).map((e) => anonymizeEvent(e, dataMinDate, nameMap));
        return JSON.stringify({ events, total: json.total ?? 0 });
      },
      [projectContext, dataMinDate]
    ),
    render: ({ status, result }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
      return (
        <ToolExecutionCard
          title="Query interaction events"
          icon={List}
          status={cardStatus}
          hint={hint}
        />
      );
    },
  });

  useFrontendTool({
    name: "listInteractions",
    description:
      "List brief collaboration interaction summaries with counts, filtered by behavior, team, source, start, end.",
    parameters: listInteractionsParameters,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateBehaviorTeamSource(args, projectContext);
        if (err) return JSON.stringify({ error: err, summaries: [], total: 0 });
        const apiArgs = convertDayArgs(args, dataMinDate);
        const res = await fetch(buildInteractionSummaryUrl(apiArgs));
        const json = (await res.json()) as { summaries?: unknown[]; total?: number; error?: string };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", summaries: [], total: 0 });
        // Strip real names (from_name/to_name) from summaries
        const summaries = (json.summaries ?? []).map((s) => {
          const { from_name, to_name, ...rest } = s as Record<string, unknown>;
          void from_name;
          void to_name;
          return rest;
        });
        return JSON.stringify({ summaries, total: json.total ?? 0 });
      },
      [projectContext, dataMinDate]
    ),
    render: ({ status, result }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
      return (
        <ToolExecutionCard
          title="Query interactions by behavior"
          icon={GitBranch}
          status={cardStatus}
          hint={hint}
        />
      );
    },
  });

  useFrontendTool({
    name: "openInteractionDrilldown",
    description:
      "Open the event drawer for a specific interaction between two members (from_id → to_id).",
    parameters: [
      { name: "from_id", type: "string", description: "Member ID", required: true },
      { name: "to_id", type: "string", description: "Member ID", required: true },
    ],
    handler: useCallback(
      async (args: { from_id: string; to_id: string }) => {
        const err = validateOpenDrilldown(args, projectContext);
        if (err) return JSON.stringify({ success: false, error: err });
        onOpenDrilldown?.(args);
        return JSON.stringify({
          success: true,
          message: `Opened event drawer for ${args.from_id} → ${args.to_id}.`,
        });
      },
      [onOpenDrilldown, projectContext]
    ),
    render: ({ status, result }: { args: { from_id?: string; to_id?: string }; status: string; result: unknown }) => {
      const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
      return (
        <ToolExecutionCard
          title="Open interaction drilldown"
          icon={PanelRightOpen}
          status={cardStatus}
          hint={hint}
        />
      );
    },
  });

  useFrontendTool({
    name: "saveAnalysisReport",
    description:
      "Persist the full analysis answer for the current user question to a markdown report on disk. " +
      "MUST be called instead of replying with the analysis inline in the chat. " +
      "The frontend automatically attaches the system prompt, the user prompt, and any prior tool calls/results from this conversation; " +
      "you only need to provide the final analysis content as the `answer` parameter.",
    parameters: [
      {
        name: "answer",
        type: "string",
        description:
          "The complete analysis content to save, in markdown. Should fully answer the user's latest question; do not summarize or truncate.",
        required: true,
      },
    ],
    handler: useCallback(async (args: { answer: string }) => {
      const answer = (args.answer ?? "").trim();
      if (!answer) {
        return JSON.stringify({ success: false, error: "answer is required" });
      }
      const currentThreadId = threadIdRef.current;
      if (!currentThreadId) {
        return JSON.stringify({
          success: false,
          error: "No active chat thread id; cannot determine report filename.",
        });
      }
      // Read messages from ref so we always pick up the most recent log,
      // not the snapshot at the time useFrontendTool first registered.
      const events = buildEventsFromMessages(messagesRef.current, answer);
      const res = await fetch("/api/save-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: currentThreadId,
          systemPrompt: getColvizSystemPrompt(),
          events,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        path?: string;
        eventCount?: number;
        error?: string;
      };
      if (!res.ok || !json.success) {
        return JSON.stringify({
          success: false,
          error: json.error ?? "Failed to save report",
        });
      }
      return JSON.stringify({
        success: true,
        message: `Saved analysis report (${json.eventCount} event(s)) to ${json.path}.`,
        path: json.path,
      });
    }, []),
    render: ({ status, result }: { args: { answer?: string }; status: string; result: unknown }) => (
      <SaveReportCard status={status} result={result} />
    ),
  });

  return null;
}
