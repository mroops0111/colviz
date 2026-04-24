import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  type ParsedEvent,
  type ParsedReport,
  type ReportEvent,
  tryParseJson,
} from "@/lib/report";

/**
 * POST /api/save-report
 *
 * Persists a CopilotKit chat session as a markdown report mimicking the
 * format produced by experiment/runner.py. The report is a flat sequence of
 * events (user prompts, tool calls, assistant answers); each call rewrites
 * the file with the full conversation so far so re-saves don't duplicate.
 *
 * Files are written to <repo>/data/reports/<threadId>.md.
 */

const REPORTS_DIR = path.join(process.cwd(), "data", "reports");

// Section header sentinels. They are intentionally specific (number prefix +
// fixed role keyword) so user/assistant content containing arbitrary "## …"
// headings won't accidentally be parsed as a section boundary.
const SECTION_HEADER_RE = /^## (\d+)\. (User Prompt|Assistant Answer|Tool Call:.*)$/;
const SYSTEM_HEADER = "## System Prompt";

interface SaveReportBody {
  threadId: string;
  systemPrompt: string;
  events: ReportEvent[];
}

function isSafeThreadId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && id.length > 0 && id.length <= 128;
}

function jsonFence(content: unknown): string {
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/** Pull `args.answer` if `ev` is a saveAnalysisReport call carrying markdown. */
function saveReportAnswer(ev: Extract<ReportEvent, { kind: "toolCall" }>): string | null {
  if (ev.name !== "saveAnalysisReport") return null;
  const a = ev.args as { answer?: unknown } | null | undefined;
  return typeof a?.answer === "string" ? a.answer : null;
}

function renderEvent(ev: ReportEvent, index: number): string {
  const num = index + 1;
  const lines: string[] = [];

  if (ev.kind === "user") {
    lines.push(`## ${num}. User Prompt`, "", ev.content.trim() || "_(empty)_");
  } else if (ev.kind === "assistant") {
    lines.push(
      `## ${num}. Assistant Answer`,
      "",
      ev.content.trim() || "_(no answer captured)_"
    );
  } else {
    lines.push(`## ${num}. Tool Call: \`${ev.name}\``, "");
    // saveAnalysisReport's only arg is a long markdown answer; rendering it
    // inside a ```json``` fence would JSON-escape it (\n etc.) and become
    // unreadable. Render as raw markdown under an **Answer:** label instead.
    const answer = saveReportAnswer(ev);
    if (answer != null) {
      lines.push("**Answer:**", "", answer.trim());
    } else {
      lines.push("**Args:**", "", "```json", jsonFence(ev.args), "```");
      if (ev.result !== undefined) {
        lines.push("", "**Result:**", "", "```json", jsonFence(ev.result), "```");
      }
    }
  }

  lines.push("", "---", "");
  return lines.join("\n");
}

function renderReport(body: SaveReportBody): string {
  const out: string[] = [
    `# Report ${body.threadId}`,
    "",
    `**Thread ID:** \`${body.threadId}\`  `,
    `**Last Updated:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
    SYSTEM_HEADER,
    "",
    body.systemPrompt.trim(),
    "",
    "---",
    "",
  ];
  body.events.forEach((ev, i) => out.push(renderEvent(ev, i)));
  return out.join("\n");
}

function isReportEvent(v: unknown): v is ReportEvent {
  if (!v || typeof v !== "object") return false;
  const ev = v as { kind?: string; content?: unknown; name?: unknown };
  if (ev.kind === "user" || ev.kind === "assistant") return typeof ev.content === "string";
  if (ev.kind === "toolCall") return typeof ev.name === "string";
  return false;
}

export async function POST(req: NextRequest) {
  let body: SaveReportBody;
  try {
    body = (await req.json()) as SaveReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.threadId || !isSafeThreadId(body.threadId)) {
    return NextResponse.json(
      { error: "Missing or invalid threadId" },
      { status: 400 }
    );
  }
  if (typeof body.systemPrompt !== "string") {
    return NextResponse.json(
      { error: "systemPrompt must be a string" },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.events) || !body.events.every(isReportEvent)) {
    return NextResponse.json(
      { error: "events must be an array of ReportEvent" },
      { status: 400 }
    );
  }

  const md = renderReport(body);
  const filePath = path.join(REPORTS_DIR, `${body.threadId}.md`);

  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    await fs.writeFile(filePath, md, "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to write report: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    path: path.relative(process.cwd(), filePath),
    bytes: Buffer.byteLength(md, "utf-8"),
    eventCount: body.events.length,
  });
}

/**
 * Lightweight markdown parser for the report format we write above. We can
 * rely on the strict header pattern in {@link SECTION_HEADER_RE} so body
 * content containing arbitrary "## …" headings won't be misread as a
 * section boundary.
 */
function parseReportSections(md: string): ParsedReport {
  const lines = md.split(/\r?\n/);
  const result: ParsedReport = { systemPrompt: "", events: [] };

  // Find all section starts in one pass; the body of each section is
  // everything from start+1 up to the next section start.
  const starts: { lineIdx: number; header: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SYSTEM_HEADER || SECTION_HEADER_RE.test(lines[i])) {
      starts.push({ lineIdx: i, header: lines[i] });
    }
  }

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1].lineIdx : lines.length;
    const body = trimSeparators(lines.slice(start.lineIdx + 1, end).join("\n"));

    if (start.header === SYSTEM_HEADER) {
      result.systemPrompt = body;
      continue;
    }

    const m = start.header.match(SECTION_HEADER_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    const kindPart = m[2];

    if (kindPart === "User Prompt") {
      result.events.push({ index: idx, kind: "user", content: body });
    } else if (kindPart === "Assistant Answer") {
      result.events.push({ index: idx, kind: "assistant", content: body });
    } else if (kindPart.startsWith("Tool Call:")) {
      const nameMatch = kindPart.match(/^Tool Call:\s*`([^`]+)`/);
      const name = nameMatch ? nameMatch[1] : "(unknown)";
      // saveAnalysisReport sections store the answer under **Answer:**
      // (raw markdown); recover it back into args.answer.
      const answerBlock =
        name === "saveAnalysisReport" ? extractAnswerBlock(body) : null;
      if (answerBlock != null) {
        result.events.push({
          index: idx,
          kind: "toolCall",
          name,
          args: { answer: answerBlock },
        });
      } else {
        const { args, result: toolResult } = extractArgsAndResult(body);
        result.events.push({
          index: idx,
          kind: "toolCall",
          name,
          args,
          result: toolResult,
        });
      }
    }
  }

  return result;
}

/**
 * Pull the trimmed body of an "**Answer:**" block out of a tool-call section.
 *
 * NOTE: do NOT use the `m` flag here. With multiline mode `$` matches end of
 * *line*, which combined with a non-greedy `*?` would shrink the capture to
 * the first line of the answer — silently truncating long markdown reports.
 * Section bodies are pre-trimmed by `trimSeparators`, so a plain greedy
 * capture to end-of-string is correct.
 */
function extractAnswerBlock(body: string): string | null {
  const m = body.match(/\*\*Answer:\*\*\s*\n+([\s\S]*)/);
  return m ? m[1].trim() : null;
}

/** Pull out the **Args:** / **Result:** ```json blocks from a tool-call section body. */
function extractArgsAndResult(body: string): { args: unknown; result: unknown } {
  const grab = (label: string): unknown => {
    const re = new RegExp(
      `\\*\\*${label}:\\*\\*\\s*\\n+\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``,
      "m"
    );
    const m = body.match(re);
    return m ? tryParseJson(m[1]) : undefined;
  };
  return { args: grab("Args"), result: grab("Result") };
}

/** Strip surrounding blank lines and the trailing `---` divider we add between sections. */
function trimSeparators(s: string): string {
  return s
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n*^---\s*$\n*/m, "")
    .trim();
}

/**
 * GET /api/save-report?file=<basename>
 *
 * Read a previously-saved report by basename. Strict basename validation
 * prevents path traversal: the resolved path MUST stay inside REPORTS_DIR.
 */
export async function GET(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get("file") ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}\.md$/.test(fileParam)) {
    return NextResponse.json({ error: "Invalid file parameter" }, { status: 400 });
  }
  const filePath = path.join(REPORTS_DIR, fileParam);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(REPORTS_DIR) + path.sep)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }
  try {
    const content = await fs.readFile(resolved, "utf-8");
    return NextResponse.json({
      file: fileParam,
      path: path.relative(process.cwd(), resolved),
      content,
      sections: parseReportSections(content),
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Failed to read report: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
