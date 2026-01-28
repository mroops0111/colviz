"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import * as d3 from "d3";
import ArcDiagram from "@/components/ArcDiagram";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import TeamFilter from "@/components/TeamFilter";
import SourceFilter from "@/components/SourceFilter";
import { Card, CardContent } from "@/components/ui/card";
import { CollaborationData } from "@/lib/types";

export default function Home() {
  const [data, setData] = useState<CollaborationData[]>([]);
  const [dataRange, setDataRange] = useState<[Date, Date] | null>(null);
  const [selectedRange, setSelectedRange] = useState<[Date, Date] | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Compute filtered data based on date range and selected teams
  const filteredData = useMemo(() => {
    if (!selectedRange) return data;

    return data.filter((d) => {
      const date = new Date(d.date);
      const inDateRange =
        date >= selectedRange[0] && date <= selectedRange[1];
      const inTeamFilter =
        selectedTeams.size > 0 && selectedTeams.has(d.team_id);
      const inSourceFilter =
        selectedSources.size > 0 && selectedSources.has(d.source);
      return inDateRange && inTeamFilter && inSourceFilter;
    });
  }, [data, selectedRange, selectedTeams, selectedSources]);

  const handleDataLoaded = useCallback((loadedData: CollaborationData[]) => {
    setData(loadedData);

    // Set initial date range
    if (loadedData.length > 0) {
      const dates = loadedData.map((d) => new Date(d.date));
      const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
      const fullRange: [Date, Date] = [minDate, maxDate];
      setDataRange(fullRange);
      setSelectedRange(fullRange);

      // Initialize selected teams
      const teams = new Set(loadedData.map((d) => d.team_id));
      setSelectedTeams(teams);

      // Initialize selected sources
      const sources = new Set(loadedData.map((d) => d.source));
      setSelectedSources(sources);
    }
  }, []);

  useEffect(() => {
    const loadSampleData = async () => {
      setError(null);

      try {
        const rows = await d3.csv("/sample/data.csv");
        const parsed = rows.map((row) => ({
          datetime: row.datetime ?? "",
          date: row.date ?? "",
          source: row.source ?? "",
          stage: row.stage ?? "",
          scope: row.scope ?? "",
          team_id: row.team_id ?? "",
          team: row.team ?? "",
          behavior: row.behavior ?? "",
          from_id: row.from_id ?? "",
          from: row.from ?? "",
          to_id: row.to_id ?? "",
          to: row.to ?? "",
        }));
        handleDataLoaded(parsed);
      } catch (err) {
        setError("Failed to load sample data");
      }
    };

    loadSampleData();
  }, [handleDataLoaded]);

  const handleDateRangeChange = useCallback((start: Date, end: Date) => {
    setSelectedRange([start, end]);
  }, []);

  const handleTeamFilterChange = useCallback((teams: Set<string>) => {
    setSelectedTeams(teams);
  }, []);

  const handleSourceFilterChange = useCallback((sources: Set<string>) => {
    setSelectedSources(sources);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/50">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            ColViz
          </h1>
          <p className="text-muted-foreground">
            Collaboration Behavior Visualization Tool
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {data.length > 0 && dataRange && selectedRange && (
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <Card>
                <CardContent className="pt-5">
                  <TimeRangeFilter
                    minDate={dataRange[0]}
                    maxDate={dataRange[1]}
                    startDate={selectedRange[0]}
                    endDate={selectedRange[1]}
                    onRangeChange={handleDateRangeChange}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <TeamFilter
                    data={data}
                    onFilterChange={handleTeamFilterChange}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <SourceFilter
                    data={data}
                    onFilterChange={handleSourceFilterChange}
                  />
                </CardContent>
              </Card>
            </aside>

            <Card className="h-full">
              <CardContent className="pt-6">
                <div className="flex justify-center">
                  <ArcDiagram data={filteredData} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
