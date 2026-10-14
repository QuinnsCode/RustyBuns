// scripts/release.ts: the plan checks against plans in Alchemy's own format (LoggingCli
// formatPlanLines, with the CLI's guard warnings), and the whole release against a fake Mac, one
// edge case each. Nothing here runs a command or touches Cloudflare.

import { describe, expect, test } from "bun:test";
import { checkPlan, deleteItems, dirtyFiles, main, MOVE_PENDING, NeedsMove, notifyCmd, kvBindings, parseArgs, readyLevels, realIO, release, Stop, type IO, type Mode, type Ran } from "../scripts/release.ts";

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

  test("under a plain release, it's the move still to do, said as that", () => {
    expect(checkPlan(REAL, plain)).toMatchObject({ stop: MOVE_PENDING, move: true });
    expect(checkPlan(MOVE_WARNING + "\n" + REAL, plain)).toMatchObject({ move: true });
  });

  test("anything risky besides the renames is a plain stop, not the move", () => {
    for (const extra of ["[FILES] delete", "[Worker] replace", "[DB/X] replace", "[VECTORS] create"]) {
      const v = checkPlan(REAL + `\n[00:01:08.172] INFO (#1): ${extra}`, plain);
      expect(v.move).toBeUndefined();
      expect(v.stop).not.toBeNull();
    }
    const v = checkPlan(MOVE_WARNING.replace(", and the data in them", ", Durable Object class CiRunner, and the data in them") + "\n" + REAL, plain);
    expect(v.move).toBeUndefined();
    expect(v.stop).toContain("CiRunner");
  });

  test("a plain update isn't the move", () => expect(checkPlan(UPDATE, plain).move).toBeUndefined());
});

