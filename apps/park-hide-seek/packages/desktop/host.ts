// App routes on the Rusty Buns host. The page needs the machine's LAN address to
// tell friends where to join; the browser can't see it, the host can. On a box
// (Railway) the page plays like the edge, so the host also hands out quick play
// rooms, as the Matchmaker Durable Object does online (src/edge/match.ts).
//
//   GET /api/lan     { addresses: ["192.168.1.20", ...], port }
//   GET /api/match   { room, startsIn }
import type { HostContext } from "@rustybuns/shell-bun";
import { networkInterfaces } from "node:os";
import { QuickMatch } from "../../src/edge/match.ts";
import { RoomMintGate } from "../../src/edge/limits.ts";

const UID = /^[A-Za-z0-9_-]{8,64}$/;
const quick = new QuickMatch();
/** New player ids one address may bring to quick play a minute, as on the edge. */
const matchGate = new RoomMintGate(6);

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname === "/api/match") {
      const uid = url.searchParams.get("uid") ?? "";
      if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
      // Railway's proxy sets X-Real-IP; on the desktop there is none, and no gate.
      const ip = req.headers.get("X-Real-IP");
      if (ip && !matchGate.allow(ip, uid, Date.now())) return new Response("too many players from here, try again in a minute", { status: 429 });
      return Response.json(quick.pick(uid, Date.now()), { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname !== "/api/lan") return null;
    const addresses: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) addresses.push(a.address);
    }
    return Response.json({ addresses, port: ctx.shell.port });
  },
};
