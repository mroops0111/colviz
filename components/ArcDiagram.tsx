"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollaborationData } from "@/lib/types";
import { processCollaborationData, getAllNodes, BEHAVIOR_COLORS, BEHAVIOR_ORDER, BEHAVIOR_BUTTON_LIST } from "@/lib/dataProcessor";

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
  showNames?: boolean; // true = show from/to names, false = show from_id/to_id only
  onLinkClick?: (event: LinkClickEvent) => void;
  onBehaviorDrilldown?: (event: BehaviorClickEvent) => void;
  /** When Event drawer closes, edge highlight is cleared */
  eventDrawerOpen?: boolean;
}

// Selected link key: behavior + from + to (persists highlight until another edge selected or cleared)
function linkKey(behavior: string, source: string, target: string) {
  return `${behavior}:${source}:${target}`;
}

type LinkInfo = {
  group: { behavior: string; color: string };
  link: { source: string; target: string; count: number };
  fromName: string;
  toName: string;
};

export default function ArcDiagram({ data, showNames = true, onLinkClick, onBehaviorDrilldown, eventDrawerOpen }: ArcDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const linkInfoByKeyRef = useRef<Map<string, LinkInfo>>(new Map());
  const nodeEdgesRef = useRef<Map<string, string[]>>(new Map()); // nodeId → edge keys (source or target)
  const hoveredLinkKeyRef = useRef<string | null>(null); // only one edge hovered at a time
  const [selectedBehavior, setSelectedBehavior] = useState<string | null>(null);
  const [selectedLinkKey, setSelectedLinkKey] = useState<string | null>(null);
  const [nodePopover, setNodePopover] = useState<{ keys: string[]; clientX: number; clientY: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });
  const prevDrawerOpen = useRef(eventDrawerOpen ?? false);

  // Clear edge highlight when Event drawer is closed
  useEffect(() => {
    if (prevDrawerOpen.current && !eventDrawerOpen) {
      setSelectedLinkKey(null);
    }
    prevDrawerOpen.current = eventDrawerOpen ?? false;
  }, [eventDrawerOpen]);

  useEffect(() => {
    // Handle responsive sizing
    const handleResize = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const width = Math.min(container.clientWidth, 1200);
          const height = width;
          setDimensions({ width, height });
        }
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    if (data.length === 0) {
      const svg = d3
        .select(svgRef.current)
        .attr("width", dimensions.width)
        .attr("height", dimensions.height)
        .attr("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);

      svg
        .append("text")
        .attr("x", dimensions.width / 2)
        .attr("y", dimensions.height / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#64748b")
        .attr("font-size", "14px")
        .text("No data for current filters");
      return;
    }

    const { width, height } = dimensions;
    const margin = 80;
    const radius = Math.min(width, height) / 2 - margin;
    const centerX = width / 2;
    const centerY = height / 2;

    // Process data
    const behaviorGroups = processCollaborationData(data);
    const allNodes = Array.from(getAllNodes(data));
    const nodeCount = allNodes.length;
    const idToName = new Map<string, string>();

    data.forEach((row) => {
      if (!idToName.has(row.from_id)) {
        idToName.set(row.from_id, row.from);
      }
      if (!idToName.has(row.to_id)) {
        idToName.set(row.to_id, row.to);
      }
    });

    const nodeLabel = (id: string) => (showNames ? (idToName.get(id) ?? id) : id);
    const linkTooltipLines = (sourceId: string, targetId: string, behavior: string, count: number) =>
      showNames
        ? [
            `${idToName.get(sourceId) ?? sourceId} (${sourceId}) → ${idToName.get(targetId) ?? targetId} (${targetId})`,
            `Behavior: ${behavior}`,
            `Count: ${count}`,
            "Click to view details",
          ]
        : [
            `${sourceId} → ${targetId}`,
            `Behavior: ${behavior}`,
            `Count: ${count}`,
            "Click to view details",
          ];

    // Create SVG
    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    // Zoom layer: content inside zoomG so zoom/pan applies to the diagram
    const zoomG = svg.append("g").attr("class", "zoom-layer");
    const g = zoomG.append("g").attr("transform", `translate(${centerX},${centerY})`);

    // Define arrow markers for each behavior color
    const defs = svg.append("defs");
    const markerSize = 3;
    const markerRefX = markerSize;
    const markerRefY = markerSize / 2;

    behaviorGroups.forEach((group) => {
      const marker = defs
        .append("marker")
        .attr("id", `arrow-${group.behavior}`)
        .attr("viewBox", `0 0 ${markerSize} ${markerSize}`)
        .attr("refX", markerRefX)
        .attr("refY", markerRefY)
        .attr("markerWidth", markerSize)
        .attr("markerHeight", markerSize)
        .attr("orient", "auto");

      marker
        .append("path")
        .attr("d", `M 0,0 L ${markerSize},${markerRefY} L 0,${markerSize} Z`)
        .attr("fill", group.color);
    });

    // Tooltip (slight hover delay)
    const tooltip = svg
      .append("g")
      .style("pointer-events", "none")
      .style("display", "none");

    const tooltipBg = tooltip
      .append("rect")
      .attr("fill", "#f8fafc")
      .attr("stroke", "#e2e8f0")
      .attr("rx", 6)
      .attr("ry", 6);

    const tooltipText = tooltip
      .append("text")
      .attr("fill", "#0f172a")
      .attr("font-size", "12px")
      .attr("font-weight", 500);

    let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

    const showTooltipNow = (lines: string[], x: number, y: number) => {
      tooltipText.selectAll("tspan").remove();
      lines.forEach((line, index) => {
        tooltipText
          .append("tspan")
          .attr("x", 0)
          .attr("dy", index === 0 ? "0em" : "1.25em")
          .text(line);
      });

      const bbox = (tooltipText.node() as SVGTextElement | null)?.getBBox();
      if (!bbox) return;

      const paddingX = 8;
      const paddingY = 6;
      tooltipBg
        .attr("x", bbox.x - paddingX)
        .attr("y", bbox.y - paddingY)
        .attr("width", bbox.width + paddingX * 2)
        .attr("height", bbox.height + paddingY * 2);

      tooltip
        .attr("transform", `translate(${x + 12},${y + 12})`)
        .style("display", null);
    };

    const scheduleTooltip = (lines: string[], x: number, y: number) => {
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
      }
      tooltipTimer = setTimeout(() => {
        showTooltipNow(lines, x, y);
      }, 120);
    };

    const hideTooltip = () => {
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
      }
      tooltip.style("display", "none");
    };

    // Calculate node positions on circle
    const angleStep = (2 * Math.PI) / nodeCount;
    const nodePositions = new Map<string, { x: number; y: number; angle: number }>();

    allNodes.forEach((node, i) => {
      const angle = i * angleStep - Math.PI / 2; // Start from top
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      nodePositions.set(node, { x, y, angle });
    });

    // Draw behavior arcs (outer circles)
    const behaviorRadius = radius + 40;
    const arcWidth = 30;
    const behaviorGroupMap = new Map(
      behaviorGroups.map((group) => [group.behavior, group])
    );
    const orderList = BEHAVIOR_ORDER as readonly string[];
    const orderedBehaviors = [
      ...BEHAVIOR_ORDER.filter((behavior) => behaviorGroupMap.has(behavior)),
      ...behaviorGroups
        .map((group) => group.behavior)
        .filter((behavior) => !orderList.includes(behavior)),
    ];
    const behaviors = orderedBehaviors;
    const behaviorAngleStep = (2 * Math.PI) / behaviors.length;

    // Draw each segment in BEHAVIOR_ORDER so index i = behaviors[i]; label and color must both use behaviors[i]
    behaviors.forEach((behavior, i) => {
      const startAngle = i * behaviorAngleStep - Math.PI / 2;
      const endAngle = (i + 1) * behaviorAngleStep - Math.PI / 2;

      const arc = d3
        .arc()
        .innerRadius(behaviorRadius)
        .outerRadius(behaviorRadius + arcWidth)
        .startAngle(startAngle)
        .endAngle(endAngle);

      const arcGroup = g.append("g").attr("class", `behavior-arc-${behavior}`);
      // Use same color as link arcs (from processCollaborationData) so outer ring matches filter/diagram
      const arcColor = behaviorGroupMap.get(behavior)?.color ?? BEHAVIOR_COLORS[behavior] ?? "#999999";

      arcGroup
        .append("path")
        .attr("d", arc as any)
        .attr("fill", arcColor)
        .attr("opacity", selectedBehavior === null || selectedBehavior === behavior ? 0.7 : 0.2)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", () => {
          setSelectedBehavior(selectedBehavior === behavior ? null : behavior);
        })
        .on("dblclick", () => {
          onBehaviorDrilldown?.({ behavior });
        })
        .on("mouseover", function () {
          d3.select(this).attr("opacity", 0.9);
        })
        .on("mouseout", function () {
          d3.select(this).attr("opacity", selectedBehavior === null || selectedBehavior === behavior ? 0.7 : 0.2);
        });

      // Label: use same angle convention as d3.arc (it subtracts π/2 internally), so subtract π/2 for label position
      const labelBehavior = behaviors[i];
      const labelAngle = (startAngle + endAngle) / 2 - Math.PI / 2;
      const labelRadius = behaviorRadius + arcWidth + 14;
      const labelX = labelRadius * Math.cos(labelAngle);
      const labelY = labelRadius * Math.sin(labelAngle);

      arcGroup
        .append("text")
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#0f172a")
        .attr("font-size", "12px")
        .attr("font-weight", 600)
        .style("pointer-events", "none")
        .text(labelBehavior);
    });

    // Draw links: (1) visible paths, (2) nodes, (3) hit areas on top so they receive clicks and can raise on hover
    const linkGroup = g.append("g").attr("class", "links");
    const behaviorIndex = new Map<string, number>();
    behaviors.forEach((b, i) => behaviorIndex.set(b, i));

    type LinkItem = {
      group: (typeof behaviorGroups)[0];
      link: (typeof behaviorGroups)[0]["links"][0];
      pathD: string;
      key: string;
      isSelected: boolean;
      baseStrokeWidth: number;
      hoverStrokeWidth: number;
      baseOpacity: number;
      selectedOpacity: number;
      selectedStrokeWidth: number;
    };
    const linkItems: LinkItem[] = [];

    behaviorGroups.forEach((group) => {
      if (selectedBehavior !== null && selectedBehavior !== group.behavior) return;
      const behaviorOffset = behaviorIndex.get(group.behavior) || 0;
      const totalBehaviors = behaviors.length;

      group.links.forEach((link) => {
        const sourcePos = nodePositions.get(link.source);
        const targetPos = nodePositions.get(link.target);
        if (!sourcePos || !targetPos) return;

        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        let offsetDr = dr;
        if (selectedBehavior === null && totalBehaviors > 1) {
          const offsetFactor = 0.9 + (behaviorOffset * 0.05);
          offsetDr = dr * offsetFactor;
        }

        const pathD = `M${sourcePos.x},${sourcePos.y}A${offsetDr},${offsetDr} 0 0,1 ${targetPos.x},${targetPos.y}`;
        const baseStrokeWidth = Math.max(1, Math.sqrt(link.count));
        const hoverStrokeWidth = Math.max(2, Math.sqrt(link.count) * 2);
        const key = linkKey(group.behavior, link.source, link.target);
        const isSelected = selectedLinkKey === key;
        const baseOpacity = selectedBehavior === null ? 0.2 : 0.4;
        const selectedOpacity = 0.95;
        const selectedStrokeWidth = Math.max(hoverStrokeWidth, 4);

        linkItems.push({
          group,
          link,
          pathD,
          key,
          isSelected,
          baseStrokeWidth,
          hoverStrokeWidth,
          baseOpacity,
          selectedOpacity,
          selectedStrokeWidth,
        });
      });
    });

    const sortedItems = [...linkItems].sort((a, b) => (a.isSelected ? 1 : 0) - (b.isSelected ? 1 : 0));

    // Build nodeId → edge keys (edges where node is source or target)
    nodeEdgesRef.current.clear();
    sortedItems.forEach(({ link, key }) => {
      const add = (n: string) => {
        if (!nodeEdgesRef.current.has(n)) nodeEdgesRef.current.set(n, []);
        nodeEdgesRef.current.get(n)!.push(key);
      };
      add(link.source);
      add(link.target);
    });

    // Layer 1: visible link paths only (pointer-events: none)
    sortedItems.forEach(({ group, link, pathD, key, isSelected, baseStrokeWidth, baseOpacity, selectedOpacity, selectedStrokeWidth }) => {
      const linkG = linkGroup.append("g").attr("class", `link-group link-${group.behavior}`).attr("data-link-key", key).style("pointer-events", "none");
      linkG
        .append("path")
        .attr("class", "link-visible")
        .attr("d", pathD)
        .attr("fill", "none")
        .attr("stroke", group.color)
        .attr("stroke-width", isSelected ? selectedStrokeWidth : baseStrokeWidth)
        .attr("opacity", isSelected ? selectedOpacity : baseOpacity)
        .attr("marker-end", `url(#arrow-${group.behavior})`);
    });

    // Layer 2: link hit areas (edge click = only that edge; raise on hover)
    const hitStrokeWidth = 36;
    const linkHitGroup = g.append("g").attr("class", "link-hits");
    const updateVisibleByKey = (linkKeyVal: string, opacity: number, strokeW: number) => {
      linkGroup.select(`g[data-link-key="${linkKeyVal}"] .link-visible`).attr("opacity", opacity).attr("stroke-width", strokeW);
    };
    // Reset all edges to correct style so only one is hovered at a time (fix fast mouse movement)
    const syncAllLinkStyles = (hoveredKey: string | null) => {
      hoveredLinkKeyRef.current = hoveredKey;
      sortedItems.forEach(({ key: k, isSelected, baseOpacity, baseStrokeWidth, hoverStrokeWidth, selectedOpacity, selectedStrokeWidth }) => {
        if (isSelected) updateVisibleByKey(k, selectedOpacity, selectedStrokeWidth);
        else if (k === hoveredKey) updateVisibleByKey(k, 0.8, hoverStrokeWidth);
        else updateVisibleByKey(k, baseOpacity, baseStrokeWidth);
      });
    };

    sortedItems.forEach(({ group, link, pathD, key, isSelected, baseStrokeWidth, hoverStrokeWidth, baseOpacity, selectedOpacity, selectedStrokeWidth }) => {
      const fromName = idToName.get(link.source) ?? link.source;
      const toName = idToName.get(link.target) ?? link.target;
      linkInfoByKeyRef.current.set(key, { group, link, fromName, toName });

      const hitG = linkHitGroup
        .append("g")
        .attr("class", `link-hit-group link-${group.behavior}`)
        .attr("data-link-key", key)
        .style("cursor", "pointer");

      hitG
        .append("path")
        .attr("class", "link-hit")
        .attr("d", pathD)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", hitStrokeWidth)
        .style("pointer-events", "all");

      hitG
        .on("click", function () {
          const sourceName = idToName.get(link.source) || link.source;
          const targetName = idToName.get(link.target) || link.target;
          setSelectedLinkKey((prev) => (prev === key ? null : key));
          onLinkClick?.({
            behavior: group.behavior,
            fromId: link.source,
            toId: link.target,
            fromName: sourceName,
            toName: targetName,
            count: link.count,
          });
        })
        .on("mouseover", function () {
          hitG.raise(); // bring this edge's hit area to front so overlapping edges can be hovered/clicked
          syncAllLinkStyles(key); // ensure only this edge is hovered (fix fast mouse movement)
        })
        .on("mousemove", function (event) {
          const [x, y] = d3.pointer(event, svg.node() as SVGSVGElement);
          scheduleTooltip(linkTooltipLines(link.source, link.target, group.behavior, link.count), x, y);
        })
        .on("mouseout", function () {
          syncAllLinkStyles(null); // clear hover for all
          hideTooltip();
        })
        .on("mouseleave", hideTooltip);
    });

    // Layer 3: nodes on top so node click opens popover (edge click only when clicking on edge, not node)
    const nodeGroup = g.append("g").attr("class", "nodes");

    allNodes.forEach((node) => {
      const pos = nodePositions.get(node)!;

      const nodeG = nodeGroup.append("g").attr("transform", `translate(${pos.x},${pos.y})`);

      // Node circle: click opens popover only when node has multiple edges; single edge = select directly
      nodeG
        .append("circle")
        .attr("r", 8)
        .attr("fill", "#fff")
        .attr("stroke", "#4A90E2")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", function (event: MouseEvent) {
          const keys = nodeEdgesRef.current.get(node) ?? [];
          if (keys.length === 0) return;
          if (keys.length === 1) {
            const key = keys[0];
            const info = linkInfoByKeyRef.current.get(key);
            if (info) {
              setSelectedLinkKey((prev) => (prev === key ? null : key));
              onLinkClick?.({
                behavior: info.group.behavior,
                fromId: info.link.source,
                toId: info.link.target,
                fromName: info.fromName,
                toName: info.toName,
                count: info.link.count,
              });
            }
            return;
          }
          setNodePopover({ keys, clientX: event.clientX, clientY: event.clientY });
        })
        .on("mouseover", function () {
          d3.select(this).attr("r", 12).attr("stroke-width", 3);
        })
        .on("mousemove", function (event) {
          const [x, y] = d3.pointer(event, svg.node() as SVGSVGElement);
          const line = showNames ? `${idToName.get(node) || node} (${node})` : node;
          scheduleTooltip([line], x, y);
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", 8).attr("stroke-width", 2);
          hideTooltip();
        });

      // Node label
      const labelDistance = 20;
      const labelX = (pos.x / radius) * (radius + labelDistance) - pos.x;
      const labelY = (pos.y / radius) * (radius + labelDistance) - pos.y;

      nodeG
        .append("text")
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#333")
        .attr("font-size", "11px")
        .style("pointer-events", "none")
        .text(nodeLabel(node));

    });

    // Zoom and pan: clamp translate so diagram cannot be dragged off-screen; when zoomed in, allow pan within overlap
    const contentRadius = radius + 80;
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 4])
      .on("zoom", (event) => {
        const k = event.transform.k;
        let tx = event.transform.x;
        let ty = event.transform.y;
        const contentW = 2 * contentRadius * k;
        const contentH = 2 * contentRadius * k;
        let minX: number, maxX: number, minY: number, maxY: number;
        if (contentW <= width && contentH <= height) {
          // Content fits: keep it fully inside viewport
          minX = k * (contentRadius - centerX);
          maxX = width - k * (centerX + contentRadius);
          minY = k * (contentRadius - centerY);
          maxY = height - k * (centerY + contentRadius);
        } else {
          // Content larger than viewport: allow pan so it can overlap viewport (no full escape)
          minX = -k * (centerX + contentRadius);
          maxX = width - k * (centerX - contentRadius);
          minY = -k * (centerY + contentRadius);
          maxY = height - k * (centerY - contentRadius);
        }
        tx = Math.min(Math.max(tx, minX), maxX);
        ty = Math.min(Math.max(ty, minY), maxY);
        const clamped = d3.zoomIdentity.translate(tx, ty).scale(k);
        zoomTransformRef.current = clamped;
        zoomG.attr("transform", clamped.toString());
        if (tx !== event.transform.x || ty !== event.transform.y) {
          svg.call(zoomBehavior.transform, clamped);
        }
      });
    zoomBehaviorRef.current = zoomBehavior;
    svg.call(zoomBehavior);
    if (zoomTransformRef.current) {
      const t = zoomTransformRef.current;
      const k = t.k;
      const contentW = 2 * contentRadius * k;
      const contentH = 2 * contentRadius * k;
      let minX: number, maxX: number, minY: number, maxY: number;
      if (contentW <= width && contentH <= height) {
        minX = k * (contentRadius - centerX);
        maxX = width - k * (centerX + contentRadius);
        minY = k * (contentRadius - centerY);
        maxY = height - k * (centerY + contentRadius);
      } else {
        minX = -k * (centerX + contentRadius);
        maxX = width - k * (centerX - contentRadius);
        minY = -k * (centerY + contentRadius);
        maxY = height - k * (centerY - contentRadius);
      }
      const tx = Math.min(Math.max(t.x, minX), maxX);
      const ty = Math.min(Math.max(t.y, minY), maxY);
      const clamped = d3.zoomIdentity.translate(tx, ty).scale(k);
      zoomTransformRef.current = clamped;
      svg.call(zoomBehavior.transform, clamped);
    }
  }, [data, showNames, selectedBehavior, selectedLinkKey, dimensions, onLinkClick, onBehaviorDrilldown]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setSelectedBehavior(null)}
          variant={selectedBehavior === null ? "default" : "outline"}
          size="sm"
        >
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
            <div
              className="w-3 h-3 shrink-0 rounded-full border border-white/80 shadow-sm"
              style={{ backgroundColor: BEHAVIOR_COLORS[behavior] ?? "#999999" }}
              aria-hidden
            />
            <span className="capitalize">{behavior}</span>
          </Button>
        ))}
      </div>

      <div className="relative flex justify-center bg-muted/50 rounded-lg p-4">
        {nodePopover && (
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setNodePopover(null)}
            />
            <div
              className="fixed z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-border/50"
              style={{
                left: Math.min(nodePopover.clientX + 8, typeof window !== "undefined" ? window.innerWidth - 400 : nodePopover.clientX + 8),
                top: Math.min(nodePopover.clientY + 8, typeof window !== "undefined" ? window.innerHeight - 280 : nodePopover.clientY + 8),
              }}
              role="dialog"
              aria-label="Choose edge"
            >
              <div className="border-b border-border/50 px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">
                  Choose an edge
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select one to view details
                </p>
              </div>
              <ScrollArea className="h-[240px] overflow-hidden rounded-b-lg">
                <ul className="p-2">
                  {[...nodePopover.keys]
                    .sort((a, b) => {
                      const infoA = linkInfoByKeyRef.current.get(a);
                      const infoB = linkInfoByKeyRef.current.get(b);
                      const idxA = infoA ? (BEHAVIOR_ORDER as readonly string[]).indexOf(infoA.group.behavior) : -1;
                      const idxB = infoB ? (BEHAVIOR_ORDER as readonly string[]).indexOf(infoB.group.behavior) : -1;
                      if (idxA !== idxB) return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                      return a.localeCompare(b);
                    })
                    .map((key) => {
                    const info = linkInfoByKeyRef.current.get(key);
                    if (!info) return null;
                    const label = showNames
                      ? `${info.fromName} → ${info.toName}`
                      : `${info.link.source} → ${info.link.target}`;
                    const behaviorLabel = info.group.behavior;
                    const color = info.group.color;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => {
                            setSelectedLinkKey(key);
                            onLinkClick?.({
                              behavior: info.group.behavior,
                              fromId: info.link.source,
                              toId: info.link.target,
                              fromName: info.fromName,
                              toName: info.toName,
                              count: info.link.count,
                            });
                            setNodePopover(null);
                          }}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {label}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {behaviorLabel}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            ×{info.link.count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          </>
        )}
        <svg ref={svgRef} className="max-w-full h-auto" />
        <div className="absolute top-2 right-2 flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-md shadow"
            onClick={() => {
              if (svgRef.current && zoomBehaviorRef.current) {
                d3.select(svgRef.current).call(zoomBehaviorRef.current.scaleBy, 1.2);
              }
            }}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-md shadow"
            onClick={() => {
              if (svgRef.current && zoomBehaviorRef.current) {
                d3.select(svgRef.current).call(zoomBehaviorRef.current.scaleBy, 0.8);
              }
            }}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>Total records: {data.length}</p>
      </div>
    </div>
  );
}