describe("checkPlan", () => {
  test("plans without Effect's prefix still read", () => {
    expect(checkPlan(plan("Plan: 1 to update", "[Worker] update"), plain).stop).toBeNull();
    expect(checkPlan(plan("Plan: 1 to delete", "[FILES] delete"), plain).stop).toContain("[FILES] delete");
  });

  test("a release that only updates goes out, and noops aren't shown", () => {
    const v = checkPlan(UPDATE, plain);
    expect(v.stop).toBeNull();
    expect(v.show).toEqual(["Plan: 1 to update", "[Worker] update"]);
  });

  test("Alchemy's colors don't hide anything", () => {
    const colored = "\x1b[1mPlan:\x1b[0m 1 to delete\n\x1b[38;5;75m[FILES]\x1b[0m \x1b[31mdelete\x1b[0m";
    expect(checkPlan(colored, plain).stop).toContain("[FILES] delete");
  });

  test("no summary stops it", () => expect(checkPlan("building the worker\nerror: boom", plain).stop).toContain("no summary"));

  test("a new setting on the Worker is free; a new resource isn't", () => {
    expect(checkPlan(plan("Plan: 1 to update", "[Worker] update", "[Worker/PRIVACY_EMAIL] create"), plain).stop).toBeNull();
    expect(checkPlan(plan("Plan: 1 to create", "[VECTORS] create"), plain).stop).toContain("[VECTORS] create");
    expect(checkPlan(plan("Plan: 1 to adopted", "[DB] adopted"), plain).stop).toContain("[DB] adopted");
  });

  // The owner's release on 2026-10-12, the first after #1241 gave fix tasks a FIXES queue of their own.
  test("a new KV namespace goes to the y/N; a KV delete or another new resource still stops it", () => {
    expect(kvBindings('  STATS: { type: "kv" },\n  DB: { type: "d1" },')).toEqual(["STATS"]);
    const v = checkPlan(logged("Plan: 1 to create, 3 to update, 4 binding changes", "[Build] update", "[DB] update", "[STATS] create", "[Worker] update", "[Worker/STATS] create"), plain);
    expect(v.stop).toBeNull();
    expect(v.show).toContain("[STATS] create");
    expect(checkPlan(plan("Plan: 2 to create", "[STATS] create", "[Worker/STATS] create", "[NEWDB] create"), plain).stop).toContain("[NEWDB] create");
    expect(checkPlan(plan("Plan: 1 to delete", "[STATS] delete"), plain).stop).toContain("[STATS] delete");
  });

  test("a new queue with its consumer goes to the y/N; a consumer alone or another new resource still stops it", () => {
    const real = logged("Plan: 2 to create, 6 to update, 3 to replace, 4 binding changes", "[AGENT_SANDBOX] update", "[Build] update", "[CI_RUNNER] update",
      "[DB] update", "[DEPLOY_RUNNER] update", "[FIXES] create", "[FIXESConsumer] create", "[HOOKSConsumer] replace", "[JOBSConsumer] replace",
      "[LEVEL_DIGSConsumer] replace", "[Worker] update", "[Worker/AGENT_SANDBOX] update", "[Worker/CI_RUNNER] update",
      "[Worker/DEPLOY_RUNNER] update", "[Worker/FIXES] create");
    const v = checkPlan(real, plain);
    expect(v.stop).toBeNull();
    expect(v.show).toContain("[FIXES] create");
    expect(checkPlan(plan("Plan: 1 to create", "[FIXESConsumer] create"), plain).stop).toContain("[FIXESConsumer] create");
    expect(checkPlan(plan("Plan: 2 to create", "[FIXES] create", "[VECTORS] create"), plain).stop).toContain("[VECTORS] create");
  });

  // The owner's release on 2026-10-13, after the #825 move left the consumers on the deleted queues.
  test("a queue consumer replaced onto its queue's new id goes out; anything else replaced still stops it", () => {
    const real = logged("Plan: 6 to update, 3 to replace, 3 binding changes", "[AGENT_SANDBOX] update", "[Build] update", "[CI_RUNNER] update", "[DB] update",
      "[DEPLOY_RUNNER] update", "[HOOKSConsumer] replace", "[JOBSConsumer] replace", "[LEVEL_DIGSConsumer] replace", "[Worker] update",
      "[Worker/AGENT_SANDBOX] update", "[Worker/CI_RUNNER] update", "[Worker/DEPLOY_RUNNER] update");
    const v = checkPlan(real, plain);
    expect(v.stop).toBeNull();
    expect(v.show).toContain("[HOOKSConsumer] replace");
    for (const row of ["[HOOKSConsumer] delete", "[HOOKS] replace", "[Worker/HOOKSConsumer] replace"])
      expect(checkPlan(plan("Plan: 1 to update", "[HOOKSConsumer] replace", row), plain).stop).toContain(row);
  });

  test("deletes, replaces, orphans, unbinds and drops stop it", () => {
    for (const row of ["[FILES] delete", "[Worker] replace", "[JOBS] orphaned", "[Worker/CI_RUNNER] unbind", "[Migrate] drop [action]"])
      expect(checkPlan(plan("Plan: 1 to update", row), plain).stop).toContain(row);
  });

  test("--checks lets CI_RUNNER and its binding line be made, and nothing else", () => {
    const ci = plan("Plan: 1 to create, 1 to update", "[CI_RUNNER] create", "[CI_RUNNER/CI_RUNNER] create", "[Worker] update", "[Worker/CI_RUNNER] create");
    expect(checkPlan(ci, plain).stop).toContain("[CI_RUNNER] create");
    expect(checkPlan(ci, { checksNew: true, move: false }).stop).toBeNull();
    expect(checkPlan(ci + "\n[AGENT_SANDBOX] create", { checksNew: true, move: false }).stop).toContain("[AGENT_SANDBOX] create");
  });

  test("--move lets exactly the five renames through", () => {
    expect(checkPlan(MOVE, move).stop).toBeNull();
    expect(checkPlan(MOVE, plain)).toMatchObject({ stop: MOVE_PENDING, move: true });
    // The new database already there is adopted, the old one deleted: as good as a replace.
    expect(checkPlan(plan("Plan: 2 to adopted, 2 to delete", "[DB] adopted", "[DB] delete", "[HOOKS] create", "[HOOKS] delete"), move).stop).toBeNull();
  });

  test("--move still stops on the Worker or a container made again (the state didn't move)", () => {
    expect(checkPlan(MOVE + "\n[Worker] create", move).stop).toContain("[Worker] create");
    expect(checkPlan(MOVE + "\n[AGENT_SANDBOX] create", move).stop).toContain("[AGENT_SANDBOX] create");
    expect(checkPlan(MOVE + "\n[DBX] replace", move).stop).toContain("[DBX] replace");
    expect(checkPlan(MOVE + "\n[FILES] delete", move).stop).toContain("[FILES] delete");
  });

  test("--move stops when the delete warning has anything besides the renames, a dropped class included", () => {
    const extra = MOVE.replace(", and the data in them", ", Durable Object class CiRunner, and the data in them");
    expect(checkPlan(extra, move).stop).toContain("Durable Object class CiRunner");
  });

  test("--move stops when the plan doesn't move DB at all", () => {
    expect(checkPlan(UPDATE, move).stop).toContain("doesn't move DB");
  });

  test("the guard's warnings: behind main replans, stray state stops", () => {
    expect(checkPlan(plan("warning: HEAD is 2 commits behind origin/main, and this is a live site (targets.edge.adopt): …", UPDATE), plain)).toMatchObject({ stop: null, behind: true });
    expect(checkPlan(plan(`warning: stage live_ryanquinn's Alchemy state is under the app name "codesplitters", not "codesplitter": …`, UPDATE), plain).stop).toContain("old name");
  });

  test("Effect's other log lines aren't taken for plan rows", () => {
    expect(checkPlan(plan("[12:00:00.123] INFO (#1): delete the old bucket later", UPDATE), plain).stop).toBeNull();
  });
});

