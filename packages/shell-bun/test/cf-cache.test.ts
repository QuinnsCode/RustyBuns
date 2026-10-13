import { test, expect } from "bun:test";
import { cfCachedFetch } from "../src/cf-cache.ts";

function origin(make: (n: number) => Response = (n) => new Response(`call ${n}`)) {
  const calls: string[] = [];
  const base = (async (input: any, init?: any) => { calls.push(`${init?.method ?? "GET"} ${String(input)}`); return make(calls.length); }) as typeof fetch;
  return { base, calls };
}

test("cf.cacheTtl: the same GET within the TTL is one outbound call; after it, a fresh one", async () => {
  const { base, calls } = origin();
  let t = 0;
  const f = cfCachedFetch(base, () => t);
  const get = () => f("https://api.github.com/repos/redwoodjs/sdk", { cf: { cacheTtl: 60 } } as any).then((r) => r.text());
  expect(await get()).toBe("call 1");
  expect(await get()).toBe("call 1");
  t = 59_000;
  expect(await get()).toBe("call 1");
  t = 60_000;
  expect(await get()).toBe("call 2");
  expect(calls.length).toBe(2);
});

test("200 concurrent renders make one call", async () => {
  const { base, calls } = origin();
  const f = cfCachedFetch(base);
  const bodies = await Promise.all(Array.from({ length: 200 }, () => f("https://x.test/a", { cf: { cacheTtl: 14400 } } as any).then((r) => r.text())));
  expect(new Set(bodies)).toEqual(new Set(["call 1"]));
  expect(calls.length).toBe(1);
});

test("no cf, a POST, cacheTtl 0, or an error status: straight through every time", async () => {
  const { base, calls } = origin((n) => new Response("x", { status: n > 6 ? 403 : 200 }));
  const f = cfCachedFetch(base);
  for (let i = 0; i < 2; i++) await f("https://x.test/plain");
  for (let i = 0; i < 2; i++) await f("https://x.test/post", { method: "POST", body: "b", cf: { cacheTtl: 60 } } as any);
  for (let i = 0; i < 2; i++) await f("https://x.test/zero", { cf: { cacheTtl: 0 } } as any);
  for (let i = 0; i < 2; i++) expect((await f("https://x.test/limited", { cf: { cacheTtl: 60 } } as any)).status).toBe(403);
  expect(calls.length).toBe(8);
});

test("cacheEverything alone honours the response's max-age; method is part of the key", async () => {
  const { base, calls } = origin((n) => new Response(`v${n}`, { headers: { "cache-control": "public, max-age=30" } }));
  const f = cfCachedFetch(base);
  const opts = { cf: { cacheEverything: true } } as any;
  expect(await (await f("https://x.test/e", opts)).text()).toBe("v1");
  expect(await (await f("https://x.test/e", opts)).text()).toBe("v1");
  expect((await f("https://x.test/e", { ...opts, method: "HEAD" })).status).toBe(200);
  expect(calls).toEqual(["GET https://x.test/e", "HEAD https://x.test/e"]);
  expect((await f(new Request("https://x.test/e"), opts)).headers.get("cache-control")).toBe("public, max-age=30");
  expect(calls.length).toBe(2);
});
