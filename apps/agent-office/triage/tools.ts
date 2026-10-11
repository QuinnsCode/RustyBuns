// The office's self-triage tools, the same for a worker's MCP server (mcp.ts) and an agent in the
// browser (index.ts, WebMCP): read memory and its history, take a CPU profile, read one back as its
// hottest frames, list heap snapshots. Each answers in text an agent can read; a profile or a snapshot
// itself stays a file on the office's machine, since it's far too big to put in context.
import { formatProfileSummary, type ProfileSummary, type SavedFile } from "@rustybuns/shell-bun/profsummary";
import { formatMemStats, type MemStats } from "@rustybuns/shell-bun/memwatch";
import { formatHistory, type Run } from "@rustybuns/shell-bun/history";
import type { OfficeMem } from "../live/mem.ts";

/** One call to the office's /__rb routes: the status and the JSON it answered. */
export type TriageCall = (method: "GET" | "POST", path: string) => Promise<{ status: number; body: any }>;

const TOP = { type: "integer", minimum: 1, maximum: 50, description: "How many frames to list by self and by total time (default 10)." };

export const TRIAGE_TOOLS = [
  {
    name: "mem_stats",
    title: "Office memory",
    description:
      "Memory of this Agent Office and each floor's pty host: RSS and JS heap now, the peak, and the RSS growth over the last hour in MB/h. " +
      "A steady positive slope over hours is a leak; with a ceiling set (AGENT_OFFICE_MEM_MAX_MB), hoursToMax says how long until that process restarts itself. " +
      "Samples come every 5 minutes, so the slope needs 15 minutes of uptime first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "take_cpu_profile",
    title: "Profile the office",
    description:
      "Samples the office server's CPU for some seconds and answers with its hottest functions (by self and total time, with the stack under each) and the saved .cpuprofile's path, " +
      "which opens as a flame graph in Chrome DevTools > Performance or speedscope.app. One profile at a time, 60 seconds at most. " +
      "Take one while the slowness is happening; a quiet office shows mostly idle.",
    inputSchema: {
      type: "object",
      properties: { seconds: { type: "integer", minimum: 1, maximum: 60, description: "How long to sample (default 10)." }, top: TOP },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "list_profiles",
    title: "List CPU profiles",
    description: "The office's saved CPU profiles, newest first (the newest 10 are kept): each one's id, when it was taken and its path. read_profile reads one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "read_profile",
    title: "Read a CPU profile",
    description: "A saved CPU profile's hottest functions, by self and by total time, with the stack under each. Compare two (before and after a change) to see what moved.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The profile's id, as list_profiles shows it. Default: the newest." }, top: TOP },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "mem_history",
    title: "Office history",
    description:
      "The office's runs, one per start, newest first, kept across restarts and updates: each run's RSS from start to now with its MB/h slope, " +
      "the CPU profiles taken in it with their hottest functions, and whether it went over its memory ceiling and restarted. " +
      "Compare this run with the one before to see what a change did.",
    inputSchema: {
      type: "object",
      properties: { runs: { type: "integer", minimum: 1, maximum: 50, description: "How many runs to show (default 5)." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "heap_snapshots",
    title: "List heap snapshots",
    description:
      "The V8 heap snapshots the office and each floor's pty host wrote when they went over their memory ceiling, newest first, with their paths. " +
      "Open one in Chrome DevTools > Memory (Load), or load two and compare, to see what filled the heap.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

export const TRIAGE_READ_ONLY = TRIAGE_TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);

export const TRIAGE_NOTE =
  " When the office itself is slow or growing (yours to look into, or asked about), mem_stats, mem_history, take_cpu_profile, list_profiles, read_profile and heap_snapshots " +
  "read its memory and profile it; file what you find with the numbers.";

export const formatMem = (name: string, m: MemStats): string => `${name}: ${formatMemStats(m)}`;

const files = (list: SavedFile[]) => list.map((f) => `  ${f.id}  ${f.at}  ${(f.bytes / 1e6).toFixed(1)} MB  ${f.file}`);

function formatProfile(a: { id: string; file: string; seconds?: number; summary: ProfileSummary }) {
  return `${a.id}${a.seconds ? ` (sampled ${a.seconds}s; times are of the JS thread's busy time)` : ""}\n${formatProfileSummary(a.summary)}\n\nflame graph: open ${a.file} in Chrome DevTools > Performance, or on https://www.speedscope.app`;
}

const query = (args: Record<string, unknown>) => (Number.isInteger(args.top) ? `?top=${args.top}` : "");

/** Runs one tool through `call`; resolves to its text, or throws with why it failed. */
export async function runTriageTool(name: string, args: Record<string, unknown> | undefined, call: TriageCall): Promise<string> {
  const a = args ?? {};
  const ask = async (method: "GET" | "POST", path: string) => {
    const r = await call(method, path);
    if (r.status < 200 || r.status >= 300) throw new Error(r.body?.error ?? `The office answered ${r.status}`);
    return r.body;
  };
  if (name === "mem_stats") {
    const m: OfficeMem = await ask("GET", "/__rb/mem");
    return [formatMem("office", m.office), ...m.ptyHosts.map((h) => h.mem ? formatMem(`pty host (floor ${h.floor}, pid ${h.mem.pid})`, h.mem) : `pty host (floor ${h.floor}): no sample yet, or not running`)].join("\n");
  }
  if (name === "take_cpu_profile") {
    const s = Number.isInteger(a.seconds) ? Number(a.seconds) : 10;
    return formatProfile(await ask("POST", `/__rb/prof?s=${s}${Number.isInteger(a.top) ? `&top=${a.top}` : ""}`));
  }
  if (name === "list_profiles") {
    const { profiles, running } = await ask("GET", "/__rb/prof");
    const head = `${profiles.length} CPU profile${profiles.length === 1 ? "" : "s"}${running ? " · one is being taken now" : ""}`;
    return [head, ...files(profiles)].join("\n");
  }
  if (name === "read_profile") {
    let id = typeof a.id === "string" ? a.id.trim() : "";
    if (!id) {
      id = (await ask("GET", "/__rb/prof")).profiles[0]?.id ?? "";
      if (!id) throw new Error("No CPU profiles yet: take_cpu_profile takes one");
    }
    return formatProfile(await ask("GET", `/__rb/prof/${encodeURIComponent(id)}${query(a)}`));
  }
  if (name === "mem_history") {
    const { runs } = await ask("GET", "/__rb/history") as { runs: Run[] };
    return formatHistory(runs, Number.isInteger(a.runs) ? Number(a.runs) : 5);
  }
  if (name === "heap_snapshots") {
    const { snapshots } = await ask("GET", "/__rb/heap") as { snapshots: (SavedFile & { process: string })[] };
    if (!snapshots.length) return "No heap snapshots: nothing has gone over its memory ceiling (AGENT_OFFICE_MEM_MAX_MB).";
    return [`${snapshots.length} heap snapshot${snapshots.length === 1 ? "" : "s"}; open one in Chrome DevTools > Memory`,
      ...snapshots.map((f) => `  ${f.process}  ${f.at}  ${(f.bytes / 1e6).toFixed(1)} MB  ${f.file}`)].join("\n");
  }
  throw new Error(`Unknown tool: ${name}`);
}
