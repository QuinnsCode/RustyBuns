import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { review } from "../src/deploy-review.ts";
import { local as boot } from "../src/local.ts";
import type { Runner } from "../src/preview.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A fake machine, as in preview.test.ts; `gate` holds the deploy command until it's opened. */
function fake(cfg = { adopt: false, edge: true, box: false }, deploy: { out?: string; code?: number } = { out: 'url: "https://lab.ryan.workers.dev"\n' }) {
  const ran: string[] = [];
  let open = () => {}, gate = Promise.resolve(), held = false;
  const runner: Runner = {
    exec: async (cmd, _cwd, out) => {
      const line = cmd.join(" ");
      ran.push(line);
      if (line.includes("rev-parse")) out(SHA + "\n");
      if (line.includes("bun -e")) out(`RB ${JSON.stringify(cfg)}\n`);
      if (line.includes("rustybuns deploy")) { await gate; if (deploy.out) out(deploy.out); return deploy.code ?? 0; }
      return 0;
    },
    fetch: async () => ({ status: 200 }),
  };
  return { runner, ran, hold() { held = true; gate = new Promise((r) => { open = r; }); }, release() { if (held) open(); } };
}

async function app(runner: Runner, extra: Record<string, unknown> = {}) {
  const call = await boot({ GH_CLI: "off", ...extra });
  opened.push(call);
  call.env.PREVIEW_RUNNER = runner;
  // The clone lands on the remote's tip, as a real one would: a deploy checks it's the commit it reviewed.
  const exec = runner.exec;
  runner.exec = async (cmd, cwd, out) => {
    if (!cmd.includes("rev-parse")) return exec(cmd, cwd, out);
    out(`${(await review(call.env, "ryan", "lab")).tip}\n`);
    return 0;
  };
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: "{}" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=package.json", { message: "package.json" });
  return { call, send };
}

const settle = async (call: any, n = 1) => {
  let d: any;
  for (const end = performance.now() + 15_000; performance.now() < end;) {
    d = await (await call("ryan", "/api/repos/ryan/lab/deploy")).json();
    if (d.history.length >= n && d.history.every((h: any) => h.status !== "running")) break;
    await Bun.sleep(10);
  }
  return d;
};

test("the owner ships to their stage; it stays up and goes in the log", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  expect((await call("ana", "/api/repos/ryan/lab/deploy")).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/deploy", { stage: "Prod!" }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/deploy", { stage: "preview-x" }, "PUT")).status).toBe(400);
  expect(await (await send("ryan", "/api/repos/ryan/lab/deploy", { stage: "live" }, "PUT")).json()).toEqual({ stage: "live", dir: "", on_commit: false, production: false });

  expect((await send("ryan", "/api/repos/ryan/lab/deploy", {})).status).toBe(202);
  const d = await settle(call);
  expect(d.run.steps.map((s: any) => [s.key, s.status])).toEqual([["clone", "done"], ["install", "done"], ["deploy", "done"], ["check", "done"]]);
  expect(ran.find((l) => l.includes("rustybuns deploy"))).toContain("--stage live");
  expect(ran.some((l) => l.includes("rustybuns destroy"))).toBe(false);
  expect(d.history[0]).toMatchObject({ stage: "live", by: "ryan", trigger: "button", status: "done", commit_hash: (await review(call.env, "ryan", "lab")).tip, url: "https://lab.ryan.workers.dev" });
});

test("only the owner's own commit ships, and only when they turned it on", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  const commit = (who: string) => send(who, "/api/repos/ryan/lab/do/commit?path=package.json", { message: "again" });
  const edit = async (who: string, text: string) => {
    const doc = await (await call(who, "/api/repos/ryan/lab/do/file?path=package.json")).json();
    await send(who, "/api/repos/ryan/lab/do/ops?path=package.json", { ops: [{ kind: "set", line: doc.lines[0].id, text, base: doc.lines[0].rev }] });
  };
  await edit("ryan", '{"a":1}'); await commit("ryan");
  expect(ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);   // off by default

  await send("ryan", "/api/repos/ryan/lab/deploy", { on_commit: true }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "agent-claude" });
  await edit("agent-claude", '{"a":2}'); await commit("agent-claude");
  await Bun.sleep(50);
  expect(ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);   // an agent's commit never ships

  // Nor does the owner's next one while the agent's is under it, unreviewed (#682).
  await edit("ryan", '{"a":3}'); await commit("ryan");
  await Bun.sleep(50);
  expect(ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);

  // Once the owner approves main, their own commits ship again.
  const { tip } = await review(call.env, "ryan", "lab");
  expect((await send("ryan", "/api/repos/ryan/lab/deploy", { approve: tip })).status).toBe(202);
  await settle(call);
  await edit("ryan", '{"a":4}'); await commit("ryan");
  const d = await settle(call, 2);
  expect(d.history.map((h: any) => [h.trigger, h.status])).toEqual([["commit", "done"], ["button", "done"]]);
});

