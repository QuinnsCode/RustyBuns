// The docs site's Worker: static assets as before, plus /api/votes, which lives in one Durable Object
// (the last 50 votes in its storage). Reads are cached at the edge for 10 seconds so a busy home page
// doesn't wake the object on every poll.
import { handleVotes, type Vote } from "./votes.ts";

type Stub = { fetch(req: Request): Promise<Response> };
type Env = {
  ASSETS: { fetch(req: Request): Promise<Response> };
  VOTES: { idFromName(name: string): unknown; get(id: unknown): Stub };
};
type DOState = { storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> } };

export class Votes {
  private last = new Map<string, number>();
  constructor(private state: DOState) {}
  fetch(req: Request) {
    const store = {
      read: async () => (await this.state.storage.get<Vote[]>("votes")) ?? [],
      write: (votes: Vote[]) => this.state.storage.put("votes", votes),
    };
    return handleVotes(req, store, req.headers.get("cf-connecting-ip") ?? "unknown", this.last);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== "/api/votes") return env.ASSETS.fetch(req);
    const stub = env.VOTES.get(env.VOTES.idFromName("votes"));
    if (req.method !== "GET") return stub.fetch(req);
    const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
    const hit = await cache?.match(req);
    if (hit) return hit;
    const res = new Response((await stub.fetch(req)).body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=10" } });
    if (cache) await cache.put(req, res.clone());
    return res;
  },
};
