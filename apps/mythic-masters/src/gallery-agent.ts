// An agent at the beast gallery (`?gallery=<page>`): WebMCP tools (document.modelContext) to list the page's beasts,
// put one in the frame, flatten them to silhouettes, turn the page, and (dev server only) nudge a node of a sheet
// and see the rebuilt beast stand there. Nothing registers unless the browser has modelContext.
import { arr, bool, int, num, obj, oneOf, str } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import type { gallery, View } from "./gallery.ts";
import { Nudge } from "./nudge.ts";

type Shelf = ReturnType<typeof gallery>;
export interface Shown { shelf: () => Shelf | null; page: () => number; pages: number; show: (n: number) => void }

const VIEWS = ["side", "front", "three-quarter", "grid"] as const;
const Sheets = arr(obj({ id: str(40), budget: num(0, 1e6, 0) }), 1000, { drop: true });

/** The tools, as plain objects WebMCP takes (and a test can call). */
export function tools(g: Shown) {
  const need = () => { const s = g.shelf(); if (!s) throw new Error("the gallery is not open"); return s; };
  const row = (s: Shelf["stands"][number], budgets: Map<string, number>) => ({
    id: s.id, loaded: !!s.beast, budget: budgets.get(s.id) ?? null, triangles: s.beast?.model.triangles ?? null,
    feet: s.beast?.sheet.feet.length ?? null, wings: s.beast?.sheet.wings.length ?? null,
  });
  const budgets = async () => new Map((await getJson("/__beast/sheets", Sheets) ?? []).map((b) => [b.id, b.budget]));
  const none = { type: "object", properties: {} } as const;
  return [
    { name: "beast_list", title: "List the beasts", description: "The beasts on this gallery page: id, triangle budget (dev server only), triangles, feet and wings found by the rigger.",
      inputSchema: none, annotations: { readOnlyHint: true },
      execute: async () => { const b = await budgets(); return { page: g.page(), pages: g.pages, beasts: need().stands.map((s) => row(s, b)) }; } },
    { name: "beast_focus", title: "Focus a beast", description: "One beast filling the frame, side-on, from the front or three-quarter; \"grid\" shows all of them again.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, view: { type: "string", enum: VIEWS } }, required: ["id"] },
      execute: async (a: unknown) => {
        const A = obj({ id: str(40), view: oneOf(VIEWS, "three-quarter") })(a);
        if (!need().focus(A.id, A.view as View)) throw new Error(`${A.id} is not on this page, or has not loaded`);
        return { id: A.id, view: A.view };
      } },
    { name: "beast_nudge", title: "Nudge a node (dev only)", description: "Move one node of a beast's sheet by dx, dy, dz (metres) and grow its radius by dr, then rebuild that one beast and stand the new one in the gallery. Only the dev server can do it; it takes a few seconds.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, node: { type: "string" }, dx: { type: "number" }, dy: { type: "number" }, dz: { type: "number" }, dr: { type: "number" } }, required: ["id", "node"] },
      execute: async (a: unknown) => {
        const n = Nudge(a);
        const r = await fetch("/__beast/nudge", { method: "POST", body: JSON.stringify(n) });
        const said = obj({ error: str(500, { dflt: "" }), log: str(2000, { dflt: "" }) })(await r.json().catch(() => null));
        if (!r.ok || !r.headers.get("content-type")?.includes("json")) throw new Error(said.error || said.log || "beast_nudge works on the dev server only");
        await need().reload(n.id);
        const s = need().stands.find((x) => x.id === n.id);
        return s ? row(s, await budgets()) : { id: n.id };
      } },
    { name: "beast_silhouette", title: "Silhouettes", description: "Every beast flat black (on) or as painted (off), to read each from its outline.",
      inputSchema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
      execute: async (a: unknown) => { const on = obj({ on: bool(true) })(a).on; need().silhouette(on); return { on }; } },
    { name: "gallery_page", title: "Turn the page", description: `Show page n (0 to ${g.pages - 1}) of the roster, sixteen beasts to a page.`,
      inputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
      execute: async (a: unknown) => { const n = obj({ n: int(0, g.pages - 1, 0) })(a).n; g.show(n); return { page: n }; } },
  ];
}

interface ModelContext { registerTool(t: unknown, o: { signal: AbortSignal }): unknown }
const hasRegister = (v: unknown): v is ModelContext => typeof v === "object" && v !== null && typeof Reflect.get(v, "registerTool") === "function";

/** Register the tools with the browser's agent, if it has one. */
export async function mountAgent(g: Shown) {
  const mc: unknown = Reflect.get(document, "modelContext") ?? Reflect.get(navigator, "modelContext");
  if (!hasRegister(mc)) return false;
  const off = new AbortController();
  addEventListener("pagehide", () => off.abort());
  for (const t of tools(g)) { try { await mc.registerTool(t, { signal: off.signal }); } catch { /* an older build without a tool's shape: skip it */ } }
  return true;
}
