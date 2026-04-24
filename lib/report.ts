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

/** Return the end index (inclusive) of the first brace-balanced JSON value
 * starting at position 0, or -1 if the input isn't a JSON object/array or is
 * truncated. String escapes are respected so braces inside strings don't
 * confuse depth tracking. */
function firstJsonValueEnd(s: string): number {
  const open = s[0];
  if (open !== "{" && open !== "[") return -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse a JSON string; return the original string on parse failure.
 *
 * Tolerates a CopilotKit streaming quirk where `toolCall.function.arguments`
 * is occasionally delivered as two concatenated copies of the final JSON
 * (e.g. `{...}{...}`). When a full JSON.parse fails we fall back to parsing
 * just the first brace-balanced prefix so the tool-call args render as a
 * proper object instead of an opaque escaped string. */
export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const end = firstJsonValueEnd(s);
    if (end > 0) {
      try {
        return JSON.parse(s.slice(0, end + 1));
      } catch {
        // fall through
      }
    }
    return s;
  }
}
