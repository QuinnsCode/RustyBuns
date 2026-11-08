// scripts/release.ts: the plan checks against plans in Alchemy's own format (LoggingCli
// formatPlanLines, with the CLI's guard warnings), and the whole release against a fake Mac, one
// edge case each. Nothing here runs a command or touches Cloudflare.

import { describe, expect, test } from "bun:test";
import { checkPlan, parseAuthToken, release, Stop, type IO, type Mode, type Ran } from "../scripts/release.ts";

const plain: Mode = { checksNew: false };
const plan = (...lines: string[]) => lines.join("\n");
/** As `rustybuns plan` really prints it: Alchemy logs the plan through Effect, a prefix on every line; the CLI's own warnings are plain. */
const logged = (...lines: string[]) => lines.map((l) => l.startsWith("warning: ") || !l ? l : `[00:01:08.172] INFO (#1): ${l}`).join("\n");

// What a normal release prints: an update to the Worker, everything else noop.
const UPDATE = "building the worker: bun run build.ts\n" + logged("Plan: 1 to update", "[AGENT_SANDBOX] noop", "[DB] noop", "[Worker] update", "[Worker/DB] noop");

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

describe("parseAuthToken", () => {
  const TOKEN = "Xq3v8mN0pLkJ7hGfDsA1zYwTr5eB2cVuI9oP4n6M";
  test("reads `wrangler auth token --json`: JSON.stringify({ type, token }, null, 2), no banner", () => {
    expect(parseAuthToken(JSON.stringify({ type: "oauth", token: TOKEN }, null, 2) + "\n")).toBe(TOKEN);
  });
  test("not logged in: wrangler's error is no token", () => {
    expect(parseAuthToken("✘ [ERROR] Not logged in. Please run `wrangler login` to authenticate.\n")).toBeNull();
    expect(parseAuthToken("")).toBeNull();
  });
});

// ---- the release, on a fake Mac ----

const WHERE = { clone: "/c", wt: "/w", app: "apps/codesplitter", home: "/h" };
const STATES = "/c/.git/rustybuns/alchemy/apps/codesplitter/state";
const CONFIG = `BETTER_AUTH_URL: { type: "var", value: "https://codesplitter.example.dev" },`;

class Mac implements IO {
  calls: string[] = []; envs: Record<string, string | undefined>[] = []; said: string[] = []; asked: string[] = [];
  touched: string[] = [];
  files = new Set(["/w", STATES, "/Applications/Docker.app", "/h/.codesplitters-checks-on"]);
  answers: boolean[] = [];
  head = "a"; main = "a";
  status = "";
  plans = [UPDATE];
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
    return ok();
  }
  async ask(q: string) { this.asked.push(q); return this.answers.shift() ?? false; }
  say(l: string) { this.said.push(l); }
  async sleep() {}
  exists(p: string) { return this.files.has(p); }
  read() { return CONFIG; }
  touch(p: string) { this.touched.push(p); }
  async get() { return { status: 200, body: "{}" }; }
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

  test("a Docker that never answers stops with how to restart it, before the plan", async () => {
    const mac = new Mac(); mac.codes.docker = [124];
    await stopsWith(go(mac), "Quit Docker Desktop");
    expect(mac.ran(/rustybuns plan/)).toEqual([]);
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
