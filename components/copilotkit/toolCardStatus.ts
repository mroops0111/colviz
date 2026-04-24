import type { ToolStatus } from "./ToolExecutionCard";

function toCardStatus(status: string): ToolStatus {
  return status === "complete"
    ? "complete"
    : status === "executing"
      ? "executing"
      : "inProgress";
}

/**
 * Resolve tool card status and hint label from the raw tool status + result.
 * A completed tool whose result has an `error` field is rendered as failed.
 */
export function resolveCardStatusAndHint(
  status: string,
  result: unknown
): { cardStatus: ToolStatus; hint: string } {
  const base = toCardStatus(status);
  if (base !== "complete") {
    return { cardStatus: base, hint: "Running…" };
  }
  let hasError = false;
  if (result != null) {
    try {
      const data = typeof result === "string" ? JSON.parse(result) : result;
      hasError = typeof (data as { error?: string })?.error === "string";
    } catch {
      // ignore parse errors — non-JSON result counts as success
    }
  }
  return hasError
    ? { cardStatus: "error", hint: "Failed" }
    : { cardStatus: "complete", hint: "Done" };
}
