/**
 * Normalize payload_json from DB: Prisma returns object; legacy rows may be JSON string.
 */
export function parsePayloadJson(payloadJson: unknown): Record<string, unknown> | null {
  if (payloadJson == null) return null;
  if (typeof payloadJson === "object" && payloadJson !== null && !Array.isArray(payloadJson)) {
    return payloadJson as Record<string, unknown>;
  }
  if (typeof payloadJson === "string") {
    try {
      const p = JSON.parse(payloadJson);
      return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Normalize payload.files to string[] (Excel may store string or array). */
export function normalizePayloadFiles(files: unknown): string[] {
  if (Array.isArray(files)) {
    return files.map((f) => (typeof f === "string" ? f.trim() : String(f))).filter(Boolean);
  }
  if (typeof files === "string" && files.trim()) {
    return files.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
