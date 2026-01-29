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
