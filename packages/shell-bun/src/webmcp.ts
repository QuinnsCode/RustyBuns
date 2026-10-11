// A box's triage tools for an agent in the browser (Claude in Chrome, the desktop app's
// browser), over WebMCP (navigator.modelContext), as the Agent Office page has its own.
// Opt-in with targets.box.webmcp: the box adds WEBMCP_TAG to its pages' <head> and serves
// the script at WEBMCP_PATH. mem_stats reads the public /__rb/mem. take_cpu_profile and
// mem_history need RB_PROF_SECRET, which the visitor hands the page once by opening it with
// #rb_prof=<secret>: the page keeps it in sessionStorage (this tab only) and takes it off the
// URL. The agent never sees it, and a box without the secret answers those two with why.

import { formatMemStats } from "./memwatch.ts";

export const WEBMCP_PATH = "/__rb/webmcp.js";
export const WEBMCP_TAG = `<script src="${WEBMCP_PATH}" defer></script>`;

const TOOLS = [
  {
    name: "mem_stats",
    title: "Box memory",
    description:
      "Memory of the server this page comes from: RSS and JS heap now, the peak, and the RSS growth over the last hour in MB/h. " +
      "A steady positive slope over hours is a leak; with a ceiling set, hoursToMax says how long until the box restarts itself. " +
      "Samples come every 5 minutes, so the slope needs 15 minutes of uptime first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "take_cpu_profile",
    title: "Profile the box",
    description:
      "Samples the server's CPU for some seconds and answers with its hottest functions (by self and total time, with the stack under each). " +
      "One profile at a time, 60 seconds at most. Take one while the slowness is happening; a quiet box shows mostly idle. " +
      "Needs the box's RB_PROF_SECRET, which the person (never you) gives the page once by opening it with #rb_prof=<secret>.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "integer", minimum: 1, maximum: 60, description: "How long to sample (default 10)." },
        top: { type: "integer", minimum: 1, maximum: 50, description: "How many frames to list by self and by total time (default 10)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "mem_history",
    title: "Box history",
    description:
      "The box's runs, one per start, newest first, kept across restarts and deploys: each run's RSS from start to end with its MB/h slope, " +
      "the CPU profiles taken in it with their hottest functions, and whether it went over its memory ceiling and restarted. " +
      "Compare this run with the one before to see what a deploy did. Needs RB_PROF_SECRET, as take_cpu_profile does.",
    inputSchema: {
      type: "object",
      properties: { runs: { type: "integer", minimum: 1, maximum: 50, description: "How many runs to show (default 5)." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const NEED_SECRET =
  "This needs the box's RB_PROF_SECRET, and this tab doesn't have it. Ask the person to open this page once with #rb_prof=<the secret> " +
  "added to the URL: the page keeps it for this tab and takes it off the URL. Don't ask them to tell you the secret.";
const WRONG_SECRET = "The box turned down the secret this tab had, so the page forgot it. " + NEED_SECRET.slice(NEED_SECRET.indexOf("Ask"));
const NO_SECRET = "This box doesn't serve profiles or history: it has no RB_PROF_SECRET (16 characters or more) set. mem_stats still works.";

/** The page's script: registers the tools with navigator.modelContext, when the browser has one. */
export function webMcpScript(): string {
  return `// RustyBuns box triage tools over WebMCP (targets.box.webmcp). See @rustybuns/shell-bun/webmcp.
(() => {
  const KEY = "rb_prof_secret";
  const secret = {
    get() { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } },
    set(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {} },
  };
  // #rb_prof=<secret>: the visitor hands the page the secret once; it leaves the URL at once.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has("rb_prof")) {
    secret.set(hash.get("rb_prof"));
    hash.delete("rb_prof");
    const rest = hash.toString();
    history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : ""));
  }
  const mc = navigator.modelContext;
  if (!mc) return;
  const formatMemStats = ${formatMemStats.toString()};
  const fail = (msg) => { throw new Error(msg); };
  const int = (v, d) => Number.isInteger(v) ? v : d;
  async function gated(method, path) {
    const s = secret.get();
    if (!s) fail(${JSON.stringify(NEED_SECRET)});
    const res = await fetch(path, { method, headers: { Authorization: "Bearer " + s } });
    if (!res.headers.get("x-rb-prof")) fail(${JSON.stringify(NO_SECRET)});
    if (res.status === 401) { secret.set(""); fail(${JSON.stringify(WRONG_SECRET)}); }
    const text = await res.text();
    return res.ok ? text : fail(text);
  }
  const run = {
    async mem_stats() {
      const res = await fetch("/__rb/mem");
      if (!res.ok) fail("The box answered " + res.status + " on /__rb/mem");
      const m = await res.json();
      return formatMemStats(m) + (m.boots ? ", start " + m.boots + " on this data" : "");
    },
    take_cpu_profile: (a) => gated("POST", "/__rb/prof?text=1&s=" + int(a.seconds, 10) + "&top=" + int(a.top, 10)),
    mem_history: (a) => gated("GET", "/__rb/history?text=1&runs=" + int(a.runs, 5)),
  };
  const tools = ${JSON.stringify(TOOLS)}.map((t) => ({
    ...t,
    async execute(args) {
      try { return { content: [{ type: "text", text: await run[t.name](args || {}) }] }; }
      catch (err) { return { content: [{ type: "text", text: String(err && err.message || err) }], isError: true }; }
    },
  }));
  try {
    if (typeof mc.registerTool === "function") for (const t of tools) mc.registerTool(t);
    else if (typeof mc.provideContext === "function") mc.provideContext({ tools });
  } catch (err) { console.warn("[rb-webmcp]", err); }
})();
`;
}

/** Serves the script at WEBMCP_PATH; null for any other path. */
export function webMcpRoute(): (req: Request) => Response | null {
  const body = webMcpScript();
  return (req) => new URL(req.url).pathname === WEBMCP_PATH
    ? new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } })
    : null;
}
