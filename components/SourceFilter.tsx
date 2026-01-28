"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CollaborationData } from "@/lib/types";

interface SourceFilterProps {
  data: CollaborationData[];
  onFilterChange: (selectedSources: Set<string>) => void;
}

export default function SourceFilter({
  data,
  onFilterChange,
}: SourceFilterProps) {
  const sources = Array.from(new Set(data.map((d) => d.source))).sort();

  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(sources)
  );

  useEffect(() => {
    const newSources = Array.from(new Set(data.map((d) => d.source))).sort();
    setSelectedSources(new Set(newSources));
  }, [data]);

  const handleSourceToggle = (source: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(source)) {
      newSelected.delete(source);
    } else {
      newSelected.add(source);
    }
    setSelectedSources(newSelected);
    onFilterChange(newSelected);
  };

  const handleSelectAll = () => {
    const allSources = new Set(sources);
    setSelectedSources(allSources);
    onFilterChange(allSources);
  };

  const handleDeselectAll = () => {
    const emptySet = new Set<string>();
    setSelectedSources(emptySet);
    onFilterChange(emptySet);
  };

  const isAllSelected = selectedSources.size === sources.length;
  const isNoneSelected = selectedSources.size === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold">Sources</h2>
          <p className="text-xs text-muted-foreground">
            {selectedSources.size} / {sources.length} selected
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
        {sources.map((source) => (
          <div key={source} className="flex items-center space-x-2">
            <Checkbox
              id={`source-${source}`}
              checked={selectedSources.has(source)}
              onCheckedChange={() => handleSourceToggle(source)}
            />
            <Label
              htmlFor={`source-${source}`}
              className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {source}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
