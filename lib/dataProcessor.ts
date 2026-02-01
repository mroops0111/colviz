import { CollaborationData, ArcLink, BehaviorGroup } from "./types";

// Order used by filter buttons and arc diagram outer ring (awareness → sharing → coordination → improving)
export const BEHAVIOR_ORDER = ["awareness", "sharing", "coordination", "improving"] as const;

export const BEHAVIOR_COLORS: Record<string, string> = {
  awareness: "#9B59B6",
  sharing: "#50C878",
  coordination: "#4A90E2",
  improving: "#F5A623",
};

/** Ordered list of behaviors for filter buttons (BEHAVIOR_ORDER first, then any extra from BEHAVIOR_COLORS) */
const orderSet = new Set<string>(BEHAVIOR_ORDER);
export const BEHAVIOR_BUTTON_LIST: string[] = [
  ...BEHAVIOR_ORDER.filter((b) => b in BEHAVIOR_COLORS),
  ...Object.keys(BEHAVIOR_COLORS).filter((b) => !orderSet.has(b)),
];

/**
 * Process collaboration data into behavior groups with aggregated links
 * @param data - Array of collaboration data records
 * @returns Array of behavior groups with their associated links
 */
export function processCollaborationData(data: CollaborationData[]): BehaviorGroup[] {
  // Group by behavior type
  const behaviorMap = new Map<string, Map<string, ArcLink>>();

  data.forEach((row) => {
    if (!behaviorMap.has(row.behavior)) {
      behaviorMap.set(row.behavior, new Map());
    }

    const weight = typeof row.weight === "number" && Number.isFinite(row.weight) ? row.weight : 1;
    const linkKey = `${row.from_id}-${row.to_id}`;
    const links = behaviorMap.get(row.behavior)!;

    if (links.has(linkKey)) {
      // Increment count for existing link
      const link = links.get(linkKey)!;
      link.count += weight;
    } else {
      // Create new link
      links.set(linkKey, {
        source: row.from_id,
        target: row.to_id,
        behavior: row.behavior,
        count: weight,
      });
    }
  });

  // Convert map to array format
  const behaviorGroups: BehaviorGroup[] = [];
  behaviorMap.forEach((links, behavior) => {
    behaviorGroups.push({
      behavior,
      links: Array.from(links.values()),
      color: BEHAVIOR_COLORS[behavior] || "#999999",
    });
  });

  return behaviorGroups;
}

/**
 * Extract all unique node IDs from collaboration data
 * @param data - Array of collaboration data records
 * @returns Set of unique node IDs
 */
export function getAllNodes(data: CollaborationData[]): Set<string> {
  const nodes = new Set<string>();
  data.forEach((row) => {
    nodes.add(row.from_id);
    nodes.add(row.to_id);
  });
  return nodes;
}
