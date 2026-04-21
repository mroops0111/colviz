"use client";

import React, { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownContent } from "@/components/MarkdownContent";
import { cn } from "@/lib/utils";
import {
  type ParsedEvent,
  type ParsedReport,
  type ReportEvent,
  tryParseJson,
} from "@/lib/report";
import type { Message as AGUIMessage } from "@copilotkit/shared";
import { ToolExecutionCard } from "./ToolExecutionCard";
import { resolveCardStatusAndHint } from "./toolCardStatus";

// -----------------------------------------------------------------------------
// AG-UI message → ReportEvent[]
// -----------------------------------------------------------------------------

/** Coerce a UserMessage's content (string | Array<{type,text}>) to plain text. */
function userContentToText(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .map((p) =>
      p && typeof p === "object" && "text" in p
        ? String((p as { text: unknown }).text ?? "")
        : ""
    )
    .join("");
}

/**
 * Flatten an AG-UI message stream into the chronological event list expected
 * by /api/save-report. We deliberately preserve message order — no "turn"
 * grouping — so the report mirrors the actual chat flow.
 *
 * - System messages are skipped (sent as a separate field).
 * - Each tool call inside an assistant message becomes its own event with
 *   its matching tool result attached.
 * - The `saveAnalysisReport` call from the live message log is filtered
 *   out (its assistant frame may still be streaming) and re-emitted at the
 *   end deterministically using `extraAnswer`.
 */
export function buildEventsFromMessages(
  messages: ReadonlyArray<AGUIMessage>,
  extraAnswer: string
): ReportEvent[] {
  const events: ReportEvent[] = [];

  // Index ToolMessage results by toolCallId so we can attach them inline
  // when we hit the assistant message that originated the call.
  const toolResultById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "tool") toolResultById.set(m.toolCallId, m.content);
  }

  for (const m of messages) {
    if (m.role === "user") {
      events.push({ kind: "user", content: userContentToText(m.content) });
    } else if (m.role === "assistant") {
      for (const tc of m.toolCalls ?? []) {
        if (tc.function.name === "saveAnalysisReport") continue;
        const rawResult = toolResultById.get(tc.id);
        events.push({
          kind: "toolCall",
          name: tc.function.name,
          args: tryParseJson(tc.function.arguments),
          result: rawResult !== undefined ? tryParseJson(rawResult) : undefined,
        });
      }
      const text = m.content?.trim();
      if (text) events.push({ kind: "assistant", content: text });
    }
    // system / tool / activity / developer: skip
  }

  if (extraAnswer.trim()) {
    events.push({
      kind: "toolCall",
      name: "saveAnalysisReport",
      args: { answer: extraAnswer },
    });
  }
  return events;
}

// -----------------------------------------------------------------------------
// Preview UI
// -----------------------------------------------------------------------------

