"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizePayloadFiles } from "@/lib/payload";
import { BEHAVIOR_COLORS } from "@/lib/dataProcessor";
import { dateToDayLabel, datetimeToDayLabel } from "@/lib/dayLabel";
import type { DrilldownFilters, DrilldownEventRecord } from "@/lib/types";
import type { ChannelMessage } from "@/app/api/channel-messages/route";

const PAGE_SIZE = 20;
const CHANNEL_PANEL_HEIGHT_VH = 78;

function getBehaviorColor(behavior: string): string {
  return BEHAVIOR_COLORS[behavior] ?? "#64748b";
}

function getPayloadObj(payload: unknown): Record<string, unknown> | null {
  if (payload == null) return null;
  if (typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

const PAYLOAD_SKIP_KEYS = ["meetingGoal", "meetingTime", "members", "teams", "files"];

function formatPayloadValue(value: unknown): string {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function RawPayloadDetails({ payload }: { payload: Record<string, unknown> }) {
  const displayKeys = Object.keys(payload).filter((k) => !PAYLOAD_SKIP_KEYS.includes(k));
  const nonEmptyKeys = displayKeys.filter((key) => {
    const value = payload[key];
    return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
  });
  return (
    <details className="text-xs border rounded-lg">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground p-2 hover:bg-muted/30">
        📋 View Raw Data
      </summary>
      <div className="p-3 border-t space-y-2 max-h-64 overflow-y-auto">
        <div className="space-y-1">
          {nonEmptyKeys.map((key) => (
            <div key={key} className="flex gap-2 text-[10px]">
              <span className="font-medium text-muted-foreground min-w-32">{key}:</span>
              <span className="flex-1 break-words">{formatPayloadValue(payload[key])}</span>
            </div>
          ))}
          {nonEmptyKeys.length === 0 && (
            <div className="text-muted-foreground text-[10px] italic">No additional data</div>
          )}
        </div>
      </div>
    </details>
  );
}

// Stable custom components for ReactMarkdown (avoid re-creating on every MessageContent render)
const MARKDOWN_COMPONENTS = {
  a: ({ href, children }: { href?: string | null; children?: React.ReactNode }) => (
    <a href={href ?? "#"} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children?: React.ReactNode;
  } & React.ComponentPropsWithoutRef<"code">) => {
    const isBlock = typeof className === "string" && className.startsWith("language-");
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="rounded bg-muted p-3 overflow-x-auto my-2 text-xs font-mono [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
};

/** Render message content as full markdown (via react-markdown): links, code blocks, bold, lists, etc. */
function MessageContent({ content }: { content: string }) {
  const raw = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!raw) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="markdown-body text-sm min-w-0 whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline [&_a:hover]:no-underline [&_a]:break-all [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {raw}
      </ReactMarkdown>
    </div>
  );
}

/** Format datetime for thread list as "Day N HH:mm:ss" */
function formatThreadTime(iso: string, dataMinDate?: string): string {
  if (dataMinDate) return datetimeToDayLabel(iso, dataMinDate);
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

interface ChannelViewPanelProps {
  channel: string;
  messages: ChannelMessage[];
  loading: boolean;
  error: string | null;
  threadFilter: string | null;
  onThreadFilterChange: (threadId: string | null) => void;
  onClose: () => void;
  getBehaviorColor: (behavior: string) => string;
  scrollToMessageId: string | null;
  onScrolledToMessage: () => void;
  showNames: boolean;
  dataMinDate?: string;
}

const CHANNEL_MSG_ID_PREFIX = "channel-msg-";

/** Right-side panel: channel messages with thread dropdown filter */
function ChannelViewPanel({
  channel,
  messages,
  loading,
  error,
  threadFilter,
  onThreadFilterChange,
  onClose,
  getBehaviorColor,
  scrollToMessageId,
  onScrolledToMessage,
  showNames,
  dataMinDate,
}: ChannelViewPanelProps) {
  const hasScrolledRef = useRef(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  useEffect(() => {
    hasScrolledRef.current = false;
  }, [scrollToMessageId]);

  const filtered =
    threadFilter === null
      ? messages
      : messages.filter((m) => (m.thread ?? "") === threadFilter);
  const threadIds = [...new Set(messages.map((m) => m.thread ?? "").filter(Boolean))].sort(
    (a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    }
  );

  useEffect(() => {
    if (loading || error || !scrollToMessageId || filtered.length === 0) return;
    if (hasScrolledRef.current) return;
    const id = `${CHANNEL_MSG_ID_PREFIX}${scrollToMessageId}`;
    const el = document.getElementById(id);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightedMessageId(scrollToMessageId);
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        onScrolledToMessage();
      });
    } else {
      onScrolledToMessage();
    }
  }, [loading, error, scrollToMessageId, filtered.length, onScrolledToMessage]);

  return (
    <div className="flex min-h-0 flex-col h-full gap-3">
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
              {threadIds.length > 0 && (
                <div className="shrink-0 flex min-h-0 w-16 flex-col border-r pr-2">
                  <span className="text-xs text-muted-foreground mb-0.5 shrink-0">Thread</span>
                  <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => onThreadFilterChange(null)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors shrink-0",
                        threadFilter === null
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 hover:bg-muted text-muted-foreground"
                      )}
                    >
                      All
                    </button>
                    {threadIds.map((tid) => (
                      <button
                        key={tid}
                        type="button"
                        onClick={() => onThreadFilterChange(threadFilter === tid ? null : tid)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors shrink-0",
                          threadFilter === tid
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/60 hover:bg-muted text-muted-foreground"
                        )}
                      >
                        #{tid}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            <div className="flex-1 min-h-0 min-w-0 overflow-auto pr-2 -mx-2">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  {threadFilter === null ? "No messages." : `No messages in thread #${threadFilter}.`}
                </div>
              ) : (
                <ul className="space-y-3 min-w-0">
                  {filtered.map((msg) => (
                    <li
                      key={msg.id}
                      id={`${CHANNEL_MSG_ID_PREFIX}${msg.id}`}
                      className={cn(
                        "border-l-2 pl-3 py-2 rounded-r-md bg-muted/30 transition-all duration-300 min-w-0 overflow-x-auto",
                        highlightedMessageId === msg.id && "ring-2 ring-amber-300/60 ring-inset bg-amber-200/50 dark:bg-amber-400/20 dark:ring-amber-400/40"
                      )}
                      style={{
                        borderLeftColor: msg.behavior
                          ? getBehaviorColor(msg.behavior)
                          : "var(--border)",
                      }}
                    >
                      <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground mb-1">
                        <span className="font-semibold text-foreground">{showNames ? msg.author : (msg.authorId ?? msg.author)}</span>
                        <span>{formatThreadTime(msg.occurredAt, dataMinDate)}</span>
                        {msg.behavior && (
                          <span
                            className="px-1.5 py-0.5 rounded text-white font-medium"
                            style={{ backgroundColor: getBehaviorColor(msg.behavior) }}
                          >
                            {msg.behavior}
                          </span>
                        )}
                        {msg.thread != null && msg.thread !== "" && (
                          <span className="text-muted-foreground/80">#{msg.thread}</span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {msg.content?.trim() ? (
                          <MessageContent content={msg.content} />
                        ) : !msg.files?.length ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : null}
                        {msg.files?.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Paperclip className="size-3.5 shrink-0" aria-hidden />
                            <span className="sr-only">Files: </span>
                            {msg.files.map((name, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center rounded bg-muted/70 px-2 py-1 font-medium text-foreground/90"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0 mt-2">
              {threadFilter === null
                ? `${messages.length} message(s)`
                : `${filtered.length} of ${messages.length} in #${threadFilter}`}
            </div>
          </>
        )}
    </div>
  );
}

interface EventCardProps {
  event: DrilldownEventRecord;
  showNames: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onOpenChannelMessages: (channel: string, scrollToMessageId?: string | null) => void;
  dataMinDate?: string;
}

function EventCard({
  event,
  showNames,
  isExpanded,
  onToggleExpand,
  onOpenChannelMessages,
  dataMinDate,
}: EventCardProps) {
  return (
    <Card className="text-sm">
      <CardHeader
        className="p-3 cursor-pointer"
        onClick={() => onToggleExpand(event.id)}
      >
        <CardTitle className="text-sm font-medium flex justify-between items-center">
          <span>
            {showNames ? event.from : event.from_id} → {showNames ? event.to : event.to_id}
          </span>
          <span className="text-xs text-muted-foreground">{dataMinDate ? dateToDayLabel(event.date, dataMinDate) : event.date}</span>
        </CardTitle>
        <div className="flex gap-2 text-xs mt-1">
          <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded font-medium">
            {event.source}
          </span>
          {event.team && (
            <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded font-medium">
              {event.team}
            </span>
          )}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 pt-3 border-t space-y-3">
          {event.rawItem ? (
            (() => {
              const payload = getPayloadObj(event.rawItem.payload);
              const files = payload ? normalizePayloadFiles(payload.files) : [];
              return (
                <div className="space-y-3">
                  {event.source === "meeting" && payload && (
                    <>
                      {((payload.meetingGoal as string) || event.rawItem.title) && (
                        <div className="bg-muted/50 p-2 rounded">
                          <div className="text-muted-foreground mb-1 text-xs">Meeting Goal</div>
                          <div className="font-medium text-sm">
                            {(payload.meetingGoal as string) || event.rawItem.title || ""}
                          </div>
                        </div>
                      )}
                      {(Boolean(payload.meetingTime) || (Array.isArray(payload.members) && payload.members.length > 0)) ? (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {payload.meetingTime ? (
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground mb-1">Meeting Time</div>
                              <div className="font-medium">{String(payload.meetingTime)}</div>
                            </div>
                          ) : null}
                          {Array.isArray(payload.members) && payload.members.length > 0 && (
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground mb-1">Members</div>
                              <div className="font-medium">{(payload.members as string[]).join("、")}</div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                  {event.source !== "meeting" && event.rawItem.title && (
                    <div className="font-medium text-sm">{event.rawItem.title}</div>
                  )}
                  {event.rawItem.content && (
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-xs font-medium text-muted-foreground mb-1">Content</div>
                      <div className="text-xs max-h-48 overflow-y-auto">
                        <MessageContent content={event.rawItem.content} />
                      </div>
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                        <Paperclip className="size-3.5" aria-hidden />
                        Files
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {files.map((name, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded bg-muted/70 px-2 py-1 text-xs font-medium text-foreground/90"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {event.source === "mattermost" && payload && typeof payload.channel === "string" && (
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => onOpenChannelMessages(payload.channel as string, event.rawItem?.id ?? null)}
                      >
                        View channel messages
                      </Button>
                    </div>
                  )}
                  {payload ? <RawPayloadDetails payload={payload} /> : null}
                </div>
              );
            })()
          ) : (
            <div className="text-muted-foreground text-xs italic text-center py-4">
              No linked raw content
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface EventDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DrilldownFilters;
  showNames?: boolean;
  datasetName?: string;
  dataMinDate?: string;
}

export default function EventDrawer({
  open,
  onOpenChange,
  filters,
  showNames = true,
  datasetName = "default",
  dataMinDate,
}: EventDrawerProps) {
  const [events, setEvents] = useState<DrilldownEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [channelView, setChannelView] = useState<{
    channel: string;
    messages: ChannelMessage[];
    scrollToMessageId: string | null;
  } | null>(null);
  const [channelViewLoading, setChannelViewLoading] = useState(false);
  const [channelViewError, setChannelViewError] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState<string | null>(null);

  const fetchEvents = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("dataset", datasetName);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(newOffset));

        if (filters.behavior) params.set("behavior", filters.behavior);
        if (filters.from_id) params.set("from_id", filters.from_id);
        if (filters.to_id) params.set("to_id", filters.to_id);
        if (filters.sources?.length)
          params.set("sources", filters.sources.join(","));
        if (filters.teams?.length) params.set("teams", filters.teams.join(","));
        if (filters.start) params.set("start", filters.start);
        if (filters.end) params.set("end", filters.end);

        const res = await fetch(`/api/drilldown?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch events");

        const json = (await res.json()) as {
          events: DrilldownEventRecord[];
          total: number;
        };
        setEvents(json.events ?? []);
        setTotal(json.total ?? 0);
        setOffset(newOffset);
      } catch (err) {
        console.error(err);
        setEvents([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [datasetName, filters]
  );

  useEffect(() => {
    if (open) {
      setOffset(0);
      setExpandedIds(new Set());
      fetchEvents(0);
    }
  }, [open, fetchEvents]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeChannelView = useCallback(() => {
    setChannelView(null);
    setThreadFilter(null);
    setChannelViewError(null);
  }, []);

  const openChannelMessages = useCallback(
    (channel: string, scrollToMessageId: string | null = null) => {
      setThreadFilter(null);
      setChannelViewError(null);
      setChannelView({ channel, messages: [], scrollToMessageId });
      setChannelViewLoading(true);
      const params = new URLSearchParams({ dataset: datasetName, channel });
      fetch(`/api/channel-messages?${params.toString()}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load channel");
          return res.json();
        })
        .then((data: { messages: ChannelMessage[] }) => {
          setChannelView((prev) =>
            prev ? { ...prev, messages: data.messages ?? [] } : null
          );
        })
        .catch((err) => {
          setChannelViewError(
            err instanceof Error ? err.message : "Failed to load"
          );
          setChannelView((prev) => (prev ? { ...prev, messages: [] } : null));
        })
        .finally(() => setChannelViewLoading(false));
    },
    [datasetName]
  );

  const clearChannelScrollTarget = useCallback(() => {
    setChannelView((prev) =>
      prev ? { ...prev, scrollToMessageId: null } : null
    );
  }, []);

  const title = filters.behavior
    ? filters.from_id && filters.to_id
      ? showNames && filters.from && filters.to
        ? `${filters.from} → ${filters.to}`
        : `${filters.from_id} → ${filters.to_id}`
      : `${filters.behavior} events`
    : "All events";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        className="w-full sm:w-[540px] sm:max-w-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{title}</span>
            {filters.behavior && (
              <span 
                className="px-2 py-1 text-xs font-medium rounded text-white"
                style={{ backgroundColor: getBehaviorColor(filters.behavior) }}
              >
                {filters.behavior}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {loading ? "Loading..." : `${total} event(s) found`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)] mt-4 pr-4">
          <div className="space-y-3">
            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                showNames={showNames}
                isExpanded={expandedIds.has(event.id)}
                onToggleExpand={toggleExpand}
                onOpenChannelMessages={openChannelMessages}
                dataMinDate={dataMinDate}
              />
            ))}

            {events.length === 0 && !loading && (
              <div className="text-center text-muted-foreground py-8">
                No events found
              </div>
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex justify-center gap-2 mt-4 pb-4">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => fetchEvents(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => fetchEvents(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>

    {/* Channel messages: floating panel to the right, not full height, no modal overlay */}
    {channelView && (
      <div
        className={cn(
          "fixed top-0 z-40 flex flex-col rounded-r-lg border border-l-0 bg-background shadow-lg sm:left-[540px] sm:right-auto right-4 left-auto overflow-hidden box-border"
        )}
        style={{
          width: "min(32rem, calc(100vw - 2rem))",
          maxWidth: "100%",
          height: `${CHANNEL_PANEL_HEIGHT_VH}vh`,
          maxHeight: `${CHANNEL_PANEL_HEIGHT_VH}vh`,
        }}
        role="dialog"
        aria-label={`Channel: ${channelView.channel}`}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b">
          <span className="text-sm font-semibold truncate">Channel: {channelView.channel}</span>
          <button
            type="button"
            onClick={closeChannelView}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden p-3">
          <ChannelViewPanel
            channel={channelView.channel}
            messages={channelView.messages}
            loading={channelViewLoading}
            error={channelViewError}
            threadFilter={threadFilter}
            onThreadFilterChange={setThreadFilter}
            onClose={closeChannelView}
            getBehaviorColor={getBehaviorColor}
            scrollToMessageId={channelView.scrollToMessageId}
            onScrolledToMessage={clearChannelScrollTarget}
            showNames={showNames}
            dataMinDate={dataMinDate}
          />
        </div>
      </div>
    )}
    </>
  );
}
