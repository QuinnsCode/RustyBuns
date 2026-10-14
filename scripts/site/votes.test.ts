import { expect, test } from "bun:test";
import { KEEP, type Store, type Vote, handleVotes, parseVote } from "./votes.ts";
import worker from "./worker.ts";
import { ballot, columns, nextIndex } from "./assets/votes.js";

const memory = (): Store & { votes: Vote[] } => {
  const s = { votes: [] as Vote[], read: async () => s.votes, write: async (v: Vote[]) => void (s.votes = v) };
  return s;
};
const post = (body: unknown) => new Request("http://x/api/votes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a ranking goes in, the list keeps only the last 50, and one visitor can't flood it", async () => {
  const store = memory(), last = new Map<string, number>();
  for (let i = 0; i < KEEP + 5; i++) {
    const res = await handleVotes(post({ tiers: { a: "S", b: "C" }, comment: ` n${i} ` }), store, `ip${i}`, last, 1000 + i);
    expect(res.status).toBe(201);
  }
  const listed = ((await (await handleVotes(new Request("http://x/api/votes"), store, "me", last)).json()) as { votes: Vote[] }).votes;
  expect(listed).toHaveLength(KEEP);
  expect(listed[0]!.comment).toBe("n5");
  expect((await handleVotes(post({ tiers: { a: "A" } }), store, "ip3", last, 1010)).status).toBe(429);
  expect((await handleVotes(post({ tiers: { a: "A" } }), store, "ip3", last, 1010 + 15_000)).status).toBe(201);
});

test("bad ballots are refused", () => {
  expect(parseVote({ tiers: {} })).toBe("rank at least one feature");
  expect(parseVote({ tiers: { a: "D" } })).toContain("tier must be");
  expect(parseVote({ tiers: { "A B": "S" } })).toContain("bad feature id");
  expect(parseVote({ tiers: { a: "S" }, comment: "x".repeat(400) })).toEqual({ tiers: { a: "S" }, comment: "x".repeat(280) });
});

test("a cross-site form post (not JSON) is refused", async () => {
  const req = new Request("http://x/api/votes", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  expect((await handleVotes(req, memory(), "ip", new Map())).status).toBe(415);
});

test("the worker sends /api/votes to the object and everything else to the assets", async () => {
  const seen: string[] = [];
  const env = {
    ASSETS: { fetch: async (r: Request) => (seen.push(`asset ${new URL(r.url).pathname}`), new Response("page")) },
    VOTES: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => (seen.push(`votes ${r.method}`), Response.json({ votes: [] })) }) },
  };
  expect(await (await worker.fetch(new Request("http://x/latest/index.html"), env)).text()).toBe("page");
  expect((await worker.fetch(new Request("http://x/api/votes"), env)).headers.get("cache-control")).toContain("max-age=10");
  await worker.fetch(post({ tiers: { a: "S" } }), env);
  expect(seen).toEqual(["asset /latest/index.html", "votes GET", "votes POST"]);
});

test("the stage: tallest first, ties by the crowd's average, and the newest unseen vote plays next", () => {
  const features = ["a", "b", "c"].map((slug) => ({ slug, title: slug }));
  const votes = [{ id: "1", tiers: { a: "S", b: "C" } }, { id: "2", tiers: { b: "S", c: "A" } }, { id: "3", tiers: { c: "S" } }] as never[];
  expect(columns(features, votes[1], votes).map((c: { slug: string }) => c.slug)).toEqual(["b", "c", "a"]);
  expect(columns(features, null, votes).map((c: { slug: string }) => c.slug)).toEqual(["c", "b", "a"]); // nothing on stage: by the crowd average
  expect(nextIndex(votes, 0, new Set(["1", "2"]))).toBe(2);
  expect(nextIndex(votes, 2, new Set(["1", "2", "3"]))).toBe(0);
  expect(ballot({ S: ["a"], pool: ["b"], C: ["c"] })).toEqual({ a: "S", c: "C" });
});
