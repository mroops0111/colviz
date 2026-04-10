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

/** Context exposed to Copilot via useCopilotReadable for tool parameter validation and hints */
export interface ProjectContext {
  sources: string[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
  behaviors: string[];
  dataRange?: { totalDays: number };
  stages?: StageInfo[];
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
