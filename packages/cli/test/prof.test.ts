import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxUrl, fetchProfile, secretProblem } from "../src/prof.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { profRoute } from "../../shell-bun/src/cpuprof.ts";

const SECRET = "a-long-enough-secret";
const box = (bindings: any = {}, extra: any = {}) => ({ name: "b", bindings, targets: { box: { provider: "railway" } }, ...extra }) as any;

test("boxUrl: reads the Service's url from project state, null before a deploy", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-profcli-"));
  const cfg = { name: "b", state: "project" as const };
  expect(boxUrl(dir, cfg, "live_me")).toBeNull();
  mkdirSync(join(dir, ".alchemy/state/b/live_me"), { recursive: true });
  writeFileSync(join(dir, ".alchemy/state/b/live_me/Service.json"), JSON.stringify({ attr: { url: "https://b.up.railway.app/" } }));
  expect(boxUrl(dir, cfg, "live_me")).toBe("https://b.up.railway.app");
});

test("secretProblem: says what to add, short secrets refused", () => {
  expect(secretProblem(box(), SECRET)).toBeNull();
  expect(secretProblem(box(), "short")).toContain("under 16 characters");
  expect(secretProblem(box(), undefined)).toContain('RB_PROF_SECRET: { type: "secret", boxOnly: true }');
  expect(secretProblem(box({}, { experimental: { wheel: "human" } }), undefined)).toContain('op: "op://');
  expect(secretProblem(box({ RB_PROF_SECRET: { type: "secret" } }), undefined)).toContain("has no value here");
});

test("boxOnly secrets go to the box, not the Worker", () => {
  const stack = generateAlchemy({
    name: "b", worker: { main: "src/w.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [] },
    bindings: { RB_PROF_SECRET: { type: "secret", boxOnly: true }, API_KEY: { type: "secret" } },
    targets: { edge: { provider: "cloudflare" }, box: { provider: "railway" } },
  } as any);
  expect(stack).toContain('API_KEY: Config.redacted("API_KEY")');
  expect(stack).not.toContain('RB_PROF_SECRET: Config.redacted');
  expect(stack).toContain('RB_PROF_SECRET: process.env["RB_PROF_SECRET"] ?? ""');
});

test("fetchProfile: end to end against the box's route", async () => {
  const route = profRoute({ secret: SECRET, dir: mkdtempSync(join(tmpdir(), "rb-profbox-")), log: () => {} });
  const server = Bun.serve({ port: 0, fetch: async (req) => (await route(req)) ?? new Response("<html>app</html>", { headers: { "content-type": "text/html" } }) });
  const url = `http://localhost:${server.port}`, outDir = mkdtempSync(join(tmpdir(), "rb-profout-"));
  try {
    const file = await fetchProfile({ url, secret: SECRET, seconds: 0.05, outDir, name: "b" });
    expect(file).toMatch(/b-.*\.cpuprofile$/);
    expect(JSON.parse(readFileSync(file, "utf8")).nodes.length).toBeGreaterThan(0);
    await expect(fetchProfile({ url, secret: SECRET + "x", seconds: 0.05, outDir, name: "b" })).rejects.toThrow("refused the secret");
  } finally { server.stop(true); }
  // A box without the secret: the app answers, so there's no route.
  const off = profRoute({ dir: outDir });
  const bare = Bun.serve({ port: 0, fetch: async (req) => (await off(req)) ?? new Response("<html>app</html>", { headers: { "content-type": "text/html" } }) });
  try {
    await expect(fetchProfile({ url: `http://localhost:${bare.port}`, secret: SECRET, seconds: 0.05, outDir, name: "b" })).rejects.toThrow("has no /__rb/prof");
  } finally { bare.stop(true); }
});
