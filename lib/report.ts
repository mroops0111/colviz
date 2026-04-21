/**
 * Shared types and helpers for the saved-analysis report format.
 *
 * The report represents a chat session as a flat, chronological sequence of
 * events (no "turn" grouping). Both the API route that writes/reads the file
 * and the frontend component that renders the preview agree on these shapes.
 */

/** Event written to the report file (POST /api/save-report). */
export type ReportEvent =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "toolCall"; name: string; args: unknown; result?: unknown };

/** Event parsed back out of the report file (GET /api/save-report). */
export type ParsedEvent =
  | { index: number; kind: "user"; content: string }
  | { index: number; kind: "assistant"; content: string }
  | {
      index: number;
      kind: "toolCall";
      name: string;
      args?: unknown;
      result?: unknown;
    };

export interface ParsedReport {
  systemPrompt: string;
  events: ParsedEvent[];
}

/** Parse a JSON string; return the original string on parse failure. */
export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
