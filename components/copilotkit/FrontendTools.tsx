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
import type { ProjectContext, SelectedScope } from "../../lib/types";
import { datetimeToDayLabel, dayNumberToDate } from "../../lib/dayLabel";
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
  appendParams(p, args, [
    "behavior",
    "from_id",
    "to_id",
    "start",
    "end",
    "source",
    "team",
    "offset",
    "order",
  ]);
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
  {
    name: "behavior",
    type: "string",
    description:
      "Optional behavior filter. One of: " +
      BEHAVIOR_ORDER.join(", ") +
      ". Omit to include all behaviors in the same time-series response.",
    required: false,
  },
  {
    name: "from_id",
    type: "string",
    description:
      "Optional sender member ID (e.g. M1). Omit to include events from every actor in the team scope (recommended for team-level time-series analysis).",
    required: false,
  },
  {
    name: "to_id",
    type: "string",
    description:
      "Optional receiver member ID (e.g. M2). Omit to include events to every actor in the team scope.",
    required: false,
  },
  { name: "team", type: "string", description: "Team ID (e.g. T2). Recommended scope for time-series queries.", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "start", type: "number", description: "Start day number (e.g. 1 for Day 1)", required: false },
  { name: "end", type: "number", description: "End day number (e.g. 10 for Day 10)", required: false },
  { name: "offset", type: "number", description: "Pagination offset (default 0). Use with total_pages in the response to fetch subsequent pages.", required: false },
];

const getInteractionSummaryParameters: Parameter[] = [
  { name: "behavior", type: "string", description: `Optional filter. One of: ${BEHAVIOR_ORDER.join(", ")}`, required: false },
  { name: "team", type: "string", description: "Team name (omit for all)", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "start", type: "number", description: "Start day number (e.g. 1 for Day 1)", required: false },
  { name: "end", type: "number", description: "End day number (e.g. 10 for Day 10)", required: false },
];

// -----------------------------------------------------------------------------
// Argument validation — strict mode (Mode A): tool calls MUST stay within the
// user's currently selected UI scope. Behavior is validated against the full
// enum since the UI doesn't have a behavior filter.
// -----------------------------------------------------------------------------

const EMPTY_SCOPE_ERROR =
  "No teams selected in the UI. Ask the user to select teams (and sources) before querying.";

function selectedScopeReady(scope: SelectedScope | undefined): scope is SelectedScope {
  if (!scope) return false;
  return scope.teams.length > 0 && scope.sources.length > 0;
}

function unionMemberIds(scope: SelectedScope): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(scope.teamMembers)) for (const id of list) ids.add(id);
  return ids;
}

function validateBehaviorTeamSource(
  args: Record<string, unknown>,
  scope: SelectedScope | undefined
): string | null {
  if (!scope) return null;
  if (!selectedScopeReady(scope)) return EMPTY_SCOPE_ERROR;

  const behavior = (args.behavior as string | undefined)?.trim();
  if (behavior && !BEHAVIOR_ORDER.includes(behavior as (typeof BEHAVIOR_ORDER)[number])) {
    return `Invalid behavior "${behavior}". Allowed: ${BEHAVIOR_ORDER.join(", ")}.`;
  }
  const team = (args.team as string | undefined)?.trim();
  if (team && !scope.teams.includes(team)) {
    return `Team "${team}" is outside the user's current selection. Allowed: ${scope.teams.join(", ")}.`;
  }
  const source = (args.source as string | undefined)?.trim();
  if (source && !scope.sources.includes(source)) {
    return `Source "${source}" is outside the user's current selection. Allowed: ${scope.sources.join(", ")}.`;
  }

  if (scope.dayRange) {
    const start = args.start != null ? Number(args.start) : null;
    const end = args.end != null ? Number(args.end) : null;
    if (start != null && !Number.isNaN(start) && start < scope.dayRange.start) {
      return `start=${start} is before the selected day range (Day ${scope.dayRange.start}–Day ${scope.dayRange.end}).`;
    }
    if (end != null && !Number.isNaN(end) && end > scope.dayRange.end) {
      return `end=${end} is after the selected day range (Day ${scope.dayRange.start}–Day ${scope.dayRange.end}).`;
    }
  }
  return null;
}

function memberOutOfScopeError(
  id: string,
  scope: SelectedScope,
  param: "from_id" | "to_id"
): string {
  const ids = Array.from(unionMemberIds(scope));
  const sample = ids.slice(0, 20).join(", ");
  return `${param} "${id}" is outside the user's current team selection. Allowed members: ${sample}${ids.length > 20 ? "…" : ""}.`;
}

function validateGetInteractionEvents(
  args: Record<string, unknown>,
  scope: SelectedScope | undefined
): string | null {
  const err = validateBehaviorTeamSource(args, scope);
  if (err) return err;
  // If we got here, scope is either undefined (no error to raise) or fully ready.
  if (!scope) return null;
  const allowed = unionMemberIds(scope);
  const from_id = (args.from_id as string | undefined)?.trim();
  if (from_id && !allowed.has(from_id)) return memberOutOfScopeError(from_id, scope, "from_id");
  const to_id = (args.to_id as string | undefined)?.trim();
  if (to_id && !allowed.has(to_id)) return memberOutOfScopeError(to_id, scope, "to_id");
  return null;
}

