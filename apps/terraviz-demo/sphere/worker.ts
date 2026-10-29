// Shared Sphere: TerraViz's own Worker, wrapped. A few paths are ours (the room's socket, the page script, the
// tour reader and the demo tours); every other request goes to TerraViz untouched, and its HTML pages get one
// <script> tag that puts the people on the globe. `run.ts --shared` writes the entry that hands this TerraViz's
// generated router, so no TerraViz file changes.
import { clean } from "./room.ts";
import { jumpFromSearch, sphereClient } from "./client.ts";
import { TOUR_GLUE, TOUR_WASM_B64 } from "./tour-pkg.ts";
import { TOURS } from "./tours.ts";

type Namespace = { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
type Env = { SPHERE: Namespace } & Record<string, unknown>;
type Inner = { fetch(req: Request, env: unknown, ctx: unknown): Response | Promise<Response> };

export const WS_PATH = "/__sphere/ws";
export const CLIENT_PATH = "/__sphere/client.js";
export const TOUR_GLUE_PATH = "/__sphere/tour.js";
export const TOUR_WASM_PATH = "/__sphere/tour.wasm";
/** The demo tours from content/*.json, each at /__sphere/tours/<name>.json, listed at /__sphere/tours.json. */
export const TOURS_PATH = "/__sphere/tours";
const CLIENT = `(${sphereClient.toString()})(${JSON.stringify({ ws: WS_PATH, glue: TOUR_GLUE_PATH, wasm: TOUR_WASM_PATH, tours: TOURS_PATH })}, ${jumpFromSearch.toString()});\n`;
const WASM = Uint8Array.from(atob(TOUR_WASM_B64), (c) => c.charCodeAt(0));

/** A room name from the query: lowercase letters, digits and dashes, "lobby" when there is none. */
export const roomName = (s: string | null) => clean(s, 32).toLowerCase().replace(/[^a-z0-9-]/g, "") || "lobby";

const text = (body: string, type: string) => new Response(body, { headers: { "content-type": type, "cache-control": "no-cache" } });

export function sphere(inner: Inner) {
  return {
    async fetch(req: Request, env: Env, ctx: unknown): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) return env.SPHERE.get(env.SPHERE.idFromName(roomName(url.searchParams.get("room")))).fetch(req);
      if (url.pathname === CLIENT_PATH) return text(CLIENT, "text/javascript; charset=utf-8");
      if (url.pathname === TOUR_GLUE_PATH) return text(TOUR_GLUE, "text/javascript; charset=utf-8");
      if (url.pathname === TOUR_WASM_PATH) return new Response(WASM, { headers: { "content-type": "application/wasm", "cache-control": "public, max-age=3600" } });
      if (url.pathname === `${TOURS_PATH}.json`)
        return text(JSON.stringify(Object.entries(TOURS).map(([name, t]) => ({ name, title: t.title, url: `${TOURS_PATH}/${name}.json` }))), "application/json");
      if (url.pathname.startsWith(`${TOURS_PATH}/`)) {
        const tour = TOURS[url.pathname.slice(TOURS_PATH.length + 1).replace(/\.json$/, "")];
        return tour ? text(tour.json, "application/json") : new Response("no such tour", { status: 404 });
      }
      const res = await inner.fetch(req, env, ctx);
      if (!res.headers.get("content-type")?.includes("text/html")) return res;
      // the globe page and the rest: the script waits for TerraViz's app and does nothing where there is no globe
      return new HTMLRewriter()
        .on("head", { element: (e) => { e.append(`<script src="${CLIENT_PATH}" defer></script>`, { html: true }); } })
        .transform(res);
    },
  };
}