describe("helpers", () => {
  test("deleteItems splits around the parentheses", () => {
    expect(deleteItems(MOVE_WARNING)).toHaveLength(5);
    expect(deleteItems("warning: this deploy would delete Durable Object class X, and the data in it.")).toEqual(["Durable Object class X"]);
  });

  test("dirtyFiles leaves out what plan regenerates and what git doesn't track", () => {
    const s = " M apps/codesplitter/wrangler.jsonc\n M apps/codesplitter/.env.schema\n?? apps/codesplitters/\n M apps/codesplitter/src/api.ts\n";
    expect(dirtyFiles(s, "apps/codesplitter")).toEqual([" M apps/codesplitter/src/api.ts"]);
  });

  test("notifyCmd quotes the question for AppleScript", () => {
    expect(notifyCmd("waiting", 'Deploy "this"?\n  ok\\')).toEqual(["osascript", "-e", 'display notification "Deploy \\"this\\"? ok\\\\" with title "waiting" sound name "Glass"']);
  });

  test("readyLevels", () => {
    expect(readyLevels(JSON.stringify([{ status: "ready" }, { status: "digging" }, { status: "ready" }]))).toBe(2);
    expect(readyLevels("<html>")).toBeNull();
  });

  test("parseArgs refuses what it doesn't know (--rename was one deploy, #803)", () => {
    expect(parseArgs(["--move"])).toEqual(move);
    expect(() => parseArgs(["--rename"])).toThrow(Stop);
  });

  test("the real IO collects both streams, shows the lines asked for, and gives the exit code", async () => {
    const shown: string[] = [];
    const log = console.log;
    console.log = (l: string) => shown.push(l);
    try {
      const r = await realIO.run(["sh", "-c", "echo one; echo '[DB] noop'; echo two >&2; exit 3"], { show: (l) => !/\] noop/.test(l) });
      expect(r.code).toBe(3);
      expect(r.out).toContain("[DB] noop");
      expect(shown.sort()).toEqual(["one", "two"]);
    } finally { console.log = log; }
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
    if (c.endsWith("wrangler auth token")) return ok(this.loggedIn ? "x".repeat(40) : "");
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
    expect(deployEnv).toMatchObject({ CODESPLITTER_CHECKS: "1", CODESPLITTER_DEPLOYS: "1", CODESPLITTER_AGENTS: "1", CLOUDFLARE_API_TOKEN: "x".repeat(40) });
    // The token left in the terminal never reaches wrangler's login check.
    expect(mac.envs[mac.at(/wrangler whoami/)]!.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(mac.ran(/move-resources/)).toEqual([]);
    // Warned up front that a y/N follows the plan.
    expect(mac.said[0]).toContain("then asks y/N before deploying");
  });

  test("each plan and deploy gets a fresh wrangler token: one from the start may have expired at a question", async () => {
    const mac = new Mac(); mac.answers = [true];
    let n = 0;
    const real = mac.run.bind(mac);
    mac.run = async (cmd, opts) => cmd.join(" ").endsWith("wrangler auth token") ? { code: 0, out: `tok-${++n}`.padEnd(40, "x") } : real(cmd, opts);
    await go(mac);
    const planTok = mac.envs[mac.at(/rustybuns plan/)]!.CLOUDFLARE_API_TOKEN, deployTok = mac.envs[mac.at(/rustybuns deploy/)]!.CLOUDFLARE_API_TOKEN;
    expect(planTok).toStartWith("tok-");
    expect(deployTok).toStartWith("tok-");
    expect(deployTok).not.toBe(planTok);
  });

  test("the files plan regenerated are put back before syncing; anything else stops it", async () => {
    const mac = new Mac(); mac.answers = [true];
    mac.status = " M apps/codesplitter/wrangler.jsonc\n";
    await go(mac);
    expect(mac.calls).toContain("git -C /w checkout -q -- apps/codesplitter/wrangler.jsonc apps/codesplitter/.env.schema");
    mac.status = " M apps/codesplitter/src/api.ts\n";
    await stopsWith(go(mac), "local changes (apps/codesplitter/src/api.ts)");
  });

  test("a locked 1Password is opened and waited for", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.codes.op = [1, 1, 0];
    await go(mac);
    expect(mac.calls).toContain("open -a 1Password");
  });

  test("a logged-out wrangler logs in with the app's scopes and goes on", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.loggedIn = false;
    await go(mac);
    expect(mac.ran(/wrangler login/)).toEqual(["bunx wrangler login --scopes account:read workers:write"]);
    expect(mac.ran(/rustybuns deploy/)).toHaveLength(1);
  });

  test("Docker not running is started", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.codes.docker = [1, 1, 0];
    await go(mac);
    expect(mac.calls).toContain("open -a Docker");
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

  test("--checks remembers it's on once deployed", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.files.delete("/h/.codesplitters-checks-on");
    mac.plans = [plan("Plan: 1 to create", "[CI_RUNNER] create", "[CI_RUNNER/CI_RUNNER] create")];
    await go(mac, { checksNew: true, move: false });
    expect(mac.touched).toEqual(["/h/.codesplitters-checks-on"]);
    expect(mac.envs[mac.at(/rustybuns plan/)]!.CODESPLITTER_CHECKS).toBe("1");
  });

  test("without the marker or --checks, CHECKS is 0", async () => {
    const mac = new Mac(); mac.answers = [true]; mac.files.delete("/h/.codesplitters-checks-on");
    await go(mac);
    expect(mac.envs[mac.at(/rustybuns plan/)]!.CODESPLITTER_CHECKS).toBe("0");
  });
});

