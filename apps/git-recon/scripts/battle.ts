// A battle world for `bun run dev`: the same World the desktop app hosts, on 127.0.0.1:4180,
// which Vite proxies /ws to. Every tab is a player (its ?uid= and ?name= are taken at their
// word, as the desktop host does for LAN guests), so two tabs are a two-player battle.
//
//   bun run battle      then   bun run dev, and Host (or Join with no address) in each tab
import { durableObject, serve } from "@rustybuns/shell-bun";
import World from "../src/net/world.ts";

const PORT = Number(process.env.BATTLE_PORT ?? 4180);
const env: any = {};
env.WORLD = durableObject(World as never, env);
const shell = serve<any>({ hostname: "127.0.0.1", port: PORT });
shell.mount({
  fetch: (req: Request, e: any) => {
    const q = new URL(req.url).searchParams, headers = new Headers(req.headers);
    headers.set("X-User-Id", q.get("uid") || crypto.randomUUID());
    headers.set("X-User-Name", q.get("name") || "soldier");
    return e.WORLD.get(e.WORLD.idFromName("battle")).fetch(new Request(req, { headers }));
  },
} as never, env);
console.log(`git-recon battle world on ws://127.0.0.1:${shell.port}/ws`);
