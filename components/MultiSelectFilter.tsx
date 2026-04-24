"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface MultiSelectFilterOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  title: string;
  options: MultiSelectFilterOption[];
  selected: Set<string>;
  onFilterChange: (selected: Set<string>) => void;
}

export default function MultiSelectFilter({
  title,
  options,
  selected,
  onFilterChange,
}: MultiSelectFilterProps) {
  const handleToggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilterChange(next);
  };

  const handleSelectAll = () => {
    onFilterChange(new Set(options.map((o) => o.value)));
  };

  const handleDeselectAll = () => {
    onFilterChange(new Set<string>());
  };

  const isAllSelected = selected.size === options.length;
  const isNoneSelected = selected.size === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">{title}</p>
          <span className="text-[10px] text-muted-foreground/60">
            {selected.size}/{options.length}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleSelectAll}
            disabled={isAllSelected}
          >
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleDeselectAll}
            disabled={isNoneSelected}
          >
            Clear
          </Button>
        </div>
      </div>

      <div
        className="grid grid-flow-col grid-cols-2 gap-x-3 gap-y-1.5"
        style={{ gridTemplateRows: `repeat(${Math.ceil(options.length / 2)}, auto)` }}
      >
        {options.map(({ value, label }) => (
          <div key={value} className="flex items-center gap-1.5 min-w-0">
            <Checkbox
              id={`${title}-${value}`}
              checked={selected.has(value)}
              onCheckedChange={() => handleToggle(value)}
              className="shrink-0"
            />
            <Label
              htmlFor={`${title}-${value}`}
              className="text-xs leading-none cursor-pointer truncate peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {label}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
