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
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {selected.size} / {options.length} selected
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={isAllSelected}
          >
            All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeselectAll}
            disabled={isNoneSelected}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {options.map(({ value, label }) => (
          <div key={value} className="flex items-center space-x-2">
            <Checkbox
              id={`${title}-${value}`}
              checked={selected.has(value)}
              onCheckedChange={() => handleToggle(value)}
            />
            <Label
              htmlFor={`${title}-${value}`}
              className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {label}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
