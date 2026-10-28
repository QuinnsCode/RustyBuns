// Shared Sphere: TerraViz's own Worker, wrapped. Two paths are ours (the room's socket and the page script); every
// other request goes to TerraViz untouched, and its HTML pages get one <script> tag that puts the people on the globe.
// `run.ts --shared` writes the entry that hands this TerraViz's generated router, so no TerraViz file changes.
import { clean } from "./room.ts";
import { jumpFromSearch, sphereClient } from "./client.ts";

type Namespace = { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
type Env = { SPHERE: Namespace } & Record<string, unknown>;
type Inner = { fetch(req: Request, env: any, ctx: any): Response | Promise<Response> };

export const WS_PATH = "/__sphere/ws";
export const CLIENT_PATH = "/__sphere/client.js";
const CLIENT = `(${sphereClient.toString()})(${JSON.stringify(WS_PATH)}, ${jumpFromSearch.toString()});\n`;

/** A room name from the query: lowercase letters, digits and dashes, "lobby" when there is none. */
export const roomName = (s: string | null) => clean(s, 32).toLowerCase().replace(/[^a-z0-9-]/g, "") || "lobby";

export function sphere(inner: Inner) {
  return {
    async fetch(req: Request, env: Env, ctx: unknown): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) return env.SPHERE.get(env.SPHERE.idFromName(roomName(url.searchParams.get("room")))).fetch(req);
      if (url.pathname === CLIENT_PATH)
        return new Response(CLIENT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
      const res = await inner.fetch(req, env, ctx);
      if (!res.headers.get("content-type")?.includes("text/html")) return res;
      // the globe page and the rest: the script waits for TerraViz's app and does nothing where there is no globe
      return new HTMLRewriter()
        .on("head", { element: (e) => { e.append(`<script src="${CLIENT_PATH}" defer></script>`, { html: true }); } })
        .transform(res);
    },
  };
}
