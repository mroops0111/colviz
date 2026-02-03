"use client";

import { useMemo } from "react";
import { CollaborationData } from "@/lib/types";
import MultiSelectFilter, { MultiSelectFilterOption } from "./MultiSelectFilter";

interface SourceFilterProps {
  data: CollaborationData[];
  selected: Set<string>;
  onFilterChange: (selected: Set<string>) => void;
}

export default function SourceFilter({
  data,
  selected,
  onFilterChange,
}: SourceFilterProps) {
  const options: MultiSelectFilterOption[] = useMemo(
    () =>
      Array.from(new Set(data.map((d) => d.source)))
        .sort()
        .map((value) => ({ value, label: value })),
    [data]
  );

  return (
    <MultiSelectFilter
      title="Sources"
      options={options}
      selected={selected}
      onFilterChange={onFilterChange}
    />
  );
}
