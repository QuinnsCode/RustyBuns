// scripts/release.ts: the plan checks against plans in Alchemy's own format (LoggingCli
// formatPlanLines, with the CLI's guard warnings), and the whole release against a fake Mac, one
// edge case each. Nothing here runs a command or touches Cloudflare.

import { describe, expect, test } from "bun:test";
import { checkPlan, release, Stop, type IO, type Mode, type Ran } from "../scripts/release.ts";

const plain: Mode = { checksNew: false, move: false };
const move: Mode = { checksNew: false, move: true };
const plan = (...lines: string[]) => lines.join("\n");
/** As `rustybuns plan` really prints it: Alchemy logs the plan through Effect, a prefix on every line; the CLI's own warnings are plain. */
const logged = (...lines: string[]) => lines.map((l) => l.startsWith("warning: ") || !l ? l : `[00:01:08.172] INFO (#1): ${l}`).join("\n");

// What a normal release prints: an update to the Worker, everything else noop.
const UPDATE = "building the worker: bun run build.ts\n" + logged("Plan: 1 to update", "[AGENT_SANDBOX] noop", "[DB] noop", "[Worker] update", "[Worker/DB] noop");
// #825: the five renamed resources replaced, the CLI warning that they're deleted.
const MOVE_WARNING = "warning: this deploy would delete D1 DB (codesplitters-db, renamed to codesplitter-db), Queue HOOKS (codesplitters-hooks, renamed to codesplitter-hooks), " +
  "Queue JOBS (codesplitters-jobs, renamed to codesplitter-jobs), Queue LEVEL_DIGS (codesplitters-level-digs, renamed to codesplitter-level-digs), " +
  "R2 LEVEL_CHUNKS (codesplitters-level-chunks, renamed to codesplitter-level-chunks), and the data in them. If they were added on a branch this one lacks, rebase first; to delete on purpose, pass --allow-delete.";
const MOVE = logged(MOVE_WARNING, "", "Plan: 1 to update, 5 to replace, 4 binding changes",
  "[DB] replace", "[HOOKS] replace", "[JOBS] replace", "[LEVEL_CHUNKS] replace", "[LEVEL_DIGS] replace",
  "[Worker] update", "[Worker/DB] update", "[Worker/HOOKS] update", "[Worker/JOBS] update", "[Worker/LEVEL_DIGS] update");

// The owner's first run after #841, word for word: the move not run yet, under a plain release.
const REAL = `[00:01:08.172] INFO (#1): Plan: 5 to update, 5 to replace, 7 binding changes
[00:01:08.172] INFO (#1): [Build] update
[00:01:08.172] INFO (#1): [DB] replace
[00:01:08.172] INFO (#1): [HOOKS] replace
[00:01:08.172] INFO (#1): [HOOKSConsumer] update
[00:01:08.172] INFO (#1): [JOBS] replace
[00:01:08.172] INFO (#1): [JOBSConsumer] update
[00:01:08.172] INFO (#1): [LEVEL_CHUNKS] replace
[00:01:08.172] INFO (#1): [LEVEL_DIGS] replace
[00:01:08.172] INFO (#1): [LEVEL_DIGSConsumer] update
[00:01:08.172] INFO (#1): [Worker] update
[00:01:08.172] INFO (#1): [Worker/AGENT_SANDBOX] update
[00:01:08.172] INFO (#1): [Worker/DB] update
[00:01:08.172] INFO (#1): [Worker/DEPLOY_RUNNER] update
[00:01:08.172] INFO (#1): [Worker/HOOKS] update
[00:01:08.172] INFO (#1): [Worker/JOBS] update
[00:01:08.172] INFO (#1): [Worker/LEVEL_CHUNKS] update
[00:01:08.172] INFO (#1): [Worker/LEVEL_DIGS] update`;

describe("the real plan", () => {
  test("is read through Effect's log prefix, rows and summary alike", () => {
    const v = checkPlan(REAL, move);
    expect(v.stop).toBeNull();
    expect(v.show[0]).toBe("Plan: 5 to update, 5 to replace, 7 binding changes");
    expect(v.show).toContain("[DB] replace");
  });

});

