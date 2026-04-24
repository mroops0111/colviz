import type { CollaborationData, SelectedScope } from "./types";
import { dateToDayNumber } from "./dayLabel";

/**
 * Build the anonymized scope object exposed to Copilot via useCopilotReadable.
 *
 * Only IDs are emitted (never real names). Contents follow the user's current
 * UI selection so the AI sees exactly what the user sees. Members per team
 * are derived from intra-team rows only — inter-team rows mix members from
 * different teams into the same row.
 */
export function buildSelectedScope(args: {
  data: CollaborationData[];
  selectedSources: Set<string>;
  selectedTeams: Set<string>;
  selectedRange: [Date, Date] | null;
  dataMinDate: string | undefined;
}): SelectedScope | undefined {
  const { data, selectedSources, selectedTeams, selectedRange, dataMinDate } = args;
  if (data.length === 0) return undefined;

  const sources = Array.from(selectedSources).sort();
  const teams = Array.from(selectedTeams).sort();

  const buckets: Record<string, Set<string>> = {};
  for (const t of teams) buckets[t] = new Set();
  for (const d of data) {
    if (d.scope !== "intra") continue;
    const bucket = buckets[d.team_id];
    if (!bucket) continue;
    bucket.add(d.from_id);
    bucket.add(d.to_id);
  }
  const teamMembers: Record<string, string[]> = Object.fromEntries(
    Object.entries(buckets).map(([t, ids]) => [t, Array.from(ids).sort()])
  );

  const dayRange =
    selectedRange && dataMinDate
      ? {
          start: dateToDayNumber(selectedRange[0].toISOString(), dataMinDate),
          end: dateToDayNumber(selectedRange[1].toISOString(), dataMinDate),
        }
      : undefined;

  return { sources, teams, teamMembers, dayRange };
}
