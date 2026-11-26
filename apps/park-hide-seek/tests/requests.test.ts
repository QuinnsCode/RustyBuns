import { expect, test } from "bun:test";
import { ParkRequests, REQUESTABLE, type VoteStore } from "../src/edge/requests.ts";

const memory = (): VoteStore => {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) { return m.get(k) as T | undefined; },
    async put(k: string, v: unknown) { m.set(k, v); },
    async list<T>({ prefix }: { prefix: string }) { return new Map([...m].filter(([k]) => k.startsWith(prefix))) as Map<string, T>; },
  };
};

test("request a survey: one vote per player per park, only for parks not surveyed yet", async () => {
  expect(REQUESTABLE.some((p) => p.code === "YOSE")).toBe(false);
  const parks = new ParkRequests({ storage: memory() });
  const vote = (code: string, voter: string) => parks.fetch(new Request(`https://parks/?code=${code}&voter=${voter}`, { method: "POST" }));
  const votes = async (r: Response) => ((await r.json()) as { votes: Record<string, number> }).votes;

  await vote("ZION", "alice");
  await vote("ZION", "alice"); // again: still one
  await vote("ZION", "bob");
  expect(await votes(await vote("GRCA", "alice"))).toEqual({ ZION: 2, GRCA: 1 });
  expect((await vote("YOSE", "alice")).status).toBe(400);
  expect((await vote("NOPE", "alice")).status).toBe(400);
  expect(await votes(await parks.fetch(new Request("https://parks/")))).toEqual({ ZION: 2, GRCA: 1 });
});

test("the Worker tells an old build to update on /ws and /api, and serves a current one", async () => {
  const worker = (await import("../src/edge/worker.ts")).default;
  const env = { ASSETS: { fetch: async () => new Response("page") } } as unknown as Parameters<typeof worker.fetch>[1];
  const { MIN_PROTOCOL } = await import("../src/api.ts");
  const reply = await worker.fetch(new Request("https://phs.test/api/parks?pv=0"), env);
  expect(reply.status).toBe(426);
  expect(((await reply.json()) as { update: number }).update).toBe(MIN_PROTOCOL);
  expect((await worker.fetch(new Request(`https://phs.test/index.html?pv=0`), env)).status).toBe(200);
});

test("five votes a minute an address, however many guests it makes up and whichever park", async () => {
  const worker = (await import("../src/edge/worker.ts")).default;
  const { MIN_PROTOCOL } = await import("../src/api.ts");
  const env = { PARKS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("counted") }) } } as unknown as Parameters<typeof worker.fetch>[1];
  const vote = async (n: number) => (await worker.fetch(new Request(`https://phs.test/api/parks?pv=${MIN_PROTOCOL}&code=ZION&uid=made-up-guest-${n}`, { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.9" } }), env)).status;
  const got: number[] = [];
  for (let n = 0; n < 7; n++) got.push(await vote(n));
  expect(got).toEqual([200, 200, 200, 200, 200, 429, 429]);
});
