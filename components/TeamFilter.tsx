"use client";

import { useMemo } from "react";
import { CollaborationData } from "@/lib/types";
import MultiSelectFilter, { MultiSelectFilterOption } from "./MultiSelectFilter";

interface TeamFilterProps {
  data: CollaborationData[];
  selected: Set<string>;
  onFilterChange: (selected: Set<string>) => void;
}

export default function TeamFilter({
  data,
  selected,
  onFilterChange,
}: TeamFilterProps) {
  const options: MultiSelectFilterOption[] = useMemo(() => {
    const teamMap = new Map<string, string>();
    data.forEach((d) => teamMap.set(d.team_id, d.team));
    return Array.from(teamMap.entries())
      .map(([id, name]) => ({ value: id, label: `${id} · ${name}` }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [data]);

  return (
    <MultiSelectFilter
      title="Teams"
      options={options}
      selected={selected}
      onFilterChange={onFilterChange}
    />
  );
}
