"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Button } from "@/components/ui/button";
import { CollaborationData } from "@/lib/types";
import { processCollaborationData, getAllNodes, BEHAVIOR_COLORS } from "@/lib/dataProcessor";

const BEHAVIOR_ORDER = ["awareness", "sharing", "coordination", "improving"];

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
}

export default function ArcDiagram({ data, showNames = true, onLinkClick, onBehaviorDrilldown }: ArcDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedBehavior, setSelectedBehavior] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });

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

    // Create main group
    const g = svg.append("g").attr("transform", `translate(${centerX},${centerY})`);

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
    const orderedBehaviors = [
      ...BEHAVIOR_ORDER.filter((behavior) => behaviorGroupMap.has(behavior)),
      ...behaviorGroups
        .map((group) => group.behavior)
        .filter((behavior) => !BEHAVIOR_ORDER.includes(behavior)),
    ];
    const behaviors = orderedBehaviors;
    const behaviorAngleStep = (2 * Math.PI) / behaviors.length;

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

      arcGroup
        .append("path")
        .attr("d", arc as any)
        .attr("fill", BEHAVIOR_COLORS[behavior] || "#999")
        .attr("opacity", selectedBehavior === null || selectedBehavior === behavior ? 0.7 : 0.2)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", () => {
          setSelectedBehavior(selectedBehavior === behavior ? null : behavior);
        })
        .on("dblclick", () => {
          // Double-click for drill-down
          onBehaviorDrilldown?.({ behavior });
        })
        .on("mouseover", function () {
          d3.select(this).attr("opacity", 0.9);
        })
        .on("mouseout", function () {
          d3.select(this).attr("opacity", selectedBehavior === null || selectedBehavior === behavior ? 0.7 : 0.2);
        });

      // Add behavior label
      const labelAngle = (startAngle + endAngle) / 2;
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
        .text(behavior);
    });

    // Draw links (arcs between nodes)
    const linkGroup = g.append("g").attr("class", "links");

    // Calculate offset for multiple behaviors on same link
    const behaviorIndex = new Map<string, number>();
    behaviors.forEach((b, i) => behaviorIndex.set(b, i));

    behaviorGroups.forEach((group) => {
      if (selectedBehavior !== null && selectedBehavior !== group.behavior) return;

      const behaviorOffset = behaviorIndex.get(group.behavior) || 0;
      const totalBehaviors = behaviors.length;

      group.links.forEach((link) => {
        const sourcePos = nodePositions.get(link.source);
        const targetPos = nodePositions.get(link.target);

        if (!sourcePos || !targetPos) return;

        // Calculate arc path with offset for multiple behaviors
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        // Add offset based on behavior index when showing all behaviors
        let offsetDr = dr;
        if (selectedBehavior === null && totalBehaviors > 1) {
          // Offset each behavior slightly to make them visible
          const offsetFactor = 0.9 + (behaviorOffset * 0.05);
          offsetDr = dr * offsetFactor;
        }

        const baseStrokeWidth = Math.max(1, Math.sqrt(link.count));
        const hoverStrokeWidth = Math.max(2, Math.sqrt(link.count) * 2);

        // Create curved path
        const path = linkGroup
          .append("path")
          .attr("class", `link link-${group.behavior}`)
          .attr("d", `M${sourcePos.x},${sourcePos.y}A${offsetDr},${offsetDr} 0 0,1 ${targetPos.x},${targetPos.y}`)
          .attr("fill", "none")
          .attr("stroke", group.color)
          .attr("stroke-width", baseStrokeWidth)
          .attr("opacity", selectedBehavior === null ? 0.2 : 0.4)
          .attr("marker-end", `url(#arrow-${group.behavior})`)
          .style("pointer-events", "all")
          .style("cursor", "pointer");

        // Add hover and click effects
        path
          .on("click", function () {
            const sourceName = idToName.get(link.source) || link.source;
            const targetName = idToName.get(link.target) || link.target;
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
            d3.select(this)
              .attr("opacity", 0.8)
              .attr("stroke-width", hoverStrokeWidth);
          })
          .on("mousemove", function (event) {
            const [x, y] = d3.pointer(event, svg.node() as SVGSVGElement);
            scheduleTooltip(linkTooltipLines(link.source, link.target, group.behavior, link.count), x, y);
          })
          .on("mouseout", function () {
            d3.select(this)
              .attr("opacity", selectedBehavior === null ? 0.2 : 0.4)
              .attr("stroke-width", baseStrokeWidth);
            hideTooltip();
          })
          .on("mouseleave", hideTooltip);
      });
    });

    // Draw nodes
    const nodeGroup = g.append("g").attr("class", "nodes");

    allNodes.forEach((node) => {
      const pos = nodePositions.get(node)!;

      const nodeG = nodeGroup.append("g").attr("transform", `translate(${pos.x},${pos.y})`);

      // Node circle
      nodeG
        .append("circle")
        .attr("r", 8)
        .attr("fill", "#fff")
        .attr("stroke", "#4A90E2")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
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
  }, [data, showNames, selectedBehavior, dimensions, onLinkClick, onBehaviorDrilldown]);

  const behaviors = [
    ...BEHAVIOR_ORDER.filter((behavior) => behavior in BEHAVIOR_COLORS),
    ...Object.keys(BEHAVIOR_COLORS).filter(
      (behavior) => !BEHAVIOR_ORDER.includes(behavior)
    ),
  ];

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
        {behaviors.map((behavior) => (
          <Button
            key={behavior}
            onClick={() => setSelectedBehavior(selectedBehavior === behavior ? null : behavior)}
            variant={selectedBehavior === behavior ? "default" : "outline"}
            size="sm"
            className="gap-2"
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: BEHAVIOR_COLORS[behavior] }}
            />
            <span className="capitalize">{behavior}</span>
          </Button>
        ))}
      </div>

      <div className="flex justify-center bg-muted/50 rounded-lg p-4">
        <svg ref={svgRef} className="max-w-full h-auto" />
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>💡 Tip: Click on the outer behavior arcs or buttons to view specific behavior links</p>
        <p>Total records: {data.length}</p>
      </div>
    </div>
  );
}
