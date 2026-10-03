// Cloudflare shell. Serves the page, and routes /ws?room=<name> to a World
// Durable Object, the same class the desktop host runs in-process. Each room
// is one shared groove. Visitors are anonymous: the Worker vouches a random id,
// the way the desktop host vouches its one local user.
import World from "../packages/desktop/world.ts";
export { World };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

export default {
  fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") ?? "lobby").slice(0, 64);
      const headers = new Headers(req.headers);
      headers.set("X-User-Id", crypto.randomUUID());
      return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
    }
    return env.ASSETS.fetch(req);
  },
};
