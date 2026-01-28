import { CollaborationData, ArcLink, BehaviorGroup } from "./types";

export const BEHAVIOR_COLORS: Record<string, string> = {
  coordination: "#4A90E2",
  sharing: "#50C878",
  collaboration: "#F5A623",
  awareness: "#9B59B6",
};

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

    const linkKey = `${row.from_id}-${row.to_id}`;
    const links = behaviorMap.get(row.behavior)!;

    if (links.has(linkKey)) {
      // Increment count for existing link
      const link = links.get(linkKey)!;
      link.count++;
    } else {
      // Create new link
      links.set(linkKey, {
        source: row.from_id,
        target: row.to_id,
        behavior: row.behavior,
        count: 1,
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