describe("checkPlan", () => {

  test("a release that only updates goes out, and noops aren't shown", () => {
    const v = checkPlan(UPDATE, plain);
    expect(v.stop).toBeNull();
    expect(v.show).toEqual(["Plan: 1 to update", "[Worker] update"]);
  });

  test("no summary stops it", () => expect(checkPlan("building the worker\nerror: boom", plain).stop).toContain("no summary"));

  test("a new setting on the Worker is free; a new resource isn't", () => {
    expect(checkPlan(plan("Plan: 1 to update", "[Worker] update", "[Worker/PRIVACY_EMAIL] create"), plain).stop).toBeNull();
    expect(checkPlan(plan("Plan: 1 to create", "[VECTORS] create"), plain).stop).toContain("[VECTORS] create");
    expect(checkPlan(plan("Plan: 1 to adopted", "[DB] adopted"), plain).stop).toContain("[DB] adopted");
  });

  test("deletes, replaces, orphans, unbinds and drops stop it", () => {
    for (const row of ["[FILES] delete", "[Worker] replace", "[JOBS] orphaned", "[Worker/CI_RUNNER] unbind", "[Migrate] drop [action]"])
      expect(checkPlan(plan("Plan: 1 to update", row), plain).stop).toContain(row);
  });

});

// ---- the release, on a fake Mac ----

const WHERE = { clone: "/c", wt: "/w", app: "apps/codesplitter", home: "/h" };
const STATES = "/c/.git/rustybuns/alchemy/apps/codesplitter/state";
const CONFIG = `BETTER_AUTH_URL: { type: "var", value: "https://codesplitter.example.dev" },`;

class Mac implements IO {
  calls: string[] = []; envs: Record<string, string | undefined>[] = []; said: string[] = []; asked: string[] = [];
  touched: string[] = []; renamed: [string, string][] = [];
  files = new Set(["/w", STATES, "/Applications/Docker.app", "/h/.codesplitters-checks-on"]);
  answers: boolean[] = [];
  head = "a"; main = "a";
  status = "";
  plans = [UPDATE];
  levels = [23, 23];
  /** Exit codes per command, in turn (the last repeats); 0 when none. */
  codes: Record<string, number[]> = {};
  /** Runs before the command answers: main moving, a login landing. */
  hooks: [RegExp, (mac: Mac) => void][] = [];
  loggedIn = true;

  private next(key: string) { const q = this.codes[key]; if (!q?.length) return 0; return q.length > 1 ? q.shift()! : q[0]!; }
  async run(cmd: string[], opts: { env?: Record<string, string | undefined> } = {}): Promise<Ran> {
    const c = cmd.join(" ");
    this.calls.push(c); this.envs.push(opts.env ?? {});
    for (const [re, f] of this.hooks) if (re.test(c)) f(this);
    const ok = (out = ""): Ran => ({ code: 0, out });
    if (c === "op vault list") return { code: this.next("op"), out: "" };
    if (c === "docker info") return { code: this.next("docker"), out: "" };
    if (c.endsWith("wrangler whoami")) return ok(this.loggedIn ? "account c2d417e655e0ef55de8fe2d07874f521" : "You are not logged in");
    if (c.endsWith("wrangler auth token --json")) return ok(this.loggedIn ? JSON.stringify({ type: "oauth", token: "x".repeat(40) }, null, 2) : "");
    if (c.includes("wrangler login")) { this.loggedIn = true; return ok(); }
    if (c.startsWith("bun -e")) return ok("account:read workers:write");
    if (c.includes("git -C /w status --porcelain")) return ok(this.status);
    if (c === "git -C /w checkout -q --detach origin/main") { this.head = this.main; return ok(); }
    if (c === "git -C /w rev-parse HEAD") return ok(this.head);
    if (c === "git -C /c rev-parse origin/main") return ok(this.main);
    if (c.startsWith("bunx rustybuns plan")) { const p = this.plans.length > 1 ? this.plans.shift()! : this.plans[0]!; return ok(p); }
    if (c.startsWith("bunx rustybuns deploy")) return { code: this.next("deploy"), out: "" };
    if (c === "bun scripts/move-resources.ts --copy") return { code: this.next("copy"), out: "" };
    if (c === "bun scripts/move-resources.ts") return { code: this.next("dry"), out: "" };
    return ok();
  }
  async ask(q: string) { this.asked.push(q); return this.answers.shift() ?? false; }
  say(l: string) { this.said.push(l); }
  async sleep() {}
  exists(p: string) { return this.files.has(p); }
  read() { return CONFIG; }
  touch(p: string) { this.touched.push(p); }
  rename(a: string, b: string) { this.renamed.push([a, b]); this.files.delete(a); this.files.add(b); }
  async get(url: string) {
    if (url.endsWith("/api/levels")) { const n = this.levels.length > 1 ? this.levels.shift()! : this.levels[0]!; return { status: 200, body: JSON.stringify(Array.from({ length: n }, () => ({ status: "ready" }))) }; }
    return { status: 200, body: "{}" };
  }
  ran(re: RegExp) { return this.calls.filter((c) => re.test(c)); }
  at(re: RegExp) { return this.calls.findIndex((c) => re.test(c)); }
}

