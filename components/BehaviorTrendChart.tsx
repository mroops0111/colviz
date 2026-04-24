"use client";

/**
 * BehaviorTrendChart
 *
 * Mini multi-line chart shown above the day-range slider. It renders one line
 * per behavior across the full Day 1..Day N range so the user can see the
 * temporal distribution of behaviors at a glance.
 *
 * - X-axis: Day index (1..totalDays). Always covers the full data range and
 *   does NOT shrink with the day filter.
 * - Y-axis: per-day interaction count for that behavior.
 * - The current day-filter range is overlaid as two vertical marker lines plus
 *   a faint highlighted band so the user can correlate the slider with the
 *   distribution.
 * - Hovering anywhere in the plot area snaps to the nearest day and shows a
 *   tooltip with per-behavior counts for that day.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { CollaborationData } from "@/lib/types";
import { totalDaysInRange } from "@/lib/dayLabel";

interface BehaviorTrendChartProps {
  /** Data already filtered by team & source, but NOT by date range. */
  data: CollaborationData[];
  minDate: Date;
  maxDate: Date;
  selectedStart: Date;
  selectedEnd: Date;
  behaviors: readonly string[];
  colors: Record<string, string>;
}

const HEIGHT = 120;
const MARGIN = { top: 8, right: 8, bottom: 18, left: 28 };

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Day index (1-based) of `date` relative to `minDate`. */
function dayIndex(date: Date, minDate: Date): number {
  const diff = startOfDay(date).getTime() - startOfDay(minDate).getTime();
  return Math.round(diff / MS_PER_DAY) + 1;
}

