"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface TimeRangeFilterProps {
  minDate: Date;
  maxDate: Date;
  startDate: Date;
  endDate: Date;
  onRangeChange: (start: Date, end: Date) => void;
}

export default function TimeRangeFilter({
  minDate,
  maxDate,
  startDate,
  endDate,
  onRangeChange,
}: TimeRangeFilterProps) {
  const formatDate = (date: Date): string => {
    return date.toISOString().split("T")[0];
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

  // Calculate the number of days in the range
  const totalDays = Math.ceil(
    (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)
  );
  const selectedDays = Math.ceil(
    (sliderValues[1] - sliderValues[0]) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold">Time Range</h2>
          <p className="text-xs text-muted-foreground">
            {formatDate(minDate)} to {formatDate(maxDate)} ({totalDays} days)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={isFullRange}
        >
          Reset
        </Button>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-xs">Range</Label>
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

        <div className="grid grid-cols-1 gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Start</span>
            <span className="font-medium">{formatDate(displayStartDate)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">End</span>
            <span className="font-medium">{formatDate(displayEndDate)}</span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Selected: {selectedDays} days
        </div>
      </div>
    </div>
  );
}
