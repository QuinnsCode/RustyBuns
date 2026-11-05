// eqosys's page commands (@rustybuns/util/commands): every tool GET /api/tools lists, each one POSTing /api/tools/<name>
// with the person's own session (nothing holds a token), plus eq_open_app, which only a page can do. They are WebMCP
// tools for an agent in the browser, window.__commands for `bun run probe eqosys --js "__commands.list()"`, and the
// Cmd/Ctrl+K palette for a person. The page's only module script: the CSP lets it in by the request's nonce.
import { addCommands, type Command, type Hints, type InputSchema } from "@rustybuns/util/commands";
import { arr, check, maybe, obj, raw, rec, str } from "@rustybuns/util/guard";
import { mountPalette } from "@rustybuns/util/palette";

type Fetch = (url: string, init?: { method?: string; credentials?: "same-origin"; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const Prop = obj({ type: maybe(str(20)), description: maybe(str(500)) });
const Tool = obj({
  name: str(64, { re: /^eq_[a-z_]+$/ }), title: str(100), description: str(4000),
  inputSchema: maybe(obj({ type: str(20), properties: rec(raw, 50), required: maybe(arr(str(64), 50)), additionalProperties: maybe(raw) })),
  annotations: maybe(rec(raw, 10)),
});
const Listing = obj({ tools: arr(Tool, 200, { drop: true }) });
const Reply = obj({ result: maybe(raw), error: maybe(str(2000)) });
const OpenApp = obj({ app: str(64, { re: /^[a-z0-9-]+$/ }) });

const hints = (a: Record<string, unknown> | undefined): Hints => {
  const h: Hints = {};
  for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) { const v = a?.[k]; if (typeof v === "boolean") h[k] = v; }
  return h;
};

/** The listed tools as commands. In the palette: those that take nothing, and those with one argument, which it asks for. */
export function toolCommands(listing: unknown, f: Fetch): Command[] {
  const call = async (name: string, args: unknown) => {
    const r = await f(`/api/tools/${name}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(args ?? {}) });
    const body = check(Reply, await r.json().catch(() => null));
    if (!r.ok) throw new Error(body?.error ?? `eqosys answered ${r.status}${r.status === 401 ? ": sign in first" : ""}`);
    return body?.result;
  };
  return (check(Listing, listing)?.tools ?? []).map((t): Command => {
    const s = t.inputSchema;
    const schema: InputSchema = { type: "object", properties: Object.fromEntries(Object.entries(s?.properties ?? {}).filter((e): e is [string, object] => typeof e[1] === "object" && e[1] !== null)), ...(s?.required && { required: s.required }), ...(s?.additionalProperties === false && { additionalProperties: false }) };
    const props = Object.entries(schema.properties), first = props[0] && check(Prop, props[0][1]);
    const ask = props.length === 1 && first ? first.description ?? props[0]![0] : undefined;
    return { name: t.name, title: t.title, description: t.description, inputSchema: schema, annotations: hints(t.annotations), group: "eqosys",
      ...(ask ? { ask } : props.length && { palette: false }), execute: (a) => call(t.name, a) };
  });
}

export const openApp: Command = {
  name: "eq_open_app", title: "Open an app's page", group: "Go to", ask: "App id (eq_apps lists them)",
  description: "Go to an app's page here (its long description, achievements and Play button) by id from eq_apps. Answers once navigation starts.",
  inputSchema: { type: "object", properties: { app: { type: "string" } }, required: ["app"], additionalProperties: false }, annotations: { idempotentHint: true },
  execute: (a) => { const { app } = OpenApp(a); setTimeout(() => location.assign(`/app/${app}`), 0); return { opening: app }; },
};

/** Add eq_open_app, then every tool the server lists. Resolves once they are all in. */
export async function startCommands(f: Fetch = fetch) {
  addCommands([openApp]);
  const listing = await f("/api/tools", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null), () => null);
  addCommands(toolCommands(listing, f));
}

/** The first tap, key or scroll on the page tells the Visitors count (visitors.ts) a person is here, once a page. */
function beaconOnce() {
  const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
  const go = () => {
    for (const e of events) removeEventListener(e, go, true);
    navigator.sendBeacon("/api/visit", JSON.stringify({ site: "eqosys", engaged: true }));
  };
  for (const e of events) addEventListener(e, go, { capture: true, passive: true });
}

if (typeof document !== "undefined") {
  beaconOnce();
  mountPalette({ foot: "Every command here is an eqosys tool an agent in the browser can call too." });
  void startCommands();
}
