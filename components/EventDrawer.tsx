"use client";

import { useEffect, useState, useCallback } from "react";
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

interface DrilldownFilters {
  behavior?: string;
  from_id?: string;
  to_id?: string;
  from?: string;
  to?: string;
  sources?: string[];
  teams?: string[];
  start?: string;
  end?: string;
}

interface RawItem {
  id: string;
  sourceItemType: string;
  sourceItemId: string;
  title: string | null;
  content: string;
  contentFormat: string;
  payload: Record<string, unknown> | null;
}

interface EventRecord {
  id: string;
  datetime: string;
  date: string;
  source: string;
  scope: string;
  team_id: string;
  team: string;
  behavior: string;
  from_id: string;
  from: string;
  to_id: string;
  to: string;
  weight: number;
  rawItem: RawItem | null;
}

interface EventDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DrilldownFilters;
  showNames?: boolean; // true = show from/to names, false = show from_id/to_id only
  datasetName?: string;
}

export default function EventDrawer({
  open,
  onOpenChange,
  filters,
  showNames = true,
  datasetName = "default",
}: EventDrawerProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchEvents = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("dataset", datasetName);
        params.set("limit", String(limit));
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
          events: EventRecord[];
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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getBehaviorColor = (behavior: string) => {
    const colors = {
      coordination: "#4A90E2",
      sharing: "#50C878", 
      improving: "#F5A623",
      awareness: "#9B59B6",
    };
    return colors[behavior as keyof typeof colors] || "#64748b";
  };

  const title = filters.behavior
    ? filters.from_id && filters.to_id
      ? showNames && filters.from && filters.to
        ? `${filters.from} → ${filters.to}`
        : `${filters.from_id} → ${filters.to_id}`
      : `${filters.behavior} events`
    : "All events";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[540px] sm:max-w-xl">
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
            {events.map((event) => {
              const isExpanded = expandedIds.has(event.id);
              return (
                <Card key={event.id} className="text-sm">
                  <CardHeader
                    className="p-3 cursor-pointer"
                    onClick={() => toggleExpand(event.id)}
                  >
                    <CardTitle className="text-sm font-medium flex justify-between items-center">
                      <span>
                        {showNames ? event.from : event.from_id} → {showNames ? event.to : event.to_id}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {event.date}
                      </span>
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
                        <div className="space-y-3">
                          {/* Meeting-specific display */}
                          {event.source === "meeting" && event.rawItem.payload && (() => {
                            // Parse payload JSON string
                            const payload = typeof event.rawItem.payload === 'string' 
                              ? JSON.parse(event.rawItem.payload) 
                              : event.rawItem.payload as Record<string, unknown>;
                            const meetingGoal = (payload.meetingGoal as string) || event.rawItem.title || "";
                            const meetingTime = payload.meetingTime as string;
                            const members = payload.members as string[];
                            
                            return (
                              <>
                                {/* Meeting Goal */}
                                {meetingGoal && (
                                  <div className="bg-muted/50 p-2 rounded">
                                    <div className="text-muted-foreground mb-1 text-xs">Meeting Goal</div>
                                    <div className="font-medium text-sm">{meetingGoal}</div>
                                  </div>
                                )}
                                
                                {/* Meeting Time & Members */}
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  {meetingTime && (
                                    <div className="bg-muted/50 p-2 rounded">
                                      <div className="text-muted-foreground mb-1">Meeting Time</div>
                                      <div className="font-medium">{meetingTime}</div>
                                    </div>
                                  )}
                                  {members && members.length > 0 && (
                                    <div className="bg-muted/50 p-2 rounded">
                                      <div className="text-muted-foreground mb-1">Members</div>
                                      <div className="font-medium">{members.join("、")}</div>
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                          
                          {/* Title (for non-meeting sources) */}
                          {event.source !== "meeting" && event.rawItem.title && (
                            <div className="font-medium text-sm">
                              {event.rawItem.title}
                            </div>
                          )}
                          
                          {/* Content */}
                          {event.rawItem.content && (
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-xs font-medium text-muted-foreground mb-1">
                                Content
                              </div>
                              <div className="whitespace-pre-wrap text-xs max-h-48 overflow-y-auto">
                                {event.rawItem.content}
                              </div>
                            </div>
                          )}
                          
                          {/* Metadata (collapsed, prettified) */}
                          {event.rawItem.payload && (
                            <details className="text-xs border rounded-lg">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground p-2 hover:bg-muted/30">
                                📋 View Raw Data
                              </summary>
                              <div className="p-3 border-t space-y-2 max-h-64 overflow-y-auto">
                                {(() => {
                                  // Parse payload JSON string
                                  const payload = typeof event.rawItem!.payload === 'string' 
                                    ? JSON.parse(event.rawItem!.payload) 
                                    : event.rawItem!.payload as Record<string, unknown>;
                                  
                                  // Skip already displayed important keys
                                  const skipKeys = ['meetingGoal', 'meetingTime', 'members', 'teams'];
                                  const displayKeys = Object.keys(payload).filter(k => !skipKeys.includes(k));
                                  const nonEmptyKeys = displayKeys.filter(key => {
                                    const value = payload[key];
                                    return value && value !== '' && !(Array.isArray(value) && value.length === 0);
                                  });
                                  
                                  return (
                                    <div className="space-y-1">
                                      {nonEmptyKeys.map(key => {
                                        const value = payload[key];
                                        
                                        return (
                                          <div key={key} className="flex gap-2 text-[10px]">
                                            <span className="font-medium text-muted-foreground min-w-32">
                                              {key}:
                                            </span>
                                            <span className="flex-1 break-words">
                                              {Array.isArray(value) ? value.join('、') :
                                               typeof value === 'object' && value !== null ? JSON.stringify(value) : 
                                               String(value)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                      
                                      {nonEmptyKeys.length === 0 && (
                                        <div className="text-muted-foreground text-[10px] italic">
                                          No additional data
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs italic text-center py-4">
                          No linked raw content
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}

            {events.length === 0 && !loading && (
              <div className="text-center text-muted-foreground py-8">
                No events found
              </div>
            )}
          </div>

          {total > limit && (
            <div className="flex justify-center gap-2 mt-4 pb-4">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => fetchEvents(Math.max(0, offset - limit))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {offset + 1}-{Math.min(offset + limit, total)} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + limit >= total || loading}
                onClick={() => fetchEvents(offset + limit)}
              >
                Next
              </Button>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
