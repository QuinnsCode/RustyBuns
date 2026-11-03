// The triage tools on the office page as commands (@rustybuns/util/commands): WebMCP tools for an agent in the
// browser (Claude in Chrome, the desktop app's browser), with the signed-in session and no token to hand over, and
// window.__commands for a script or `bun run probe`. The worker's MCP server has the same tools. commands/ adds them,
// so the page has one copy of the commands module (and one __commands) rather than one per page script.
import type { Command } from "@rustybuns/util/commands";
import { check, raw, rec } from "@rustybuns/util/guard";
import { runTriageTool, TRIAGE_TOOLS, type TriageCall } from "./tools.ts";

const pageCall: TriageCall = async (method, p) => {
  const res = await fetch(p, { method, credentials: "same-origin", headers: { "x-rb-triage": "1" } });
  if (res.redirected || res.url.includes("/login")) return { status: 401, body: { error: "Sign in to the office first" } };
  const body = await res.json().catch(() => ({ error: `The office answered ${res.status}` }));
  return { status: res.status, body };
};

/** The six triage tools as commands; a failed call throws its message. */
export const triageCommands = (call: TriageCall = pageCall): Command[] =>
  TRIAGE_TOOLS.map((t) => ({ ...t, group: "Triage", execute: (args: unknown) => runTriageTool(t.name, check(rec(raw), args) ?? {}, call) }));