function validateOpenDrilldown(
  args: { from_id?: string; to_id?: string },
  scope: SelectedScope | undefined
): string | null {
  if (!scope) return null;
  if (!selectedScopeReady(scope)) return EMPTY_SCOPE_ERROR;
  const allowed = unionMemberIds(scope);
  const from_id = args.from_id?.trim();
  if (from_id && !allowed.has(from_id)) return memberOutOfScopeError(from_id, scope, "from_id");
  const to_id = args.to_id?.trim();
  if (to_id && !allowed.has(to_id)) return memberOutOfScopeError(to_id, scope, "to_id");
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

// Payload keys whose string/array values are real names → anonymize to IDs.
const PAYLOAD_NAME_KEYS = new Set(["members"]);
// Payload keys to drop entirely (redundant with top-level event fields or internal metadata).
const PAYLOAD_DROP_KEYS = new Set(["rowIndex", "datetime", "team", "teams"]);
// Meeting-specific keys that duplicate title/content or contain raw names.
const MEETING_DROP_SUFFIXES = ["-intra", "-inter", "-subject", "-description"];
const MEETING_DROP_KEYS = new Set(["meetingGoal"]);

function shouldDropMeetingKey(k: string): boolean {
  return MEETING_DROP_KEYS.has(k) || MEETING_DROP_SUFFIXES.some((s) => k.endsWith(s));
}

/**
 * Slim a drilldown event down to the fields the LLM actually reasons about.
 *
 * Drops: real names (`from`, `to`, `team`), opaque IDs (`id`, `rawItem.id`,
 * `rawItem.sourceItemId`, `rawItem.sourceItemType`, `rawItem.contentFormat`),
 * and the redundant `date` field (datetime already encodes the day with HH:MM:SS).
 *
 * Payload cleanup: drops empty-string values and internal metadata keys
 * (`rowIndex`, `datetime`). Flattens `rawItem.{title, content, payload}` onto
 * the event itself. Payload names are anonymized to IDs.
 */
function slimEvent(
  e: unknown,
  dataMinDate: string | undefined,
  nameMap: Map<string, string>
): Record<string, unknown> {
  const ev = e as Record<string, unknown>;
  const datetimeStr =
    dataMinDate && typeof ev.datetime === "string"
      ? datetimeToDayLabel(ev.datetime, dataMinDate)
      : ev.datetime;

  const slim: Record<string, unknown> = {
    datetime: datetimeStr,
    behavior: ev.behavior,
    source: ev.source,
    scope: ev.scope,
    team_id: ev.team_id,
    from_id: ev.from_id,
    to_id: ev.to_id,
    weight: ev.weight,
  };

  const rawItem = ev.rawItem;
  if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
    const ri = rawItem as Record<string, unknown>;
    if (ri.title != null) slim.title = ri.title;
    if (ri.content != null) slim.content = ri.content;
    if (ri.payload && typeof ri.payload === "object" && !Array.isArray(ri.payload)) {
      const isMeeting = ev.source === "meeting";
      const cleanPayload = Object.fromEntries(
        Object.entries(ri.payload as Record<string, unknown>)
          .filter(([k, v]) => !PAYLOAD_DROP_KEYS.has(k) && v !== "" && !(isMeeting && shouldDropMeetingKey(k)))
          .map(([k, v]) => PAYLOAD_NAME_KEYS.has(k) ? [k, replaceWithId(v, nameMap)] : [k, v])
      );
      if (Object.keys(cleanPayload).length > 0) slim.payload = cleanPayload;
    }
  }

  return slim;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface FrontendToolsProps {
  onOpenDrilldown?: (args: { from_id: string; to_id: string }) => void;
  /** Full dataset — used only for name→id mapping when post-processing tool results. Never sent to the LLM. */
  projectContext?: ProjectContext;
  /** User's current UI selection — exposed to the LLM via useCopilotReadable. */
  selectedScope?: SelectedScope;
  dataMinDate?: string;
}

export function FrontendTools({
  onOpenDrilldown,
  projectContext,
  selectedScope,
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

  // Suggestions: one per selected team. Keep the chat message minimal — all
  // analysis context (day range, sources, member IDs per team) is already in
  // the readable below and the system prompt.
  const suggestions = useMemo(() => {
    if (!selectedScope || selectedScope.teams.length === 0) return [];
    return selectedScope.teams.map((teamId) => ({
      title: `${teamId} Collaboration Summary`,
      message: `Analyze ${teamId} collaboration with detailed events and save the report`,
    }));
  }, [selectedScope]);
  useCopilotChatSuggestions(
    {
      suggestions,
      available: "before-first-message",
    },
    [suggestions]
  );

  // Readable sent to the LLM: anonymized (IDs only) and scoped to the user's
  // current UI filter. dataRange.totalDays is from the full dataset so the
  // model still understands the absolute timeline.
  const readableValue = useMemo(
    () =>
      selectedScope
        ? {
            selected: {
              sources: selectedScope.sources,
              teams: selectedScope.teams,
              teamMembers: selectedScope.teamMembers,
              dayRange: selectedScope.dayRange,
            },
            behaviors: [...BEHAVIOR_ORDER],
            dataRange: projectContext?.dataRange,
          }
        : null,
    [selectedScope, projectContext?.dataRange]
  );
  useCopilotReadable(
    {
      description:
        "ColViz scope the user is currently viewing. `selected` reflects the active UI filters (sources, teams, members per team, day range in Day-N units) — tool calls MUST stay within this scope. `behaviors` is the full enum. `dataRange.totalDays` describes the full dataset timeline.",
      value: readableValue,
      available: readableValue ? "enabled" : "disabled",
    },
    [readableValue]
  );

  useFrontendTool({
    name: "getInteractionEvents",
    description:
      "Stream the raw collaboration events (chronological, ascending) for a scope. Each row contains who→whom, datetime (Day-N HH:MM:SS), behavior, and the underlying message/title/payload. Prefer team-scoped queries (team + start + end) so the timeline stays unified instead of being fanned out across directed pairs; provide from_id/to_id only when zooming into one edge. Returns events only — no aggregate counts. For totals or distributions across pairs/behaviors/days, call getInteractionSummary first.",
    parameters: getInteractionEventsParameters,
    followUp: true,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateGetInteractionEvents(args, selectedScope);
        if (err) return JSON.stringify({ error: err, events: [], total: 0 });
        const apiArgs = convertDayArgs(args, dataMinDate);
        // ASC for human/AI-friendly chronological reading.
        apiArgs.order = "asc";
        const res = await fetch(buildDrilldownUrl(apiArgs));
        const json = (await res.json()) as {
          events?: unknown[];
          total?: number;
          limit?: number;
          offset?: number;
          total_pages?: number;
          error?: string;
        };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", events: [], total: 0 });
        const nameMap = buildNameMap(projectContext);
        const events = (json.events ?? []).map((e) => slimEvent(e, dataMinDate, nameMap));
        return JSON.stringify({
          events,
          total: json.total ?? 0,
          limit: json.limit,
          offset: json.offset,
          total_pages: json.total_pages,
        });
      },
      [projectContext, selectedScope, dataMinDate]
    ),
    render: ({ status, result }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
      return (
        <ToolExecutionCard
          title="Get interaction events"
          icon={List}
          status={cardStatus}
          hint={hint}
        />
      );
    },
  });

  useFrontendTool({
    name: "getInteractionSummary",
    description:
      "Get aggregate counts for a scope — the 'shape' of the data, not the events themselves. The response carries a `summary` block ({ total_events, by_behavior, by_day }) for the entire filtered set, plus an `interactions` array with one row per (from_id, to_id, behavior) and that pair's count. No event content is included. Use this first to understand volume / who-interacts-with-whom / day distribution; then call getInteractionEvents to read what was actually said.",
    parameters: getInteractionSummaryParameters,
    followUp: true,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateBehaviorTeamSource(args, selectedScope);
        if (err) return JSON.stringify({ error: err, summary: null, interactions: [], total: 0 });
        const apiArgs = convertDayArgs(args, dataMinDate);
        const res = await fetch(buildInteractionSummaryUrl(apiArgs));
        const json = (await res.json()) as {
          summary?: unknown;
          summaries?: unknown[];
          pair_count?: number;
          capped?: boolean;
          error?: string;
        };
        if (!res.ok) {
          return JSON.stringify({
            error: json.error ?? "Request failed",
            summary: null,
            interactions: [],
            total: 0,
          });
        }
        // Strip real names (from_name/to_name) from each per-pair row.
        const interactions = (json.summaries ?? []).map((s) => {
          const { from_name, to_name, ...rest } = s as Record<string, unknown>;
          void from_name;
          void to_name;
          return rest;
        });
        return JSON.stringify({
          summary: json.summary ?? null,
          interactions,
          pair_count: json.pair_count ?? 0,
          ...(json.capped ? { capped: true } : {}),
        });
      },
      [selectedScope, dataMinDate]
    ),
    render: ({ status, result }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
      return (
        <ToolExecutionCard
          title="Get interaction summary"
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
    followUp: true,
    handler: useCallback(
      async (args: { from_id: string; to_id: string }) => {
        const err = validateOpenDrilldown(args, selectedScope);
        if (err) return JSON.stringify({ success: false, error: err });
        onOpenDrilldown?.(args);
        return JSON.stringify({
          success: true,
          message: `Opened event drawer for ${args.from_id} → ${args.to_id}.`,
        });
      },
      [onOpenDrilldown, selectedScope]
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
    followUp: false,
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
