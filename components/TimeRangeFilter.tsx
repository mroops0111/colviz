"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { dateToDayLabel, totalDaysInRange } from "@/lib/dayLabel";
import BehaviorTrendChart from "@/components/BehaviorTrendChart";
import { CollaborationData } from "@/lib/types";

interface TimeRangeFilterProps {
  minDate: Date;
  maxDate: Date;
  startDate: Date;
  endDate: Date;
  onRangeChange: (start: Date, end: Date) => void;
  /**
   * Data already filtered by team & source (but NOT by the date range).
   * Used to render the per-day behavior distribution mini-chart above the slider.
   */
  chartData?: CollaborationData[];
  /** Behaviors to render as separate lines, in display order. */
  behaviors?: readonly string[];
  /** Color for each behavior key. */
  behaviorColors?: Record<string, string>;
}

export default function TimeRangeFilter({
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
  chartData,
  behaviors,
  behaviorColors,
}: TimeRangeFilterProps) {
  const formatDate = (date: Date): string => {
    return dateToDayLabel(date.toISOString(), minDate.toISOString());
  };

  // Convert dates to timestamps for slider
  const minTimestamp = minDate.getTime();
  const maxTimestamp = maxDate.getTime();
  const startTimestamp = startDate.getTime();
  const endTimestamp = endDate.getTime();

  const [sliderValues, setSliderValues] = useState<number[]>([
    startTimestamp,
    endTimestamp,
  ]);

  useEffect(() => {
    setSliderValues([startTimestamp, endTimestamp]);
  }, [startTimestamp, endTimestamp]);

  const handleSliderChange = (values: number[]) => {
    if (values.length !== 2) return;
    const [start, end] = values;
    setSliderValues([start, end]);
    onRangeChange(new Date(start), new Date(end));
  };

  const handleReset = () => {
    setSliderValues([minTimestamp, maxTimestamp]);
    onRangeChange(minDate, maxDate);
  };

  const isFullRange =
    sliderValues[0] === minTimestamp && sliderValues[1] === maxTimestamp;

  const displayStartDate = new Date(sliderValues[0]);
  const displayEndDate = new Date(sliderValues[1]);

  // Day labels are 1-indexed and inclusive (Day 1..Day N), so the count must
  // include both endpoints. e.g. Day 1 to Day 70 is 70 days, not 69.
  const totalDays = totalDaysInRange(
    minDate.toISOString(),
    maxDate.toISOString()
  );
  const selectedDays = totalDaysInRange(
    displayStartDate.toISOString(),
    displayEndDate.toISOString()
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Time Range</p>
          <span className="text-[10px] text-muted-foreground/60">{totalDays}d</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleReset}
          disabled={isFullRange}
        >
          Reset
        </Button>
      </div>

      <div className="space-y-3">
        {chartData && behaviors && behaviors.length > 0 && (
          <BehaviorTrendChart
            data={chartData}
            minDate={minDate}
            maxDate={maxDate}
            selectedStart={displayStartDate}
            selectedEnd={displayEndDate}
            behaviors={behaviors}
            colors={behaviorColors ?? {}}
          />
        )}
        <div className="space-y-2">
          <div className="px-1">
            <Slider
              min={minTimestamp}
              max={maxTimestamp}
              step={1000 * 60 * 60 * 24} // 1 day in milliseconds
              value={sliderValues}
              onValueChange={handleSliderChange}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-2 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/50">Start</span>
          <span className="text-right font-medium text-foreground">{formatDate(displayStartDate)}</span>
          <span className="text-muted-foreground/50">End</span>
          <span className="text-right font-medium text-foreground">{formatDate(displayEndDate)}</span>
          <span className="text-muted-foreground/50">Selected</span>
          <span className="text-right font-medium text-foreground">{selectedDays}d</span>
        </div>
      </div>
    </div>
  );
}
