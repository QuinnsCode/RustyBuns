// The game: an almost-backrooms version of a repo, where every folder is a
// room, the walls are its files' lines, and the lines come off the walls at you.
//   GET /api/game/l/:slug            who's waiting in a level's room
//   GET /api/game/l/:slug/walls?path one room of the backrooms
//   WS  /api/game/l/:slug/ws         join (WebSocket to the GameRoom DO)
// and the same under /api/game/r/:owner/:repo for any repo you can read.

import { handleFor, walls } from "./archive.ts";
import { LEVELS, levelSource } from "./levels.ts";
import { json, type Env } from "./env.ts";

type CanRead = (owner: string, repo: string) => Promise<boolean>;

export async function gameRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null, canRead: CanRead): Promise<Response | null> {
  if (p[1] !== "game") return null;
  let room: string, rest: string[], open: () => Promise<{ handle: any; ref: string; commit?: string | null } | null>;
  if (p[2] === "l" && p[3]) {
    const level = LEVELS.find((l) => l.slug === p[3]);
    if (!level) return json({ error: "no such level" }, 404);
    room = `l/${level.slug}`, rest = p.slice(4);
    open = () => levelSource(env, level.slug);
  } else if (p[2] === "r" && p[3] && p[4]) {
    const [owner, repo] = [p[3], p[4]];
    // A private repo you can't see looks the same as one that doesn't exist.
    if (!(await canRead(owner, repo))) return json({ error: "not found" }, 404);
    room = `r/${owner}/${repo}`, rest = p.slice(5);
    open = async () => {
      const h = await handleFor(env, owner, repo);
      return h && { handle: h.handle, ref: h.branch };
    };
  } else return json({ error: "not found" }, 404);

  const stub = env.GAMES.get(env.GAMES.idFromName(room));
  if (!rest[0]) return stub.fetch(new Request("https://game/status"));
  if (rest[0] === "walls") {
    const src = await open();
    if (!src) return json({ error: "nothing dug up here yet" }, 409);
    const w = await walls(env, src.handle, src.ref, (url.searchParams.get("path") ?? "").replace(/^\/|\/$/g, ""), src.commit);
    return w ? json(w) : json({ error: "no such room" }, 404);
  }
  if (rest[0] === "ws") {
    // Signed-in players play as themselves; anyone else gets a guest name.
    const h = new Headers(req.headers);
    h.set("x-codesplitters-user", user ?? `guest-${Math.random().toString(36).slice(2, 6)}`);
    return stub.fetch(new Request(req.url, { headers: h }));
  }
  return json({ error: "not found" }, 404);
}
