"use client";

import { useCallback, useMemo } from "react";
import { useCopilotReadable, useFrontendTool } from "@copilotkit/react-core";
import type { Parameter } from "@copilotkit/shared";
import { List, GitBranch, PanelRightOpen } from "lucide-react";
import { BEHAVIOR_ORDER } from "@/lib/dataProcessor";
import type { ProjectContext } from "@/lib/types";
import { ToolExecutionCard } from "./ToolExecutionCard";
import type { ToolStatus } from "./ToolExecutionCard";

function toolStatusToCardStatus(status: string): ToolStatus {
  return status === "complete" ? "complete" : status === "executing" ? "executing" : "inProgress";
}

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

const getInteractionEventsParameters: Parameter[] = [
  { name: "behavior", type: "string", description: "One of: " + BEHAVIOR_ORDER.join(", "), required: true },
  { name: "from_id", type: "string", description: "Member ID", required: true },
  { name: "to_id", type: "string", description: "Member ID", required: true },
  { name: "start", type: "string", description: "Start date (ISO)", required: false },
  { name: "end", type: "string", description: "End date (ISO)", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "team", type: "string", description: "Team name (omit for all)", required: false },
];

const listInteractionsParameters: Parameter[] = [
  { name: "behavior", type: "string", description: `Optional filter. One of: ${BEHAVIOR_ORDER.join(", ")}`, required: false },
  { name: "team", type: "string", description: "Team name (omit for all)", required: false },
  { name: "source", type: "string", description: "Source name (omit for all)", required: false },
  { name: "start", type: "string", description: "Start date (ISO)", required: false },
  { name: "end", type: "string", description: "End date (ISO)", required: false },
];

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

function memberIdError(id: string, allowedIds: Set<string>, param: "from_id" | "to_id" = "from_id"): string {
  const ids = Array.from(allowedIds).slice(0, 20);
  return `Invalid ${param} "${id}". Use a member ID (e.g. ${ids.join(", ")}${allowedIds.size > 20 ? "…" : ""}).`;
}

function validateListInteractions(
  args: Record<string, unknown>,
  ctx: ProjectContext | undefined
): string | null {
  return validateBehaviorTeamSource(args, ctx);
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

export interface FrontendToolsProps {
  onOpenDrilldown?: (args: { from_id: string; to_id: string }) => void;
  projectContext?: ProjectContext;
}

export function FrontendTools({ onOpenDrilldown, projectContext }: FrontendToolsProps = {}) {
  const readableValue = useMemo(
    () =>
      projectContext
        ? {
            sources: projectContext.sources,
            teams: projectContext.teams,
            members: projectContext.members,
            behaviors: projectContext.behaviors,
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
      "Get collaboration events for a single link (from_id → to_id, behavior).",
    parameters: getInteractionEventsParameters,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateGetInteractionEvents(args, projectContext);
        if (err) return JSON.stringify({ error: err, events: [], total: 0 });
        const res = await fetch(buildDrilldownUrl(args));
        const json = (await res.json()) as { events?: unknown[]; total?: number; error?: string };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", events: [], total: 0 });
        return JSON.stringify({ events: json.events ?? [], total: json.total ?? 0 });
      },
      [projectContext]
    ),
    render: ({ args, result, status }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const query =
        args?.behavior && args?.from_id && args?.to_id
          ? `${args.behavior}: ${args.from_id} → ${args.to_id}`
          : "";
      const cardStatus = toolStatusToCardStatus(status);
      let resultSummary: string | undefined;
      let resultDetails: string | undefined;
      if (status === "complete" && result != null) {
        const data = typeof result === "string" ? JSON.parse(result) : result;
        const err = (data as { error?: string })?.error;
        const total = (data as { total?: number })?.total ?? 0;
        const events = (data as { events?: { date?: string; from?: string; to?: string }[] })?.events ?? [];
        resultSummary = err ?? `Found ${total} event${total !== 1 ? "s" : ""}.`;
        resultDetails =
          !err && events.length > 0
            ? events
                .slice(0, 5)
                .map((e) => `${e.date ?? ""} ${e.from ?? ""} → ${e.to ?? ""}`)
                .join("\n") + (events.length > 5 ? "\n…" : "")
            : undefined;
      }
      return (
        <ToolExecutionCard
          title="Interaction events"
          icon={List}
          status={cardStatus}
          query={query || (cardStatus !== "complete" ? "Loading…" : undefined)}
          resultSummary={resultSummary}
          resultDetails={resultDetails}
        />
      );
    },
  });

  useFrontendTool({
    name: "listInteractions",
    description:
      "List all collaboration interactions (from→to, behavior) with counts.",
    parameters: listInteractionsParameters,
    handler: useCallback(
      async (args: Record<string, unknown>) => {
        const err = validateListInteractions(args, projectContext);
        if (err) return JSON.stringify({ error: err, summaries: [], total: 0 });
        const res = await fetch(buildInteractionSummaryUrl(args));
        const json = (await res.json()) as { summaries?: unknown[]; total?: number; error?: string };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", summaries: [], total: 0 });
        return JSON.stringify({ summaries: json.summaries ?? [], total: json.total ?? 0 });
      },
      [projectContext]
    ),
    render: ({ args, result, status }: { args: Record<string, unknown>; result: unknown; status: string }) => {
      const query = args?.behavior != null ? `${args.behavior}` : "All behaviors";
      const cardStatus = toolStatusToCardStatus(status);
      let resultSummary: string | undefined;
      let resultDetails: string | undefined;
      if (status === "complete" && result != null) {
        const data = typeof result === "string" ? JSON.parse(result) : result;
        const err = (data as { error?: string })?.error;
        const total = (data as { total?: number })?.total ?? 0;
        const summaries = (data as { summaries?: { behavior?: string; from_name?: string; to_name?: string; count?: number }[] })
          ?.summaries ?? [];
        resultSummary = err ?? `Found ${total} interaction${total !== 1 ? "s" : ""}.`;
        resultDetails =
          !err && summaries.length > 0
            ? summaries
                .slice(0, 8)
                .map((e) => `${e.behavior ?? ""}: ${e.from_name ?? ""} → ${e.to_name ?? ""} (${e.count ?? 0})`)
                .join("\n") + (summaries.length > 8 ? "\n…" : "")
            : undefined;
      }
      return (
        <ToolExecutionCard
          title="Interactions by behavior"
          icon={GitBranch}
          status={cardStatus}
          query={query || (cardStatus !== "complete" ? "Loading…" : undefined)}
          resultSummary={resultSummary}
          resultDetails={resultDetails}
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
    render: ({
      args,
      status,
      result,
    }: {
      args: { from_id?: string; to_id?: string };
      status: string;
      result: unknown;
    }) => {
      const query =
        args?.from_id != null && args?.to_id != null
          ? `${args.from_id} → ${args.to_id}`
          : "";
      const cardStatus = toolStatusToCardStatus(status);
      let resultSummary: string | undefined;
      if (status === "complete" && result != null) {
        try {
          const data = typeof result === "string" ? JSON.parse(result) : result;
          const err = (data as { error?: string })?.error;
          resultSummary = err ?? (data as { message?: string })?.message ?? "Drawer opened.";
        } catch {
          resultSummary = "Drawer opened.";
        }
      }
      return (
        <ToolExecutionCard
          title="Open interaction drilldown"
          icon={PanelRightOpen}
          status={cardStatus}
          query={query || (cardStatus !== "complete" ? "Loading…" : undefined)}
          resultSummary={resultSummary}
        />
      );
    },
  });

  return null;
}
