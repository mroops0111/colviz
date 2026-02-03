"use client";

import React, { useCallback, useMemo } from "react";
import { useCopilotReadable, useFrontendTool } from "@copilotkit/react-core";
import type { Parameter } from "@copilotkit/shared";
import { List, GitBranch, PanelRightOpen } from "lucide-react";
import { BEHAVIOR_ORDER } from "../../lib/dataProcessor";
import type { ProjectContext } from "../../lib/types";
import { ToolExecutionCard } from "./ToolExecutionCard";
import type { ToolStatus } from "./ToolExecutionCard";

function toolStatusToCardStatus(status: string): ToolStatus {
  return status === "complete" ? "complete" : status === "executing" ? "executing" : "inProgress";
}

/** Resolve card status and hint from tool status + result; treat result with error field as failed. */
function resolveCardStatusAndHint(status: string, result: unknown): { cardStatus: ToolStatus; hint: string } {
  const baseStatus = toolStatusToCardStatus(status);
  if (baseStatus !== "complete") {
    return { cardStatus: baseStatus, hint: "Running…" };
  }
  let hasError = false;
  if (result != null) {
    try {
      const data = typeof result === "string" ? JSON.parse(result) : result;
      hasError = typeof (data as { error?: string })?.error === "string";
    } catch {
      // ignore parse errors
    }
  }
  if (hasError) {
    return { cardStatus: "error", hint: "Failed" };
  }
  return { cardStatus: "complete", hint: "Done" };
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
  { name: "from_id", type: "string", description: "Member ID (e.g., M1)", required: true },
  { name: "to_id", type: "string", description: "Member ID (e.g., M2)", required: true },
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
      "Get detailed collaboration events and raw data for interactions between two members (from_id → to_id), filtered by behavior, team, source, start, end.",
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
        const err = validateListInteractions(args, projectContext);
        if (err) return JSON.stringify({ error: err, summaries: [], total: 0 });
        const res = await fetch(buildInteractionSummaryUrl(args));
        const json = (await res.json()) as { summaries?: unknown[]; total?: number; error?: string };
        if (!res.ok) return JSON.stringify({ error: json.error ?? "Request failed", summaries: [], total: 0 });
        return JSON.stringify({ summaries: json.summaries ?? [], total: json.total ?? 0 });
      },
      [projectContext]
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

  return null;
}