test("a crew commit holds a desktop deploy until the owner approves the diff at that tip", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  const D = "/api/repos/ryan/lab/deploy";
  await send("pat", "/api/login", { name: "pat" });
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "pat" });
  await send("pat", "/api/repos/ryan/lab/files", { path: "rustybuns.config.ts", content: "export default { exfiltrate: true }" });
  await send("pat", "/api/repos/ryan/lab/do/commit?path=rustybuns.config.ts", { message: "pat's config" });

  const pressed = await send("ryan", D, {});
  expect(pressed.status).toBe(409);
  const waiting = (await pressed.json()) as any;
  expect(waiting.error).toContain("waiting for you");
  expect(waiting.review.commits.map((c: any) => c.message)).toEqual(["pat's config"]);
  expect(((await (await call("ryan", D)).json()) as any).review).toMatchObject({ cleared: false, tip: waiting.review.tip });
  const r = (await (await call("ryan", `${D}/review`)).json()) as any;
  expect(r.diff.files.find((f: any) => f.path === "rustybuns.config.ts")).toMatchObject({ lines: expect.arrayContaining(["+ export default { exfiltrate: true }"]) });
  expect(ran).toEqual([]);

  expect((await send("ryan", D, { approve: "f".repeat(40) })).status).toBe(409);
  expect((await send("ryan", D, { approve: waiting.review.tip })).status).toBe(202);
  expect((await settle(call)).history[0]).toMatchObject({ status: "done", commit_hash: waiting.review.tip });
});

test("a token can't approve a deploy, and an approval of a diff cut short needs approve_unseen", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  const D = "/api/repos/ryan/lab/deploy";
  await send("pat", "/api/login", { name: "pat" });
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "pat" });
  const long = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  await send("pat", "/api/repos/ryan/lab/files", { path: "big.txt", content: long });
  await send("pat", "/api/repos/ryan/lab/do/commit?path=big.txt", { message: "pat's big file" });
  const tip = ((await (await send("ryan", D, {})).json()) as any).review.tip;

  // A write or admin token holds the owner's name but isn't a person reading the diff.
  const t = (await (await send("ryan", "/api/tokens", { label: "agent", scope: "admin" })).json()) as { token: string };
  const viaToken = await call(null, D, { method: "POST", headers: { authorization: `Bearer ${t.token}` }, body: JSON.stringify({ approve: tip, approve_unseen: true }) });
  expect(viaToken.status).toBe(403);

  // The 300-line file shows 200: approving as if it was read is refused until the body says otherwise.
  const cut = await send("ryan", D, { approve: tip });
  expect(cut.status).toBe(409);
  expect(((await cut.json()) as any).error).toContain("cut short");
  expect(ran).toEqual([]);
  expect((await send("ryan", D, { approve: tip, approve_unseen: true })).status).toBe(202);
  expect((await settle(call)).history[0]).toMatchObject({ status: "done", commit_hash: tip });
});

test("a desktop deploy won't run a clone of another commit than the one it checked", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  const exec = runner.exec;
  runner.exec = async (cmd, cwd, out) => { if (!cmd.includes("rev-parse")) return exec(cmd, cwd, out); out(`${SHA}\n`); return 0; };
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  const d = await settle(call);
  expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("main moved") });
  expect(ran.some((l) => l.includes("bun install"))).toBe(false);
});

test("a commit while a deploy runs ships once more afterwards; a second press is refused", async () => {
  const f = fake();
  f.hold();
  const { call, send } = await app(f.runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", { on_commit: true }, "PUT");
  expect((await send("ryan", "/api/repos/ryan/lab/deploy", {})).status).toBe(202);
  expect((await send("ryan", "/api/repos/ryan/lab/deploy", {})).status).toBe(409);
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=package.json", { message: "during" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=package.json", { message: "during, again" });
  f.release();
  const d = await settle(call, 2);
  expect(d.history.map((h: any) => [h.trigger, h.status])).toEqual([["commit", "done"], ["button", "done"]]);
});

test("a stack that adopts live resources ships only once the owner says it's production", async () => {
  const { runner, ran } = fake({ adopt: true, edge: true, box: false });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  let d = await settle(call);
  expect(d.history[0].status).toBe("failed");
  expect(d.run.steps.find((s: any) => s.key === "deploy").out).toContain("say so in the deploy settings");
  expect(ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);

  await send("ryan", "/api/repos/ryan/lab/deploy", { production: true }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  d = await settle(call, 2);
  expect(d.history[0].status).toBe("done");
});

test("a failed deploy keeps the end of its output in the log", async () => {
  const { runner } = fake(undefined, { out: "Error: Unauthorized (missing CLOUDFLARE_API_TOKEN)\n", code: 1 });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  const d = await settle(call);
  expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("rustybuns login cloudflare") });
  expect(d.history[0].out).toContain("Unauthorized");
});

