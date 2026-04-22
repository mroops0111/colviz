export interface CollaborationData {
  datetime: string;
  date: string;
  source: string;
  scope: string;
  team_id: string;
  team: string;
  behavior: string;
  from_id: string;
  from: string;
  to_id: string;
  to: string;
  weight?: number;
}

export interface ArcLink {
  source: string;
  target: string;
  behavior: string;
  count: number;
}

export interface BehaviorGroup {
  behavior: string;
  links: ArcLink[];
  color: string;
}

/** Stage definition derived from DB stage actors + interaction date ranges */
export interface StageInfo {
  key: string;
  name: string;
  startDay: number;
  endDay: number;
}

/** Full dataset context — used internally for name→id mapping when post-processing tool results. NOT sent to the LLM. */
export interface ProjectContext {
  sources: string[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
  behaviors: string[];
  dataRange?: { totalDays: number };
  stages?: StageInfo[];
}

/**
 * The user's current filter selection in the UI.
 *
 * This is what gets sent to the LLM via useCopilotReadable. All values are
 * anonymized (IDs only, no real names) and reflect exactly what the user is
 * looking at — not the full dataset. Tool validators also enforce that any
 * tool call stays within this scope.
 */
export interface SelectedScope {
  /** Selected data sources (e.g. ["gitlab", "mattermost"]). */
  sources: string[];
  /** Selected team IDs, including virtual stage teams (S1/S2/S3). */
  teams: string[];
  /** teamId → list of member IDs that participate in this team (intra-team rows). */
  teamMembers: Record<string, string[]>;
  /** Selected day range in Day-N units (Day 1 = dataset min date). */
  dayRange?: { start: number; end: number };
}

/** Drilldown / EventDrawer filter params (query and API) */
export interface DrilldownFilters {
  behavior?: string;
  from_id?: string;
  to_id?: string;
  from?: string;
  to?: string;
  sources?: string[];
  teams?: string[];
  start?: string;
  end?: string;
}

/** Raw item as returned by drilldown API (linked to event) */
export interface DrilldownRawItem {
  id: string;
  sourceItemType: string;
  sourceItemId: string;
  title: string | null;
  content: string;
  contentFormat: string;
  payload: Record<string, unknown> | null;
}

/** Event record as returned by drilldown API */
export interface DrilldownEventRecord {
  id: string;
  datetime: string;
  date: string;
  source: string;
  scope: string;
  team_id: string;
  team: string;
  behavior: string;
  from_id: string;
  from: string;
  to_id: string;
  to: string;
  weight: number;
  rawItem: DrilldownRawItem | null;
}