describe("the move not run yet", () => {
  test("state under the old name is caught before the plan, and the move is offered", async () => {
    const mac = new Mac(); mac.files.add(`${STATES}/codesplitters`);
    const e = await go(mac).then(() => null, (e) => e);
    expect(e).toBeInstanceOf(NeedsMove);
    expect(mac.ran(/rustybuns plan/)).toEqual([]);
  });

  test("main: yes runs the move there and then, with every question --move asks", async () => {
    const mac = new Mac(); mac.plans = [REAL]; mac.answers = [true, true, true];
    await main(mac, plain, WHERE, {});
    expect(mac.asked[0]).toContain("Run the move now?");
    expect(mac.asked[1]).toContain("backlog of 0");
    expect(mac.asked[2]).toContain("Copy the data and deploy");
    expect(mac.ran(/rustybuns deploy/)).toEqual(["bunx rustybuns deploy --yes --allow-delete"]);
  });

  test("main: no copies and deploys nothing, and says how to run it later", async () => {
    const mac = new Mac(); mac.plans = [REAL]; mac.answers = [false];
    await stopsWith(main(mac, plain, WHERE, {}), "--move");
    expect(mac.ran(/move-resources|rustybuns deploy/)).toEqual([]);
  });

  test("main: any other stop is passed on, with no offer", async () => {
    const mac = new Mac(); mac.plans = [logged("Plan: 1 to delete", "[FILES] delete")];
    await stopsWith(main(mac, plain, WHERE, {}), "[FILES] delete");
    expect(mac.asked).toEqual([]);
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

  test("no at the deploy question copies nothing", async () => {
    const mac = moving(); mac.answers = [true, false];
    await stopsWith(go(mac, move), "nothing changed");
    expect(mac.ran(/--copy/)).toEqual([]);
  });

  test("no at the queues question doesn't even plan", async () => {
    const mac = moving(); mac.answers = [false];
    await stopsWith(go(mac, move), "nothing was copied or deleted");
    expect(mac.ran(/rustybuns plan/)).toEqual([]);
  });

  test("the move script's read-only check stopping stops it", async () => {
    const mac = moving(); mac.codes.dry = [1];
    await stopsWith(go(mac, move), "the move script stopped");
    expect(mac.asked).toEqual([]);
  });

  test("state under both names stops it", async () => {
    const mac = moving();
    mac.files.add(`${STATES}/codesplitters`); mac.files.add(`${STATES}/codesplitter`);
    await stopsWith(go(mac, move), "under both");
  });

  test("main moving at the question replans before any copy", async () => {
    const mac = moving(); mac.answers = [true, true, true];
    let fetches = 0;
    mac.hooks.push([/git -C \/c fetch/, (m) => { if (++fetches === 2) m.main = "b"; }]);
    await go(mac, move);
    expect(mac.ran(/--copy/)).toHaveLength(1);
    expect(mac.at(/--copy/)).toBeGreaterThan(mac.calls.lastIndexOf("bunx rustybuns plan"));
  });

  test("a copy whose counts differ (a write landed mid-copy) is tried once more", async () => {
    const mac = moving(); mac.codes.copy = [1, 0];
    await go(mac, move);
    expect(mac.ran(/--copy/)).toHaveLength(2);
    expect(mac.ran(/rustybuns deploy/)).toHaveLength(1);
  });

  test("a copy failing twice stops before deploying", async () => {
    const mac = moving(); mac.codes.copy = [1];
    await stopsWith(go(mac, move), "the copy stopped twice");
    expect(mac.ran(/rustybuns deploy/)).toEqual([]);
  });

  test("a failed deploy after the copy says a rerun copies again", async () => {
    const mac = moving(); mac.codes.deploy = [1];
    await stopsWith(go(mac, move), "a rerun of --move copies again");
  });

  test("a different level count after the move stops it", async () => {
    const mac = moving(); mac.levels = [23, 0];
    await stopsWith(go(mac, move), "not 23");
  });
});
