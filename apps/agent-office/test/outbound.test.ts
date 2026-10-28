import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logFile, parseCamera, record, recent } from "../live/camera.ts";
import { asksRoute, outboundRoute, pendingAsks } from "../live/floorguard.ts";
import { mayReach } from "../sandbox/proxy.ts";
import { boxRoute } from "../sandbox/server.ts";

let dir: string, office: ReturnType<typeof Bun.serve>;
const TOKEN = "t0ken";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rb-outbound-"));
  writeFileSync(path.join(dir, "box.json"), "{}");
  // the office's side of the proxy's question: the route the router hands /__rb/outbound to
  office = Bun.serve({ port: 0, async fetch(req) {
    const out = await outboundRoute(req.method, new URL(req.url), req.headers.get("authorization") ?? undefined, await req.json().catch(() => undefined), { token: TOKEN, dir, ms: 2000 });
    return Response.json(out?.body ?? { error: "no route" }, { status: out?.status ?? 404 });
  } });
});
afterEach(() => { office.stop(true); rmSync(dir, { recursive: true, force: true }); });

const ask = (host: string, list: string[] = ["github.com"]) => mayReach(host, 443, list, { url: `http://127.0.0.1:${office.port}/__rb/outbound`, token: TOKEN });
const answer = async (allow: boolean) => {
  while (!pendingAsks().length) await Bun.sleep(5);
  const [a] = pendingAsks();
  expect(a!.detail).toContain("let the box reach");
  asksRoute("POST", new URL(`http://x/__rb/asks/${a!.id}?allow=${allow ? 1 : 0}`), true);
};

test("an unlisted host is asked about, answered, and logged; a listed one is only logged", async () => {
  const yes = ask("registry.example.com");
  await answer(true);
  expect(await yes).toBe(true);
  const no = ask("evil.example.net");
  await answer(false);
  expect(await no).toBe(false);
  expect(await ask("github.com")).toBe(true); // no card for a listed host

  const state = await boxRoute(() => dir)("GET", new URL("http://x/__rb/box"));
  const seen = (state?.body as { log: { what: string; verdict: string }[] }).log.map((l) => `${l.what} ${l.verdict}`);
  expect(seen).toEqual(["github.com:443 listed", "evil.example.net:443 denied", "registry.example.com:443 allowed"]);
});

test("nobody answering turns the host down, and the office being unreachable does too", async () => {
  expect(await ask("slow.example.com")).toBe(false);
  expect(recent(logFile(dir), 5, parseCamera({}))[0]?.verdict).toBe("timed out");
  office.stop(true);
  expect(await ask("other.example.com")).toBe(false);
  expect(await ask("github.com")).toBe(true);
});

test("the log is a camera: it keeps to its size, drops the oldest first, and forgets what is past retention", () => {
  const file = logFile(dir), cam = parseCamera({ maxMb: 0.001, keepDays: 3 }); // about a kilobyte
  const day = 86_400_000, now = Date.now();
  for (let i = 0; i < 30; i++) record(file, { kind: "outbound", who: "box", what: `host${i}.example.com:443`, verdict: "allowed" }, cam, now + i);
  expect(readFileSync(file).length).toBeLessThanOrEqual(1049);
  const left = recent(file, 100, cam, now + 30).map((l) => l.what);
  expect(left[0]).toBe("host29.example.com:443"); // the newest survive
  expect(left).not.toContain("host0.example.com:443");

  const roomy = parseCamera({ keepDays: 3 }), fresh = path.join(dir, "retention.log");
  appendFileSync(fresh, `${JSON.stringify({ at: now - 4 * day, kind: "outbound", who: "box", what: "old.example.com:443", verdict: "allowed" })}\n`);
  record(fresh, { kind: "outbound", who: "box", what: "new.example.com:443", verdict: "denied" }, roomy, now);
  expect(recent(fresh, 10, roomy, now).map((l) => l.what)).toEqual(["new.example.com:443"]); // 3 days is the default
  expect(recent(fresh, 10, parseCamera({ keepDays: 30 }), now).map((l) => l.what)).toEqual(["new.example.com:443"]); // and the old line was dropped from disk
});

test("the box route saves the first-run answers", async () => {
  const route = boxRoute(() => dir);
  const saved = await route("POST", new URL("http://x/__rb/box?do=log&maxMb=50&keepDays=7"));
  expect((saved?.body as { perms: { log: unknown } }).perms.log).toEqual({ maxMb: 50, keepDays: 7 });
  expect((await route("POST", new URL("http://x/__rb/box?do=log&maxMb=50&keepDays=5")))?.status).toBe(400); // not one of the four choices
});

test("a first ask in a box whose log folder doesn't exist yet is still answered", async () => {
  const fresh = path.join(dir, "not-yet");
  const out = await outboundRoute("POST", new URL("http://x/__rb/outbound"), `Bearer ${TOKEN}`, { host: "github.com", port: 443, listed: true }, { token: TOKEN, dir: fresh, ms: 50 });
  expect(out?.status).toBe(200);
  expect(readFileSync(logFile(fresh), "utf8")).toContain("github.com:443");
});

test("three connections to one unlisted host at once raise one card, and the answer holds for the next", async () => {
  const three = Promise.all([ask("platform.claude.com"), ask("platform.claude.com"), ask("platform.claude.com")]);
  await answer(true);
  expect(await three).toEqual([true, true, true]);
  expect(pendingAsks()).toHaveLength(0);
  expect(await ask("platform.claude.com")).toBe(true);
});

test("Always on the card saves the host to the allowlist, so the next box start doesn't ask", async () => {
  const yes = ask("remember.example.com");
  while (!pendingAsks().length) await Bun.sleep(5);
  const [a] = pendingAsks();
  expect(a!.always).toContain("remember.example.com");
  asksRoute("POST", new URL(`http://x/__rb/asks/${a!.id}?allow=1&always=1`), true);
  expect(await yes).toBe(true);
  const state = await boxRoute(() => dir)("GET", new URL("http://x/__rb/box"));
  const perms = (state?.body as { perms: { allow: string[] }; from: string });
  expect(perms.from).toBe("box.json");
  expect(perms.perms.allow).toContain("remember.example.com");
  // a plain Allow stays a one-off
  const once = ask("oneoff.example.com");
  await answer(true);
  await once;
  const after = await boxRoute(() => dir)("GET", new URL("http://x/__rb/box"));
  expect((after?.body as { perms: { allow: string[] } }).perms.allow).not.toContain("oneoff.example.com");
});

test("the whole log can be asked for, not just the last 15", async () => {
  const cam = parseCamera({});
  for (let i = 0; i < 40; i++) record(logFile(dir), { kind: "outbound", who: "box", what: `h${i}.example.com:443`, verdict: "listed" }, cam);
  const route = boxRoute(() => dir);
  const n = async (q: string) => ((await route("GET", new URL(`http://x/__rb/box${q}`)))?.body as { log: unknown[] }).log.length;
  expect([await n(""), await n("?log=all")]).toEqual([15, 40]);
});
