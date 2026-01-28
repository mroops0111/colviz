"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CollaborationData } from "@/lib/types";

interface TeamFilterProps {
  data: CollaborationData[];
  onFilterChange: (selectedTeams: Set<string>) => void;
}

export default function TeamFilter({
  data,
  onFilterChange,
}: TeamFilterProps) {
  // Extract unique teams from data
  const teams = Array.from(new Set(data.map((d) => d.team_id))).sort();
  
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    new Set(teams)
  );

  useEffect(() => {
    // Reset selected teams when data changes
    const newTeams = Array.from(new Set(data.map((d) => d.team_id))).sort();
    const newTeamsSet = new Set(newTeams);
    setSelectedTeams(newTeamsSet);
    // Don't call onFilterChange here to avoid infinite loop
    // The parent will handle initial state
  }, [data]);

  const handleTeamToggle = (teamId: string) => {
    const newSelected = new Set(selectedTeams);
    if (newSelected.has(teamId)) {
      newSelected.delete(teamId);
    } else {
      newSelected.add(teamId);
    }
    setSelectedTeams(newSelected);
    onFilterChange(newSelected);
  };

  const handleSelectAll = () => {
    const allTeams = new Set(teams);
    setSelectedTeams(allTeams);
    onFilterChange(allTeams);
  };

  const handleDeselectAll = () => {
    const emptySet = new Set<string>();
    setSelectedTeams(emptySet);
    onFilterChange(emptySet);
  };

  const isAllSelected = selectedTeams.size === teams.length;
  const isNoneSelected = selectedTeams.size === 0;

  // Get team name from first occurrence in data
  const getTeamName = (teamId: string): string => {
    const record = data.find((d) => d.team_id === teamId);
    return record?.team || teamId;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold">Teams</h2>
          <p className="text-xs text-muted-foreground">
            {selectedTeams.size} / {teams.length} selected
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
        {teams.map((teamId) => (
          <div key={teamId} className="flex items-center space-x-2">
            <Checkbox
              id={`team-${teamId}`}
              checked={selectedTeams.has(teamId)}
              onCheckedChange={() => handleTeamToggle(teamId)}
            />
            <Label
              htmlFor={`team-${teamId}`}
              className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {getTeamName(teamId)}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
