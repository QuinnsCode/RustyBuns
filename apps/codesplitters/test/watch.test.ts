import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import worker from "../src/worker.ts";
import { changedSince, hitsIn, malFrom, scheduledWatch, STATUS_PAGES } from "../src/watch.ts";

// End to end with real git and an in-process D1: a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

/** OSV entries: a whole package that's malicious, and a hijacked release of a good one. */
const EVIL = { id: "MAL-2026-1", summary: "Malicious code in evil-pkg (npm)", affected: [{ package: { ecosystem: "npm", name: "evil-pkg" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }] };
const CHALK = { id: "MAL-2026-2", summary: "Malicious code in chalk (npm)", affected: [{ package: { ecosystem: "npm", name: "chalk" }, versions: ["5.6.1"] }] };
const DEBUG = { id: "MAL-2026-3", summary: "Malicious code in debug (npm)", affected: [{ package: { ecosystem: "npm", name: "debug" }, versions: ["4.4.2"] }] };

test("malFrom: a whole package, listed versions, and a withdrawn entry", () => {
  expect(malFrom(EVIL)).toEqual([{ id: "MAL-2026-1", name: "evil-pkg", summary: EVIL.summary, versions: null }]);
  expect(malFrom(CHALK)).toEqual([{ id: "MAL-2026-2", name: "chalk", summary: CHALK.summary, versions: ["5.6.1"] }]);
  expect(malFrom({ ...CHALK, withdrawn: "2026-10-10T00:00:00Z" })).toEqual([]);
  expect(malFrom({ ...CHALK, affected: [{ package: { ecosystem: "PyPI", name: "chalk" }, versions: ["1"] }] })).toEqual([]);
});

test("hitsIn: a range that could install a poisoned version is a hit, whatever its floor", () => {
  const mal = new Map([...malFrom(EVIL), ...malFrom(CHALK)].map((m) => [m.name, [m]]));
  const pkg = (deps: Record<string, string>) => new Map([["package.json", { pkg: { dependencies: deps } }]]);
  expect(hitsIn(pkg({ chalk: "^5.0.0" }), mal).map((h) => h.id)).toEqual(["MAL-2026-2"]);   // floor 5.0.0 is clean, the range isn't
  expect(hitsIn(pkg({ chalk: "5.6.0" }), mal)).toEqual([]);                                  // pinned below it
  expect(hitsIn(pkg({ chalk: "^4.1.2" }), mal)).toEqual([]);                                 // another major
  expect(hitsIn(pkg({ chalk: "latest" }), mal).length).toBe(1);                              // can't say: count it
  expect(hitsIn(pkg({ "evil-pkg": "1.0.0" }), mal).length).toBe(1);
  expect(hitsIn(pkg({ "evil-pkg": "workspace:*" }), mal)).toEqual([]);                       // the repo's own
});

/** A body that arrives in small chunks, as a big download would. */
const chunked = (text: string) => new Response(new ReadableStream({
  start(c) { for (let i = 0; i < text.length; i += 7) c.enqueue(new TextEncoder().encode(text.slice(i, i + 7))); c.close(); },
}));

test("changedSince: reads down to where it stopped, MAL ids only, oldest first", async () => {
  const csv = [`${iso(1)},MAL-2026-3`, `${iso(2)},GHSA-aaaa`, `${iso(3)},MAL-2026-2`, `${iso(5)},MAL-2026-1`].join("\n") + "\n";
  const got = await changedSince((async () => chunked(csv)) as unknown as typeof fetch, iso(4));
  expect(got).toEqual({ ids: ["MAL-2026-2", "MAL-2026-3"], upTo: iso(1) });
  expect((await changedSince((async () => chunked(csv)) as unknown as typeof fetch, iso(1))).ids).toEqual([]);
});

/** A fake internet: the status pages (OpenAI's down), OSV's list and its entries. */
function internet(csv: () => string, entries: Record<string, unknown>) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v2/status.json")) {
      if (url.includes("openai")) return new Response("nope", { status: 503 });
      return Response.json({ status: url.includes("claude") ? { indicator: "minor", description: "Partially Degraded Service" } : { indicator: "none", description: "All Systems Operational" } });
    }
    if (url.endsWith("modified_id.csv")) return chunked(csv());
    const id = decodeURIComponent(url.split("/vulns/")[1] ?? "");
    return id in entries ? Response.json(entries[id]) : new Response("{}", { status: 404 });
  }) as typeof fetch;
}

