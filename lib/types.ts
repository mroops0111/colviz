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
