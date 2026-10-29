// Cloudflare shell. Serves the page at /sesh/<name> (a bare visit gets a new name),
// and routes /ws?room=<name> to a World Durable Object, the same class the desktop
// host runs in-process. Each sesh is one shared groove. Visitors are anonymous: the Worker vouches a random id,
// the way the desktop host vouches its one local user. The Lobby counts the open
// rooms (MAX_ROOMS at once) and keeps the sign-up list for when they're all taken. A sesh can
// be private: the World keeps its code (hashed) and lets in only who brings it (?code= on /ws).
import World, { type WorldEnv } from "../packages/desktop/world.ts";
import Lobby, { IDLE_MS } from "./lobby.ts";
import { seshFromPath, seshName } from "./sesh.ts";
import Profile from "./profile.ts";
import { personId } from "./chat.ts";
import { RoomMintGate } from "@rustybuns/util/limits";
export { World, Lobby, Profile };

const mintGate = new RoomMintGate();
// A few sign-ups a minute from one address (each one a new key, so the gate counts them all).
const signupGate = new RoomMintGate(3);
// New profiles saved a minute from one address (a profile is one person's key).
const profileGate = new RoomMintGate(10);
const KEY = /^[0-9a-f]{32,64}$/;

interface Env extends WorldEnv {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  LOBBY: NonNullable<WorldEnv["LOBBY"]>;
  /** One per person: their name and chat layout (src/profile.ts). */
  PROFILE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** Bearer token for GET /signups. Unset, the list can't be read from outside. */
  SIGNUPS_TOKEN?: string;
}

const sha = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function sameToken(given: string, want: string) {
  const [a, b] = await Promise.all([sha(given), sha(want)]);
  return a.every((x, i) => x === b[i]);
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const ip = req.headers.get("CF-Connecting-IP");
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName("lobby"));
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") ?? "lobby").slice(0, 64);
      if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const headers = new Headers(req.headers);
      headers.set("X-User-Id", crypto.randomUUID());
      headers.set("X-Room", room);
      headers.set("X-Room-Idle-Ms", String(IDLE_MS));
      // a private sesh's code, as the page sent it; only the World knows whether it's right
      headers.delete("X-Sesh-Code");
      const code = url.searchParams.get("code")?.slice(0, 32);
      if (code) headers.set("X-Sesh-Code", code);
      return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
    }
    if (url.pathname === "/" && req.method === "GET") {
      // an old ?room= link keeps its groove under the new address
      const old = url.searchParams.get("room")?.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64);
      return Response.redirect(new URL(`/sesh/${old || seshName()}`, url).href, 302);
    }
    if (seshFromPath(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/", url), req));
    if (url.pathname === "/me" && (req.method === "GET" || req.method === "PUT")) {
      // the key stays in the browser and this request; the profile is filed under its hash
      const key = req.headers.get("X-User-Key") ?? "";
      if (!KEY.test(key)) return new Response("no key", { status: 400 });
      const id = await personId(key);
      if (req.method === "PUT" && ip && !profileGate.allow(ip, id, Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const body = req.method === "PUT" ? (await req.text()).slice(0, 4096) : undefined;
      return env.PROFILE.get(env.PROFILE.idFromName(id)).fetch(new Request("https://profile/", { method: req.method, body }));
    }
    if (url.pathname === "/rooms" && req.method === "GET") return lobby().fetch("https://lobby/status");
    if (url.pathname === "/signup" && req.method === "POST") {
      if (ip && !signupGate.allow(ip, String(Date.now()), Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      return lobby().fetch("https://lobby/signup", { method: "POST", body: (await req.text()).slice(0, 4096) });
    }
    if (url.pathname === "/signups" && req.method === "GET") {
      const given = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      if (!env.SIGNUPS_TOKEN || !(await sameToken(given, env.SIGNUPS_TOKEN))) return new Response("not found", { status: 404 });
      return lobby().fetch("https://lobby/signups");
    }
    return env.ASSETS.fetch(req);
  },
};