test("over the deploy limit, a press still ships, and the caller is flagged for an admin to look at", async () => {
  const { runner } = fake();
  const { call } = await app(runner, { ADMINS: "boss" });   // else everyone is an admin, and never limited
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('deploy', 1, 3600, 1, 'flag')").run();
  const press = () => call("ryan", "/api/repos/ryan/lab/deploy", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" }, body: "{}" });
  expect((await press()).status).toBe(202);
  await settle(call);
  const over = await press();
  expect(over.status).toBe(202);
  expect((await over.json()) as any).toHaveProperty("run.id");
  expect((await settle(call, 2)).history.map((h: any) => h.status)).toEqual(["done", "done"]);
  const { flagged } = (await (await call("boss", "/api/admin/limits")).json()) as any;
  expect(flagged).toEqual([expect.objectContaining({ who: "@ryan", rules: ["deploy"] })]);
  // It can't be set to queue.
  const put = await call("boss", "/api/admin/limits", { method: "PUT", body: JSON.stringify({ rules: [{ name: "deploy", max: 10, window_s: 3600, enabled: true, on_fail: "queue" }] }) });
  expect(put.status).toBe(400);
});

test("the next desktop deploy updates the same stack: its Alchemy state is kept outside the temp clone", async () => {
  const { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const keep = mkdtempSync(`${tmpdir()}/codesplitter-state-`);
  const stacks: string[] = [], clones: string[] = [];
  const { runner } = fake();
  const exec = runner.exec;
  // Like Alchemy: with no state, a new stack under a new name; with it, the same one.
  runner.exec = async (cmd, cwd, out) => {
    if (cmd.join(" ").includes("rustybuns deploy")) {
      clones.push(cwd);
      const f = `${cwd}/.alchemy/state/lab/prod/Worker.json`;
      if (!existsSync(f)) { mkdirSync(`${cwd}/.alchemy/state/lab/prod`, { recursive: true }); writeFileSync(f, JSON.stringify({ name: `lab-${stacks.length}` })); }
      stacks.push(JSON.parse(readFileSync(f, "utf8")).name);
    }
    return exec(cmd, cwd, out);
  };
  const { call, send } = await app(runner, { DEPLOY_STATE_DIR: keep });
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  await settle(call, 1);
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  await settle(call, 2);
  expect(clones[0]).not.toBe(clones[1]);
  expect(stacks).toEqual(["lab-0", "lab-0"]);
  expect(statSync(`${keep}/ryan/lab`).mode & 0o777).toBe(0o700);
  // Another app in the same repo starts a stack of its own, and keeps its state apart.
  await send("ryan", "/api/repos/ryan/lab/deploy", { dir: "apps/web" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  await settle(call, 3);
  expect(stacks).toEqual(["lab-0", "lab-0", "lab-2"]);
  expect(existsSync(`${keep}/ryan/lab~apps~web`)).toBe(true);
});

test("in a monorepo, the app's folder is where install and deploy run", async () => {
  const f = fake(), cwds: Record<string, string> = {};
  const exec = f.runner.exec;
  f.runner.exec = (cmd, cwd, out) => { cwds[cmd.slice(0, 2).join(" ")] = cwd; return exec(cmd, cwd, out); };
  const { call, send } = await app(f.runner);
  for (const dir of ["../x", "apps/../x", "apps/./web", "a b", "apps//web"]) expect((await send("ryan", "/api/repos/ryan/lab/deploy", { dir }, "PUT")).status).toBe(400);
  expect(await (await send("ryan", "/api/repos/ryan/lab/deploy", { dir: "/apps/web/" }, "PUT")).json()).toMatchObject({ dir: "apps/web" });
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  const d = await settle(call);
  expect(d.history[0].status).toBe("done");
  expect(f.ran).toContain("test -d apps/web");
  expect(cwds["test -d"]).toMatch(/\/repo$/);
  for (const c of ["bun install", "bun -e", "bun x"]) expect(cwds[c]).toMatch(/\/repo\/apps\/web$/);
});

test("a folder that isn't in the repo says so", async () => {
  const f = fake();
  const exec = f.runner.exec;
  f.runner.exec = (cmd, cwd, out) => cmd[0] === "test" ? Promise.resolve(1) : exec(cmd, cwd, out);
  const { call, send } = await app(f.runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", { dir: "apps/gone" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  const d = await settle(call);
  expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("no folder apps/gone") });
  expect(f.ran.some((l) => l.includes("bun install"))).toBe(false);
});

test("--allow-delete and --force go to one deploy only, when the press asks, and are never saved", async () => {
  const { runner, ran } = fake();
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", { allow_delete: true, force: true });
  await settle(call);
  const deploys = () => ran.filter((l) => l.includes("rustybuns deploy"));
  expect(deploys()[0]).toMatch(/--allow-delete/);
  expect(deploys()[0]).toMatch(/--force/);
  await send("ryan", "/api/repos/ryan/lab/deploy", { allow_delete: "yes" });
  await settle(call, 2);
  expect(deploys()[1]).not.toMatch(/--allow-delete|--force/);
});
