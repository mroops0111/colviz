"use client";

/**
 * Arc diagram: nodes on a circle, links as arcs, behavior ring.
 * Supports zoom/pan, link/behavior drilldown, and node popover for multi-edge selection.
 */

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollaborationData } from "@/lib/types";
import { processCollaborationData, getAllNodes, BEHAVIOR_COLORS, BEHAVIOR_ORDER, BEHAVIOR_BUTTON_LIST } from "@/lib/dataProcessor";

// Fixed diagram size for viewBox - actual size controlled by CSS
const SIZE = 800;
const MARGIN = 100;

export interface LinkClickEvent {
  behavior: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  count: number;
}

export interface BehaviorClickEvent {
  behavior: string;
}

interface ArcDiagramProps {
  data: CollaborationData[];
  showNames?: boolean;
  onLinkClick?: (event: LinkClickEvent) => void;
  onBehaviorDrilldown?: (event: BehaviorClickEvent) => void;
  eventDrawerOpen?: boolean;
}

type LinkInfo = {
  group: { behavior: string; color: string };
  link: { source: string; target: string; count: number };
  fromName: string;
  toName: string;
};

function linkKey(behavior: string, source: string, target: string) {
  return `${behavior}:${source}:${target}`;
}

export default function ArcDiagram({ data, showNames = true, onLinkClick, onBehaviorDrilldown, eventDrawerOpen }: ArcDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const linkInfoByKeyRef = useRef<Map<string, LinkInfo>>(new Map());
  const nodeEdgesRef = useRef<Map<string, string[]>>(new Map());
  const [selectedBehavior, setSelectedBehavior] = useState<string | null>(null);
  const [selectedLinkKey, setSelectedLinkKey] = useState<string | null>(null);
  const [nodePopover, setNodePopover] = useState<{ keys: string[]; clientX: number; clientY: number } | null>(null);
  const prevDrawerOpen = useRef(eventDrawerOpen ?? false);

  // Clear edge highlight when Event drawer is closed
  useEffect(() => {
    if (prevDrawerOpen.current && !eventDrawerOpen) {
      setSelectedLinkKey(null);
    }
    prevDrawerOpen.current = eventDrawerOpen ?? false;
  }, [eventDrawerOpen]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${SIZE} ${SIZE}`).attr("preserveAspectRatio", "xMidYMid meet");

    // Empty state
    if (data.length === 0) {
      svg
        .append("text")
        .attr("x", SIZE / 2)
        .attr("y", SIZE / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#64748b")
        .attr("font-size", "14px")
        .text("No data for current filters");
      return;
    }

    const centerX = SIZE / 2;
    const centerY = SIZE / 2;
    const radius = SIZE / 2 - MARGIN;

    // Process data
    const behaviorGroups = processCollaborationData(data);
    const allNodes = Array.from(getAllNodes(data));
    const nodeCount = allNodes.length;

    // Build id → name map
    const idToName = new Map<string, string>();
    data.forEach((row) => {
      if (!idToName.has(row.from_id)) idToName.set(row.from_id, row.from);
      if (!idToName.has(row.to_id)) idToName.set(row.to_id, row.to);
    });

    const nodeLabel = (id: string) => (showNames ? (idToName.get(id) ?? id) : id);

    // Zoom layer
    const zoomG = svg.append("g").attr("class", "zoom-layer");
    const g = zoomG.append("g").attr("transform", `translate(${centerX},${centerY})`);

    // Arrow markers
    const defs = svg.append("defs");
    behaviorGroups.forEach((group) => {
      defs
        .append("marker")
        .attr("id", `arrow-${group.behavior}`)
        .attr("viewBox", "0 0 3 3")
        .attr("refX", 3)
        .attr("refY", 1.5)
        .attr("markerWidth", 3)
        .attr("markerHeight", 3)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0,0 L 3,1.5 L 0,3 Z")
        .attr("fill", group.color);
    });

    // Tooltip
    const tooltip = svg.append("g").style("pointer-events", "none").style("display", "none");
    const tooltipBg = tooltip.append("rect").attr("fill", "#f8fafc").attr("stroke", "#e2e8f0").attr("rx", 6);
    const tooltipText = tooltip.append("text").attr("fill", "#0f172a").attr("font-size", "12px").attr("font-weight", 500);
    let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

    const showTooltip = (lines: string[], x: number, y: number) => {
      if (tooltipTimer) clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(() => {
        tooltipText.selectAll("tspan").remove();
        lines.forEach((line, i) => {
          tooltipText.append("tspan").attr("x", 0).attr("dy", i === 0 ? "0em" : "1.25em").text(line);
        });
        const bbox = (tooltipText.node() as SVGTextElement)?.getBBox();
        if (!bbox) return;
        tooltipBg.attr("x", bbox.x - 8).attr("y", bbox.y - 6).attr("width", bbox.width + 16).attr("height", bbox.height + 12);
        tooltip.attr("transform", `translate(${x + 12},${y + 12})`).style("display", null);
      }, 120);
    };

    const hideTooltip = () => {
      if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
      tooltip.style("display", "none");
    };

    // Node positions on circle
    const angleStep = (2 * Math.PI) / nodeCount;
    const nodePositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((node, i) => {
      const angle = i * angleStep - Math.PI / 2;
      nodePositions.set(node, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });

    // Behavior ring
    const behaviorGroupMap = new Map(behaviorGroups.map((g) => [g.behavior, g]));
    const behaviors = [
      ...BEHAVIOR_ORDER.filter((b) => behaviorGroupMap.has(b)),
      ...behaviorGroups.map((g) => g.behavior).filter((b) => !(BEHAVIOR_ORDER as readonly string[]).includes(b)),
    ];
    const behaviorAngleStep = (2 * Math.PI) / behaviors.length;
    const behaviorRadius = radius + 40;
    const arcWidth = 30;

    behaviors.forEach((behavior, i) => {
      const startAngle = i * behaviorAngleStep - Math.PI / 2;
      const endAngle = (i + 1) * behaviorAngleStep - Math.PI / 2;
      const arc = d3.arc().innerRadius(behaviorRadius).outerRadius(behaviorRadius + arcWidth).startAngle(startAngle).endAngle(endAngle);
      const color = behaviorGroupMap.get(behavior)?.color ?? BEHAVIOR_COLORS[behavior] ?? "#999";
      const isActive = selectedBehavior === null || selectedBehavior === behavior;

      const arcG = g.append("g");
      arcG
        .append("path")
        .attr("d", arc as any)
        .attr("fill", color)
        .attr("opacity", isActive ? 0.7 : 0.2)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", () => setSelectedBehavior(selectedBehavior === behavior ? null : behavior))
        .on("dblclick", () => onBehaviorDrilldown?.({ behavior }))
        .on("mouseover", function () { d3.select(this).attr("opacity", 0.9); })
        .on("mouseout", function () { d3.select(this).attr("opacity", isActive ? 0.7 : 0.2); });

      // Label
      const labelAngle = (startAngle + endAngle) / 2 - Math.PI / 2;
      const labelR = behaviorRadius + arcWidth + 14;
      arcG
        .append("text")
        .attr("x", labelR * Math.cos(labelAngle))
        .attr("y", labelR * Math.sin(labelAngle))
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#0f172a")
        .attr("font-size", "12px")
        .attr("font-weight", 600)
        .style("pointer-events", "none")
        .text(behavior);
    });

    // Links
    const linkGroup = g.append("g").attr("class", "links");
    const linkHitGroup = g.append("g").attr("class", "link-hits");
    const behaviorIndex = new Map(behaviors.map((b, i) => [b, i]));

    type LinkItem = {
      group: (typeof behaviorGroups)[0];
      link: { source: string; target: string; count: number };
      pathD: string;
      key: string;
      isSelected: boolean;
      baseWidth: number;
      hoverWidth: number;
    };
    const linkItems: LinkItem[] = [];

    behaviorGroups.forEach((group) => {
      if (selectedBehavior !== null && selectedBehavior !== group.behavior) return;
      const offset = behaviorIndex.get(group.behavior) || 0;

      group.links.forEach((link) => {
        const s = nodePositions.get(link.source);
        const t = nodePositions.get(link.target);
        if (!s || !t) return;

        const dx = t.x - s.x, dy = t.y - s.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * (0.9 + offset * 0.05);
        const pathD = `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
        const key = linkKey(group.behavior, link.source, link.target);

        linkItems.push({
          group,
          link,
          pathD,
          key,
          isSelected: selectedLinkKey === key,
          baseWidth: Math.max(1, Math.sqrt(link.count)),
          hoverWidth: Math.max(2, Math.sqrt(link.count) * 2),
        });
      });
    });

    // Sort so selected link is on top
    linkItems.sort((a, b) => (a.isSelected ? 1 : 0) - (b.isSelected ? 1 : 0));

    // Build node → edge map
    nodeEdgesRef.current.clear();
    linkItems.forEach(({ link, key }) => {
      [link.source, link.target].forEach((n) => {
        if (!nodeEdgesRef.current.has(n)) nodeEdgesRef.current.set(n, []);
        nodeEdgesRef.current.get(n)!.push(key);
      });
    });

    const baseOpacity = selectedBehavior === null ? 0.2 : 0.4;

    // Draw visible links
    linkItems.forEach(({ group, pathD, key, isSelected, baseWidth }) => {
      linkGroup
        .append("g")
        .attr("data-link-key", key)
        .style("pointer-events", "none")
        .append("path")
        .attr("class", "link-visible")
        .attr("d", pathD)
        .attr("fill", "none")
        .attr("stroke", group.color)
        .attr("stroke-width", isSelected ? Math.max(baseWidth * 2, 4) : baseWidth)
        .attr("opacity", isSelected ? 0.95 : baseOpacity)
        .attr("marker-end", `url(#arrow-${group.behavior})`);
    });

    // Link hover/click helpers
    const updateLink = (key: string, opacity: number, width: number) => {
      linkGroup.select(`g[data-link-key="${key}"] .link-visible`).attr("opacity", opacity).attr("stroke-width", width);
    };

    const resetAllLinks = (hoveredKey: string | null) => {
      linkItems.forEach(({ key, isSelected, baseWidth, hoverWidth }) => {
        if (isSelected) updateLink(key, 0.95, Math.max(hoverWidth, 4));
        else if (key === hoveredKey) updateLink(key, 0.8, hoverWidth);
        else updateLink(key, baseOpacity, baseWidth);
      });
    };

    // Link hit areas
    linkItems.forEach(({ group, link, pathD, key }) => {
      const fromName = idToName.get(link.source) ?? link.source;
      const toName = idToName.get(link.target) ?? link.target;
      linkInfoByKeyRef.current.set(key, { group, link, fromName, toName });

      linkHitGroup
        .append("path")
        .attr("d", pathD)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", 36)
        .style("cursor", "pointer")
        .on("click", () => {
          setSelectedLinkKey((prev) => (prev === key ? null : key));
          onLinkClick?.({ behavior: group.behavior, fromId: link.source, toId: link.target, fromName, toName, count: link.count });
        })
        .on("mouseover", function () { d3.select(this).raise(); resetAllLinks(key); })
        .on("mousemove", (event) => {
          const [x, y] = d3.pointer(event, svg.node()!);
          const lines = showNames
            ? [`${fromName} (${link.source}) → ${toName} (${link.target})`, `Behavior: ${group.behavior}`, `Count: ${link.count}`, "Click to view details"]
            : [`${link.source} → ${link.target}`, `Behavior: ${group.behavior}`, `Count: ${link.count}`, "Click to view details"];
          showTooltip(lines, x, y);
        })
        .on("mouseout", () => { resetAllLinks(null); hideTooltip(); });
    });

    // Nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    allNodes.forEach((node) => {
      const pos = nodePositions.get(node)!;
      const nodeG = nodeGroup.append("g").attr("transform", `translate(${pos.x},${pos.y})`);

      nodeG
        .append("circle")
        .attr("r", 8)
        .attr("fill", "#fff")
        .attr("stroke", "#4A90E2")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", (event: MouseEvent) => {
          const keys = nodeEdgesRef.current.get(node) ?? [];
          if (keys.length === 0) return;
          if (keys.length === 1) {
            const info = linkInfoByKeyRef.current.get(keys[0]);
            if (info) {
              setSelectedLinkKey((prev) => (prev === keys[0] ? null : keys[0]));
              onLinkClick?.({ behavior: info.group.behavior, fromId: info.link.source, toId: info.link.target, fromName: info.fromName, toName: info.toName, count: info.link.count });
            }
            return;
          }
          setNodePopover({ keys, clientX: event.clientX, clientY: event.clientY });
        })
        .on("mouseover", function () { d3.select(this).attr("r", 12).attr("stroke-width", 3); })
        .on("mousemove", (event) => {
          const [x, y] = d3.pointer(event, svg.node()!);
          showTooltip([showNames ? `${idToName.get(node) || node} (${node})` : node], x, y);
        })
        .on("mouseout", function () { d3.select(this).attr("r", 8).attr("stroke-width", 2); hideTooltip(); });

      // Node label
      const labelDist = 20;
      const lx = (pos.x / radius) * (radius + labelDist) - pos.x;
      const ly = (pos.y / radius) * (radius + labelDist) - pos.y;
      nodeG
        .append("text")
        .attr("x", lx)
        .attr("y", ly)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#333")
        .attr("font-size", "11px")
        .style("pointer-events", "none")
        .text(nodeLabel(node));
    });

    // Zoom
    const contentRadius = radius + 80;
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 4])
      .on("zoom", (event) => {
        const k = event.transform.k;
        const cw = 2 * contentRadius * k, ch = 2 * contentRadius * k;
        let minX: number, maxX: number, minY: number, maxY: number;
        if (cw <= SIZE && ch <= SIZE) {
          minX = k * (contentRadius - centerX); maxX = SIZE - k * (centerX + contentRadius);
          minY = k * (contentRadius - centerY); maxY = SIZE - k * (centerY + contentRadius);
        } else {
          minX = -k * (centerX + contentRadius); maxX = SIZE - k * (centerX - contentRadius);
          minY = -k * (centerY + contentRadius); maxY = SIZE - k * (centerY - contentRadius);
        }
        const tx = Math.min(Math.max(event.transform.x, minX), maxX);
        const ty = Math.min(Math.max(event.transform.y, minY), maxY);
        const clamped = d3.zoomIdentity.translate(tx, ty).scale(k);
        zoomTransformRef.current = clamped;
        zoomG.attr("transform", clamped.toString());
        if (tx !== event.transform.x || ty !== event.transform.y) svg.call(zoomBehavior.transform, clamped);
      });

    zoomBehaviorRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    // Restore previous zoom
    if (zoomTransformRef.current) {
      svg.call(zoomBehavior.transform, zoomTransformRef.current);
    }
  }, [data, showNames, selectedBehavior, selectedLinkKey, onLinkClick, onBehaviorDrilldown]);

  return (
    <div className="space-y-4">
      {/* Behavior filter buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setSelectedBehavior(null)} variant={selectedBehavior === null ? "default" : "outline"} size="sm">
          All
        </Button>
        {BEHAVIOR_BUTTON_LIST.map((behavior) => (
          <Button
            key={behavior}
            onClick={() => setSelectedBehavior(selectedBehavior === behavior ? null : behavior)}
            variant={selectedBehavior === behavior ? "default" : "outline"}
            size="sm"
            className="gap-2"
          >
            <div className="w-3 h-3 shrink-0 rounded-full border border-white/80 shadow-sm" style={{ backgroundColor: BEHAVIOR_COLORS[behavior] ?? "#999" }} />
            <span className="capitalize">{behavior}</span>
          </Button>
        ))}
      </div>

      {/* Diagram container */}
      <div className="relative w-full bg-muted/50 rounded-lg">
        {/* Node popover */}
        {nodePopover && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setNodePopover(null)} />
            <div
              className="fixed z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-border/50"
              style={{
                left: Math.min(nodePopover.clientX + 8, typeof window !== "undefined" ? window.innerWidth - 400 : nodePopover.clientX + 8),
                top: Math.min(nodePopover.clientY + 8, typeof window !== "undefined" ? window.innerHeight - 280 : nodePopover.clientY + 8),
              }}
              role="dialog"
            >
              <div className="border-b border-border/50 px-3 py-2.5">
                <p className="text-sm font-medium">Choose an interaction</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Select one to view details</p>
              </div>
              <ScrollArea className="h-[240px] rounded-b-lg">
                <ul className="p-2">
                  {[...nodePopover.keys]
                    .sort((a, b) => {
                      const ia = linkInfoByKeyRef.current.get(a);
                      const ib = linkInfoByKeyRef.current.get(b);
                      const idxA = ia ? (BEHAVIOR_ORDER as readonly string[]).indexOf(ia.group.behavior) : 999;
                      const idxB = ib ? (BEHAVIOR_ORDER as readonly string[]).indexOf(ib.group.behavior) : 999;
                      return idxA !== idxB ? idxA - idxB : a.localeCompare(b);
                    })
                    .map((key) => {
                      const info = linkInfoByKeyRef.current.get(key);
                      if (!info) return null;
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setSelectedLinkKey(key);
                              onLinkClick?.({ behavior: info.group.behavior, fromId: info.link.source, toId: info.link.target, fromName: info.fromName, toName: info.toName, count: info.link.count });
                              setNodePopover(null);
                            }}
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: info.group.color }} />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {showNames ? `${info.fromName} → ${info.toName}` : `${info.link.source} → ${info.link.target}`}
                            </span>
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{info.group.behavior}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">×{info.link.count}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </ScrollArea>
            </div>
          </>
        )}

        {/* SVG */}
        <svg ref={svgRef} style={{ width: "100%", height: "auto" }} />

        {/* Zoom controls */}
        <div className="absolute top-2 right-2 flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-md shadow"
            onClick={() => svgRef.current && zoomBehaviorRef.current && d3.select(svgRef.current).call(zoomBehaviorRef.current.scaleBy, 1.2)}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-md shadow"
            onClick={() => svgRef.current && zoomBehaviorRef.current && d3.select(svgRef.current).call(zoomBehaviorRef.current.scaleBy, 0.8)}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">Total records: {data.length}</p>
    </div>
  );
}