export default function BehaviorTrendChart({
  data,
  minDate,
  maxDate,
  selectedStart,
  selectedEnd,
  behaviors,
  colors,
}: BehaviorTrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  // Track container width so the chart is responsive within the sidebar card.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const totalDays = useMemo(
    () => totalDaysInRange(minDate.toISOString(), maxDate.toISOString()),
    [minDate, maxDate]
  );

  // Pre-aggregate counts: counts[behavior][dayIndex-1] = count
  const countsByBehavior = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const b of behaviors) {
      result[b] = new Array(totalDays).fill(0);
    }
    for (const row of data) {
      const d = dayIndex(new Date(row.date), minDate);
      if (d < 1 || d > totalDays) continue;
      const arr = result[row.behavior];
      if (!arr) continue;
      arr[d - 1] += 1;
    }
    return result;
  }, [data, behaviors, minDate, totalDays]);

  const yMax = useMemo(() => {
    let m = 0;
    for (const b of behaviors) {
      const arr = countsByBehavior[b];
      if (!arr) continue;
      for (const v of arr) if (v > m) m = v;
    }
    return Math.max(m, 1);
  }, [countsByBehavior, behaviors]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain([1, Math.max(totalDays, 2)])
        .range([0, innerWidth]),
    [totalDays, innerWidth]
  );

  const yScale = useMemo(
    () => d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]),
    [yMax, innerHeight]
  );

  const lineGen = useMemo(
    () =>
      d3
        .line<{ day: number; value: number }>()
        .x((d) => xScale(d.day))
        .y((d) => yScale(d.value))
        .curve(d3.curveMonotoneX),
    [xScale, yScale]
  );

  // Render axes via D3 imperatively (cleaner than reimplementing tick math).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || innerWidth <= 0) return;
    const root = d3.select(svg);
    const xAxisG = root.select<SVGGElement>("g.x-axis");
    const yAxisG = root.select<SVGGElement>("g.y-axis");

    const tickCount = Math.max(2, Math.min(5, Math.floor(innerWidth / 60)));
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickCount)
      .tickFormat((d) => `D${d}`)
      .tickSizeOuter(0);
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(3)
      .tickFormat(d3.format("d"))
      .tickSizeOuter(0);

    xAxisG.call(xAxis);
    yAxisG.call(yAxis);

    xAxisG.selectAll("text").attr("font-size", 9).attr("fill", "currentColor");
    yAxisG.selectAll("text").attr("font-size", 9).attr("fill", "currentColor");
    xAxisG.selectAll("path,line").attr("stroke", "currentColor").attr("stroke-opacity", 0.25);
    yAxisG.selectAll("path,line").attr("stroke", "currentColor").attr("stroke-opacity", 0.25);
  }, [xScale, yScale, innerWidth]);

  const startDay = dayIndex(selectedStart, minDate);
  const endDay = dayIndex(selectedEnd, minDate);

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const day = Math.round(xScale.invert(x));
    if (day < 1 || day > totalDays) {
      setHoverDay(null);
      return;
    }
    setHoverDay(day);
  };

  const handleMouseLeave = () => setHoverDay(null);

  // Build tooltip content for current hoverDay.
  const tooltip = useMemo(() => {
    if (hoverDay == null) return null;
    const items = behaviors.map((b) => ({
      behavior: b,
      value: countsByBehavior[b]?.[hoverDay - 1] ?? 0,
      color: colors[b] ?? "#999",
    }));
    return { day: hoverDay, items };
  }, [hoverDay, behaviors, countsByBehavior, colors]);

  // Position tooltip; keep within container bounds.
  const tooltipLeft =
    hoverDay != null
      ? Math.min(
          Math.max(MARGIN.left + xScale(hoverDay) - 60, 4),
          Math.max(width - 140, 4)
        )
      : 0;

  return (
    <div ref={containerRef} className="relative w-full select-none">
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          className="text-muted-foreground"
          role="img"
          aria-label="Daily behavior distribution"
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Selected-range highlight band */}
            {endDay >= startDay && (
              <rect
                x={xScale(startDay)}
                y={0}
                width={Math.max(1, xScale(endDay) - xScale(startDay))}
                height={innerHeight}
                fill="currentColor"
                fillOpacity={0.06}
              />
            )}

            {/* Behavior lines */}
            {behaviors.map((b) => {
              const arr = countsByBehavior[b];
              if (!arr) return null;
              const points = arr.map((v, i) => ({ day: i + 1, value: v }));
              const path = lineGen(points) ?? "";
              return (
                <path
                  key={b}
                  d={path}
                  fill="none"
                  stroke={colors[b] ?? "#999"}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}

            {/* Range marker lines (start / end of day filter) */}
            <line
              x1={xScale(startDay)}
              x2={xScale(startDay)}
              y1={0}
              y2={innerHeight}
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeDasharray="3 2"
            />
            <line
              x1={xScale(endDay)}
              x2={xScale(endDay)}
              y1={0}
              y2={innerHeight}
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeDasharray="3 2"
            />

            {/* Hover guideline + dots */}
            {hoverDay != null && (
              <>
                <line
                  x1={xScale(hoverDay)}
                  x2={xScale(hoverDay)}
                  y1={0}
                  y2={innerHeight}
                  stroke="currentColor"
                  strokeOpacity={0.4}
                />
                {behaviors.map((b) => {
                  const v = countsByBehavior[b]?.[hoverDay - 1] ?? 0;
                  return (
                    <circle
                      key={b}
                      cx={xScale(hoverDay)}
                      cy={yScale(v)}
                      r={2.5}
                      fill={colors[b] ?? "#999"}
                    />
                  );
                })}
              </>
            )}

            {/* Mouse capture overlay */}
            <rect
              x={0}
              y={0}
              width={Math.max(0, innerWidth)}
              height={innerHeight}
              fill="transparent"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />
          </g>

          <g
            className="x-axis"
            transform={`translate(${MARGIN.left},${HEIGHT - MARGIN.bottom})`}
          />
          <g
            className="y-axis"
            transform={`translate(${MARGIN.left},${MARGIN.top})`}
          />
        </svg>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 text-[10px] shadow-md"
          style={{ left: tooltipLeft, top: 0, minWidth: 120 }}
        >
          <div className="mb-1 font-medium text-foreground">Day {tooltip.day}</div>
          <div className="space-y-0.5">
            {tooltip.items.map((it) => (
              <div
                key={it.behavior}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: it.color }}
                  />
                  {it.behavior}
                </span>
                <span className="font-medium text-foreground">{it.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
