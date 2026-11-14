import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@rustybuns/util/http";
import { Job, JobsReply, Refusal } from "../src/api.ts";
import { api } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { push } from "../src/sync.ts";
import { tick } from "../src/ticker.ts";

const at = (iso: string) => Date.parse(iso);
const root = mkdtempSync(join(tmpdir(), "cron-swanson-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("an app's own list: sync adds, changes and drops its jobs, keeps hand-made ones and pauses, and lists its Cloudflare crons", async () => {
  const store = new Store();
  let now = at("2026-11-14T08:59:30Z");
  const server = Bun.serve({ port: 0, fetch: api(store, { token: "t0k", now: () => now }) });
  afterAll(() => server.stop(true));
  const ask = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${server.url}${path.slice(1)}`, { method, headers: { authorization: "Bearer t0k" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: parseJson(await res.text()) };
  };
  const jobs = async () => JobsReply((await ask("GET", "/api/jobs")).body).jobs.map((r) => r.job).sort((a, b) => a.name.localeCompare(b.name));

  // The app folder: its own list (with a comment, as people write them) and a wrangler config with a cron trigger.
  const dir = join(root, "qcrm");
  mkdirSync(dir);
  const write = (list: unknown[]) => writeFileSync(join(dir, "cron-swanson.json"), `// qcrm's jobs\n${JSON.stringify({ jobs: list })}`);
  const backup = { key: "backup", name: "Back up the CRM", why: "In case D1 eats itself", cadence: { kind: "daily", time: "09:00" } };
  const digest = { key: "digest", name: "Weekly digest", tags: ["email"], cadence: { kind: "weekly", time: "08:00", days: [1] } };
  write([backup, digest]);
  writeFileSync(join(dir, "wrangler.jsonc"), `{ "name": "qcrm", /* hourly sweep */ "triggers": { "crons": ["0 * * * *"] } }`);

  // Someone already made one by hand for the same app.
  expect((await ask("POST", "/api/jobs", { app: "qcrm", name: "Renew the domain", tags: [], cadence: { kind: "yearly", time: "09:00", month: 3, day: 1 }, tz: "UTC", action: { kind: "remind" } })).status).toBe(201);

  const first = await push(server.url.href, dir, "t0k");
  expect(first).toEqual({ app: "qcrm", reply: { added: ["Back up the CRM", "Weekly digest", "Cloudflare cron trigger"], changed: [], removed: [], same: 0 } });
  expect((await jobs()).map((j) => [j.name, j.app, j.action.kind])).toEqual([
    ["Back up the CRM", "qcrm", "remind"],
    ["Cloudflare cron trigger", "qcrm", "elsewhere"],
    ["Renew the domain", "qcrm", "remind"],
    ["Weekly digest", "qcrm", "remind"],
  ]);

  // Again with nothing changed: nothing moves.
  expect((await push(server.url.href, dir, "t0k")).reply).toEqual({ added: [], changed: [], removed: [], same: 3 });

  // The Cloudflare cron sits in its lane with a next run, but the ticker never logs a run for it, and Run is refused.
  now = at("2026-11-14T09:00:00.250Z");
  const fired = await tick(store, now);
  const cf = (await jobs()).find((j) => j.action.kind === "elsewhere")!;
  expect(fired.map((r) => r.jobId)).not.toContain(cf.id);
  expect(cf.nextAt).toBe(at("2026-11-14T10:00:00Z"));
  const refused = await ask("POST", `/api/jobs/${cf.id}/run`);
  expect([refused.status, Refusal(refused.body).error]).toEqual([409, expect.stringContaining("Cloudflare")]);

  // Paused on the page, then the file changes: the digest moves to Friday (still paused), the backup is gone, a new one lands.
  const dig = Job((await jobs()).find((j) => j.key === "digest"));
  const { id: _i, key: _k, createdAt: _c, updatedAt: _u, anchor: _a, nextAt: _n, ...input } = dig;
  expect((await ask("PUT", `/api/jobs/${dig.id}`, { ...input, enabled: false })).status).toBe(200);
  write([{ ...digest, cadence: { kind: "weekly", time: "08:00", days: [5] } }, { key: "prune", name: "Prune old leads", cadence: { kind: "monthly", time: "03:00", day: -1 } }]);
  expect((await push(server.url.href, dir, "t0k")).reply).toEqual({ added: ["Prune old leads"], changed: ["Weekly digest"], removed: ["Back up the CRM"], same: 1 });
  const after = await jobs();
  expect(after.map((j) => j.name)).toEqual(["Cloudflare cron trigger", "Prune old leads", "Renew the domain", "Weekly digest"]);
  expect(after.find((j) => j.key === "digest")).toMatchObject({ enabled: false, nextAt: null, cadence: { days: [5] } });

  // A list that names one key twice, or a bad cadence, is refused whole and changes nothing.
  const full = { ...backup, tags: [], tz: "UTC", action: { kind: "remind" } };
  const twice = await ask("PUT", "/api/apps/qcrm/jobs", { jobs: [full, full] });
  expect([twice.status, Refusal(twice.body).error]).toEqual([400, "jobs: each key once"]);
  write([{ ...backup, cadence: { kind: "cron", expr: "0 9 * *" } }]);
  await expect(push(server.url.href, dir, "t0k")).rejects.toThrow("cadence.expr");
  expect((await jobs()).length).toBe(4);
});
