// The triage tools in the worker's MCP server (bin/office-workers.js imports this as rb-triage.js):
// they call the office's /__rb routes on the loopback hook port with the worker's own id and token,
// the same as the server's other tools.
import { runTriageTool, TRIAGE_NOTE, TRIAGE_TOOLS, type TriageCall } from "./tools.ts";

export { TRIAGE_NOTE, TRIAGE_TOOLS };

/** A profile takes up to 60s; everything else answers at once. */
const TIMEOUT_MS = 90_000;

export function hookCall(io: { env: Record<string, string | undefined>; fetch: typeof fetch }): TriageCall {
  const { AGENT_OFFICE_HOOK_URL: base, AGENT_OFFICE_WORKER_ID: worker, AGENT_OFFICE_HOOK_TOKEN: token } = io.env;
  return async (method, p) => {
    if (!base || !worker || !token) throw new Error("AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN aren't set: these tools work from a worker in Agent Office");
    const url = new URL(base.replace(/\/+$/, "") + p);
    url.searchParams.set("worker", worker);
    let res: Response;
    try {
      res = await io.fetch(url.href, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Couldn't reach the office at ${url.origin} (${(err as Error).message}). Is it running?`);
    }
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 300) }; }
    // an office from before these routes answers the hook port's 404
    if (res.status === 404 && !body?.error) body = { error: "The office doesn't know these tools yet (404): restart it" };
    return { status: res.status, body };
  };
}

/** Runs a triage tool for the MCP server: its text, as the server's own tools answer. */
export async function runTriageMcp(name: string, args: Record<string, unknown>, io: { env: Record<string, string | undefined>; fetch: typeof fetch }) {
  return { text: await runTriageTool(name, args, hookCall(io)) };
}