const go = (mac: Mac, mode: Mode = plain, env: Record<string, string | undefined> = {}) => release(mac, mode, WHERE, env);
const stopsWith = async (p: Promise<unknown>, text: string) => {
  const e = await p.then(() => null, (e) => e);
  expect(e).toBeInstanceOf(Stop);
  expect((e as Error).message).toContain(text);
};

describe("release", () => {
  test("a plain release: sync, plan, ask, deploy, check the site; checks stay on", async () => {
    const mac = new Mac(); mac.answers = [true];
    const r = await go(mac, plain, { CLOUDFLARE_API_TOKEN: "stale-from-the-terminal" });
    expect(r.site).toBe("https://codesplitter.example.dev");
    expect(mac.ran(/rustybuns deploy/)).toEqual(["bunx rustybuns deploy --yes"]);
    const deployEnv = mac.envs[mac.at(/rustybuns deploy/)]!;
    expect(deployEnv).toMatchObject({ CODESPLITTER_CHECKS: "1", CODESPLITTER_DEPLOYS: "1", CODESPLITTER_AGENTS: "1", CODESPLITTER_PUSH_EVENTS: "1", CLOUDFLARE_API_TOKEN: "x".repeat(40) });
    // The token left in the terminal never reaches wrangler's login check.
    expect(mac.envs[mac.at(/wrangler whoami/)]!.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(mac.ran(/move-resources/)).toEqual([]);
    // Warned up front that a y/N follows the plan.
    expect(mac.said[0]).toContain("then asks y/N before deploying");
  });

  test("the files plan regenerated are put back before syncing; anything else stops it", async () => {
    const mac = new Mac(); mac.answers = [true];
    mac.status = " M apps/codesplitter/wrangler.jsonc\n";
    await go(mac);
    expect(mac.calls).toContain("git -C /w checkout -q -- apps/codesplitter/wrangler.jsonc apps/codesplitter/.env.schema");
    mac.status = " M apps/codesplitter/src/api.ts\n";
    await stopsWith(go(mac), "local changes (apps/codesplitter/src/api.ts)");
  });

  test("a risky plan stops before the question", async () => {
    const mac = new Mac(); mac.plans = [plan("Plan: 1 to delete", "[FILES] delete")];
    await stopsWith(go(mac), "[FILES] delete");
    expect(mac.asked).toEqual([]);
  });

  test("main moving while you read: sync, plan and ask again", async () => {
    const mac = new Mac(); mac.answers = [true, true];
    let fetches = 0;
    mac.hooks.push([/git -C \/c fetch/, (m) => { if (++fetches === 2) m.main = "b"; }]);
    await go(mac);
    expect(mac.asked).toHaveLength(2);
    expect(mac.ran(/rustybuns plan/)).toHaveLength(2);
    expect(mac.ran(/rustybuns deploy/)).toHaveLength(1);
  });

  test("a plan that says HEAD is behind syncs and plans again", async () => {
    const mac = new Mac(); mac.answers = [true];
    mac.plans = [plan("warning: HEAD is 1 commit behind origin/main, and this is a live site", UPDATE), UPDATE];
    await go(mac);
    expect(mac.ran(/rustybuns plan/)).toHaveLength(2);
  });

  test("a failed deploy with main where it was stops and says so", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.codes.deploy = [1];
    await stopsWith(go(mac), "the deploy failed");
  });

});

describe("release --move", () => {
  const moving = () => { const m = new Mac(); m.plans = [MOVE]; m.answers = [true, true]; return m; };

  test("reads, asks about the queues, plans, asks, and only then copies and deploys at once", async () => {
    const mac = moving();
    mac.files.add(`${STATES}/codesplitters`);
    await go(mac, move);
    expect(mac.renamed).toEqual([[`${STATES}/codesplitters`, `${STATES}/codesplitter`]]);
    const order = [/linkSharedState/, /move-resources.ts$/, /dash.cloudflare.com/, /rustybuns plan/, /move-resources.ts --copy/, /rustybuns deploy/].map((re) => mac.at(re));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mac.asked).toHaveLength(2);
    expect(mac.asked[1]).toContain("Copy the data and deploy");
    // Nothing but the deploy between the copy and the deploy.
    expect(mac.at(/rustybuns deploy/)).toBe(mac.at(/move-resources.ts --copy/) + 1);
    expect(mac.ran(/rustybuns deploy/)).toEqual(["bunx rustybuns deploy --yes --allow-delete"]);
    expect(mac.said.join("\n")).toContain("23 ready levels, as before");
  });

});
