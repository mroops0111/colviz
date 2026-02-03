/**
 * Shared helpers for API routes (query parsing, etc.)
 */

export function parseCsvList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Prefer single value; if absent, parse comma-separated list. Used for team/source (singular) or teams/sources (plural). */
export function parseSingleOrCsvList(
  single: string | null | undefined,
  csv: string | null | undefined
): string[] {
  const s = single?.trim();
  if (s) return [s];
  return parseCsvList(csv ?? null);
}

export function parseOptionalDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
