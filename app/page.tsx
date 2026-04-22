"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import ArcDiagram, { LinkClickEvent, BehaviorClickEvent } from "@/components/ArcDiagram";
import { FrontendTools } from "@/components/copilotkit";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import TeamFilter from "@/components/TeamFilter";
import SourceFilter from "@/components/SourceFilter";
import EventDrawer from "@/components/EventDrawer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BEHAVIOR_ORDER, BEHAVIOR_COLORS } from "@/lib/dataProcessor";
import { CollaborationData, DrilldownFilters, ProjectContext, StageInfo } from "@/lib/types";
import { totalDaysInRange } from "@/lib/dayLabel";
import { buildSelectedScope } from "@/lib/selectedScope";

export default function Home() {
  const [data, setData] = useState<CollaborationData[]>([]);
  const [dataRange, setDataRange] = useState<[Date, Date] | null>(null);
  const [selectedRange, setSelectedRange] = useState<[Date, Date] | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [showNames, setShowNames] = useState(true);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Drill-down drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drilldownFilters, setDrilldownFilters] = useState<DrilldownFilters>({});

  // Compute filtered data based on date range and selected teams/sources
  // If any filter is cleared (empty), show no data
  const filteredData = useMemo(() => {
    if (!selectedRange) return data;
    if (selectedTeams.size === 0 || selectedSources.size === 0) return [];

    return data.filter((d) => {
      const date = new Date(d.date);
      const inDateRange = date >= selectedRange[0] && date <= selectedRange[1];
      const inTeamFilter = selectedTeams.has(d.team_id);
      const inSourceFilter = selectedSources.has(d.source);
      return inDateRange && inTeamFilter && inSourceFilter;
    });
  }, [data, selectedRange, selectedTeams, selectedSources]);

  // Data filtered by team & source only (NOT by day range).
  // Used by the behavior trend mini-chart so its x-axis can stay anchored to
  // the full Day 1..Day N range while the day filter only moves marker lines.
  const trendChartData = useMemo(() => {
    if (selectedTeams.size === 0 || selectedSources.size === 0) return [];
    return data.filter(
      (d) => selectedTeams.has(d.team_id) && selectedSources.has(d.source)
    );
  }, [data, selectedTeams, selectedSources]);

  // Derive project context once data is loaded (sources, teams, members, behaviors)
  const projectContext = useMemo((): ProjectContext | undefined => {
    if (data.length === 0) return undefined;
    const sources = Array.from(new Set(data.map((d) => d.source))).sort();
    const teamMap = new Map<string, string>();
    data.forEach((d) => teamMap.set(d.team_id, d.team));
    const teams = Array.from(teamMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const memberMap = new Map<string, string>();
    data.forEach((d) => {
      memberMap.set(d.from_id, d.from);
      memberMap.set(d.to_id, d.to);
    });
    const members = Array.from(memberMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      sources, teams, members, behaviors: [...BEHAVIOR_ORDER],
      dataRange: dataRange
        ? { totalDays: totalDaysInRange(dataRange[0].toISOString(), dataRange[1].toISOString()) }
        : undefined,
      stages: stages.length > 0 ? stages : undefined,
    };
  }, [data, dataRange, stages]);

  const dataMinDate = dataRange?.[0]?.toISOString();

  const selectedScope = useMemo(
    () => buildSelectedScope({ data, selectedSources, selectedTeams, selectedRange, dataMinDate }),
    [data, selectedSources, selectedTeams, selectedRange, dataMinDate]
  );

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
        const [interactionsRes, stagesRes] = await Promise.all([
          fetch("/api/interactions?dataset=default"),
          fetch("/api/stages?dataset=default"),
        ]);
        if (!interactionsRes.ok) throw new Error("Failed to load interactions from DB");
        const json = (await interactionsRes.json()) as { data?: CollaborationData[] };
        const parsed = Array.isArray(json.data) ? json.data : [];
        handleDataLoaded(parsed);

        if (stagesRes.ok) {
          const stagesJson = (await stagesRes.json()) as { stages?: StageInfo[] };
          setStages(stagesJson.stages ?? []);
        }
      } catch (err) {
        setError("Failed to load data from local DB. Import data first, or check DB config.");
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

  // Build current drilldown filters from selected state
  const buildDrilldownFilters = useCallback(
    (extra: Partial<DrilldownFilters> = {}): DrilldownFilters => ({
      sources: selectedSources.size > 0 ? Array.from(selectedSources) : undefined,
      teams: selectedTeams.size > 0 ? Array.from(selectedTeams) : undefined,
      start: selectedRange?.[0]?.toISOString(),
      end: selectedRange?.[1]?.toISOString(),
      ...extra,
    }),
    [selectedSources, selectedTeams, selectedRange]
  );

  const handleLinkClick = useCallback(
    (event: LinkClickEvent) => {
      setDrilldownFilters(
        buildDrilldownFilters({
          behavior: event.behavior,
          from_id: event.fromId,
          to_id: event.toId,
          from: event.fromName,
          to: event.toName,
        })
      );
      setDrawerOpen(true);
    },
    [buildDrilldownFilters]
  );

  const handleBehaviorDrilldown = useCallback(
    (event: BehaviorClickEvent) => {
      setDrilldownFilters(
        buildDrilldownFilters({
          behavior: event.behavior,
        })
      );
      setDrawerOpen(true);
    },
    [buildDrilldownFilters]
  );

  const handleOpenDrilldown = useCallback(
    (args: { from_id: string; to_id: string }) => {
      setDrilldownFilters(
        buildDrilldownFilters({
          from_id: args.from_id,
          to_id: args.to_id,
        })
      );
      setDrawerOpen(true);
    },
    [buildDrilldownFilters]
  );

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
                    chartData={trendChartData}
                    behaviors={BEHAVIOR_ORDER}
                    behaviorColors={BEHAVIOR_COLORS}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <TeamFilter
                    data={data}
                    selected={selectedTeams}
                    onFilterChange={handleTeamFilterChange}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <SourceFilter
                    data={data}
                    selected={selectedSources}
                    onFilterChange={handleSourceFilterChange}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm font-medium mb-2">Display Label</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={showNames ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setShowNames(true)}
                    >
                      Name
                    </Button>
                    <Button
                      type="button"
                      variant={!showNames ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setShowNames(false)}
                    >
                      ID Only
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </aside>

            <Card className="h-full min-w-0">
              <CardContent className="pt-6">
                <ArcDiagram
                  data={filteredData}
                  showNames={showNames}
                  onLinkClick={handleLinkClick}
                  onBehaviorDrilldown={handleBehaviorDrilldown}
                  eventDrawerOpen={drawerOpen}
                />
              </CardContent>
            </Card>
          </div>
        )}

        <EventDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          filters={drilldownFilters}
          showNames={showNames}
          datasetName="default"
          dataMinDate={dataMinDate}
        />

        <FrontendTools
          projectContext={projectContext}
          selectedScope={selectedScope}
          onOpenDrilldown={handleOpenDrilldown}
          dataMinDate={dataMinDate}
        />
      </div>
    </div>
  );
}