test("the cron: status lines, and every repo checked against new advisories, doctor or not", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  let csv = [`${iso(3)},MAL-2026-2`, `${iso(5)},MAL-2026-1`, `${iso(24 * 30)},MAL-2025-9`].join("\n");
  call.env.WATCH_FETCH = internet(() => csv, { "MAL-2026-1": EVIL, "MAL-2026-2": CHALK, "MAL-2026-3": DEBUG });
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: JSON.stringify({ workspaces: ["web"], dependencies: { chalk: "^5.3.0", debug: "^4.3.0" } }, null, 2) });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "web/package.json", content: JSON.stringify({ name: "web", devDependencies: { "evil-pkg": "^2.0.0" } }, null, 2) });
  const self = (r: Request) => worker.fetch(r, call.env);

  await scheduledWatch(call.env, self, NOW);
  const w = await (await call("ryan", "/api/watch")).json();
  expect(w.status.map((s: any) => [s.name, s.indicator])).toEqual([["Anthropic", "minor"], ["OpenAI", "unknown"], ["GitHub", "none"], ["npm", "none"], ["Cloudflare", "none"]]);
  expect(w.status.length).toBe(STATUS_PAGES.length);
  // The doctor was never turned on; the week-old cutoff leaves the month-old entry out.
  expect(w.hits.map((h: any) => [h.path, h.name, h.id]).sort()).toEqual([["package.json", "chalk", "MAL-2026-2"], ["web/package.json", "evil-pkg", "MAL-2026-1"]]);
  const deps = await (await call("ryan", "/api/repos/ryan/lab/deps")).json();
  expect(deps.malicious.length).toBe(2);
  // Hits are the owner's; anyone sees the status lines.
  const anon = await (await call(null, "/api/watch")).json();
  expect(anon).toMatchObject({ hits: [] });
  expect(anon.status.length).toBe(5);

  // A new one an hour later, for debug: the sweep runs again, and the first hits keep their time.
  csv = `${iso(-1)},MAL-2026-3\n` + csv;
  await scheduledWatch(call.env, self, NOW + 3_600_000);
  const later = (await (await call("ryan", "/api/watch")).json()).hits;
  expect(later.map((h: any) => h.name).sort()).toEqual(["chalk", "debug", "evil-pkg"]);
  expect(later.find((h: any) => h.name === "chalk").found_at).toBe(NOW);

  // Dropping a dependency clears its hit at the next sweep; withdrawing an advisory clears it too.
  const web = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=web/package.json")).json();
  const ops = web.lines.filter((l: any) => l.text.includes("evil-pkg")).map((l: any) => ({ kind: "delete", line: l.id, base: l.rev }));
  expect((await send("ryan", "/api/repos/ryan/lab/do/ops?path=web/package.json", { ops })).ok).toBe(true);
  call.env.WATCH_FETCH = internet(() => `${iso(-2)},MAL-2026-2\n` + csv, { "MAL-2026-2": { ...CHALK, withdrawn: iso(-2) } });
  await scheduledWatch(call.env, self, NOW + 2 * 3_600_000);
  expect((await (await call("ryan", "/api/watch")).json()).hits.map((h: any) => h.name)).toEqual(["debug"]);
});

test("a sweep out of time picks up where it stopped next hour", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  call.env.WATCH_FETCH = internet(() => `${iso(1)},MAL-2026-1\n`, { "MAL-2026-1": EVIL });
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  for (const name of ["a", "b"]) {
    await send("ryan", "/api/repos", { name, visibility: "public" });
    await send("ryan", `/api/repos/ryan/${name}/files`, { path: "package.json", content: JSON.stringify({ dependencies: { "evil-pkg": "1.0.0" } }) });
  }
  const self = (r: Request) => worker.fetch(r, call.env);
  await scheduledWatch(call.env, self, NOW, 0);   // no time at all
  expect((await (await call("ryan", "/api/watch")).json()).hits).toEqual([]);
  await scheduledWatch(call.env, self, NOW + 3_600_000);   // nothing new, but the sweep goes on
  expect((await (await call("ryan", "/api/watch")).json()).hits.map((h: any) => h.repo).sort()).toEqual(["a", "b"]);
});
