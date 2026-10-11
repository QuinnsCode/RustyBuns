// The triage tools on the office page, over WebMCP (navigator.modelContext), so an agent in the browser
// (Claude in Chrome, the desktop app's browser) gets them from the page with the signed-in session and no
// token to hand over. A browser without WebMCP skips this; the worker's MCP server has the same tools.
import { runTriageTool, TRIAGE_TOOLS, type TriageCall } from "./tools.ts";

interface ModelContext {
  registerTool?: (tool: object) => unknown;
  provideContext?: (ctx: { tools: object[] }) => unknown;
}

const pageCall: TriageCall = async (method, p) => {
  const res = await fetch(p, { method, credentials: "same-origin", headers: { "x-rb-triage": "1" } });
  if (res.redirected || res.url.includes("/login")) return { status: 401, body: { error: "Sign in to the office first" } };
  const body = await res.json().catch(() => ({ error: `The office answered ${res.status}` }));
  return { status: res.status, body };
};

export function webMcpTools(call: TriageCall = pageCall) {
  return TRIAGE_TOOLS.map((t) => ({
    ...t,
    async execute(args: Record<string, unknown>) {
      try {
        return { content: [{ type: "text", text: await runTriageTool(t.name, args, call) }] };
      } catch (err) {
        return { content: [{ type: "text", text: (err as Error).message }], isError: true };
      }
    },
  }));
}

/** Registers the tools with the page's model context; false when the browser has none. */
export function registerWebMcp(mc: ModelContext | undefined = (globalThis.navigator as any)?.modelContext): boolean {
  if (!mc) return false;
  const tools = webMcpTools();
  if (typeof mc.registerTool === "function") for (const t of tools) mc.registerTool(t);
  else if (typeof mc.provideContext === "function") mc.provideContext({ tools });
  else return false;
  return true;
}

if (typeof document !== "undefined") {
  try { registerWebMcp(); } catch (err) { console.warn("[rb-triage] WebMCP:", err); }
}