/** Pretty-print a tool-call event body for the preview dialog. */
function toolCallMarkdown(ev: Extract<ParsedEvent, { kind: "toolCall" }>): string {
  const block = (label: string, value: unknown) =>
    `**${label}:**\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  const out: string[] = [];
  if (ev.args !== undefined) out.push(block("Args", ev.args));
  if (ev.result !== undefined) out.push(block("Result", ev.result));
  return out.join("\n\n");
}

/** Extract the saved file path from a saveAnalysisReport tool result. */
function extractSavedPath(result: unknown): string | undefined {
  if (result == null) return undefined;
  try {
    const data = typeof result === "string" ? JSON.parse(result) : result;
    const p = (data as { path?: unknown })?.path;
    return typeof p === "string" ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Render component for the saveAnalysisReport tool. Shown as a clickable
 * ToolExecutionCard that opens an in-app preview Dialog. Inside the Dialog,
 * user prompt and assistant answer events are always visible while the
 * (long) system prompt and (very long) tool call payloads are collapsed.
 */
export function SaveReportCard({
  status,
  result,
}: {
  status: string;
  result: unknown;
}) {
  const { cardStatus, hint } = resolveCardStatusAndHint(status, result);
  const savedPath =
    cardStatus === "complete" ? extractSavedPath(result) : undefined;
  const fileName = savedPath ? savedPath.split("/").pop() ?? savedPath : undefined;
  const displayHint = fileName ? `Saved → ${fileName}` : hint;

  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    if (!fileName) return;
    setOpen(true);
    if (report != null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/save-report?file=${encodeURIComponent(fileName)}`
      );
      const json = (await res.json()) as { sections?: ParsedReport; error?: string };
      if (!res.ok || !json.sections) {
        throw new Error(json.error ?? "Failed to load report");
      }
      setReport(json.sections);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fileName, report, loading]);

  return (
    <>
      <ToolExecutionCard
        title="Save analysis report"
        icon={FileText}
        status={cardStatus}
        hint={displayHint}
        onClick={fileName ? handleOpen : undefined}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          stopPropagation on mouse/pointer down is critical: CopilotSidebar
          attaches a document-level `mousedown` listener that closes the chat
          whenever the click target isn't inside the sidebar's DOM subtree.
          Our dialog is portaled to document.body, so without this every
          click inside the dialog would also collapse the sidebar.
        */}
        <DialogContent
          className="max-w-3xl"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="truncate">{fileName ?? "Report"}</DialogTitle>
            {savedPath && (
              <DialogDescription className="break-all">
                {savedPath}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-4">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && !error && report && (
              <ReportEventList report={report} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReportEventList({ report }: { report: ParsedReport }) {
  return (
    <div className="space-y-3">
      {report.systemPrompt && (
        <CollapsibleSection summary="System Prompt">
          <MarkdownContent content={report.systemPrompt} />
        </CollapsibleSection>
      )}
      {report.events.map((ev) => (
        <EventItem key={ev.index} event={ev} />
      ))}
    </div>
  );
}

function EventItem({ event: ev }: { event: ParsedEvent }) {
  if (ev.kind === "user") {
    return (
      <RoleBlock label={`${ev.index}. User`} variant="muted">
        <MarkdownContent content={ev.content} emptyFallback="(empty)" />
      </RoleBlock>
    );
  }
  if (ev.kind === "assistant") {
    return (
      <RoleBlock label={`${ev.index}. Assistant`} variant="primary">
        <MarkdownContent content={ev.content} emptyFallback="(no answer captured)" />
      </RoleBlock>
    );
  }
  // saveAnalysisReport carries the actual answer markdown in args.answer —
  // render it directly (and expand by default since it's the substantive
  // payload, not a raw JSON dump).
  const isSaveReport = ev.name === "saveAnalysisReport";
  const answer = isSaveReport
    ? (ev.args as { answer?: unknown } | undefined)?.answer
    : undefined;
  return (
    <CollapsibleSection
      summary={`${ev.index}. Tool Call: ${ev.name}`}
      defaultOpen={isSaveReport}
    >
      <MarkdownContent
        content={typeof answer === "string" ? answer : toolCallMarkdown(ev)}
      />
    </CollapsibleSection>
  );
}

function RoleBlock({
  label,
  variant,
  children,
}: {
  label: string;
  variant: "muted" | "primary";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        variant === "muted" ? "bg-muted/30" : "border-primary/20 bg-primary/5"
      )}
    >
      <div
        className={cn(
          "mb-1 text-[10px] font-semibold uppercase tracking-wide",
          variant === "muted" ? "text-muted-foreground" : "text-primary/80"
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Controlled collapsible. We deliberately avoid the native <details> element
 * here because its default-action click on <summary> can interact poorly
 * with portaled overlays + ancestor mousedown listeners (CopilotSidebar's
 * outside-click handler). A plain button + state is more predictable.
 */
function CollapsibleSection({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-md border bg-muted/20", open && "bg-muted/30")}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground flex items-center gap-2"
      >
        <span
          className={cn(
            "inline-block transition-transform",
            open && "rotate-90"
          )}
        >
          ▶
        </span>
        {summary}
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </div>
  );
}
