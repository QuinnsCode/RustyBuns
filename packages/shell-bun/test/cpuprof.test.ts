import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpuProfile, profRoute } from "../src/cpuprof.ts";

const SECRET = "a-long-enough-secret";
const BUSY = "const end = Date.now() + ms; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); return x;";
// A fresh busyWork per profile: once JSC tiers a function up, its samples can land
// on the caller or not at all, and the frame drops out of the profile (#641).
function freshBusyWork(i: number): (ms: number) => number {
  const f = new Function("ms", `/* ${i} */ ${BUSY}`) as (ms: number) => number;
  return Object.defineProperty(f, "name", { value: "busyWork" });
}

test("cpuProfile: samples, writes a .cpuprofile DevTools can open, keeps the newest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-prof-"));
  for (let i = 0; i < 3; i++) {
    // Busy once sampling has started: a timer set before then can fire too early
    // on a slow runner, as the inspector's posts are async.
    const busyWork = freshBusyWork(i);
    const { file } = await cpuProfile({ dir, ms: 80, keep: 2, onStart: () => busyWork(40) });
    const prof = JSON.parse(readFileSync(file, "utf8"));
    expect(prof.nodes.map((n: any) => n.callFrame.functionName)).toContain("busyWork");
    expect(prof.samples.length).toBe(prof.timeDeltas.length);
    expect(prof.endTime).toBeGreaterThan(prof.startTime);
    await Bun.sleep(5);
  }
  expect(readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"))).toHaveLength(2);
});

test("cpuProfile: one at a time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-prof-"));
  const first = cpuProfile({ dir, ms: 50 });
  await expect(cpuProfile({ dir, ms: 50 })).rejects.toThrow("already running");
  await first;
});

test("profRoute: off without a secret, 401 without it, 405 on GET, profile on POST", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-prof-"));
  const lines: string[] = [];
  const req = (method: string, auth?: string, path = "/__rb/prof?s=0.05") =>
    new Request("http://box" + path, { method, headers: auth ? { Authorization: auth } : {} });
  expect(await profRoute({ dir })(req("POST", `Bearer ${SECRET}`))).toBeNull();
  expect(await profRoute({ dir, secret: "short", log: (l) => lines.push(l) })(req("POST", "Bearer short"))).toBeNull();
  expect(lines[0]).toContain("under 16 characters");

  const route = profRoute({ dir, secret: SECRET, log: () => {} });
  expect(await route(req("POST", `Bearer ${SECRET}`, "/other"))).toBeNull();
  expect((await route(req("POST")))!.status).toBe(401);
  expect((await route(req("POST", `Bearer ${SECRET}x`)))!.status).toBe(401);
  expect((await route(req("GET", `Bearer ${SECRET}`)))!.status).toBe(405);
  const res = (await route(req("POST", `Bearer ${SECRET}`)))!;
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toMatch(/cpu-.*\.cpuprofile/);
  expect((await res.json()).nodes.length).toBeGreaterThan(0);
  expect(readdirSync(dir)).toHaveLength(1);
});
