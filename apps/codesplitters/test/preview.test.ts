import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { CONFIG_READ, KEEP, logStart, preview, urlIn, type Run, type Runner } from "../src/preview.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** A fake machine: each command's output and exit code, by the command's first two words. */
function fake(answers: Record<string, { out?: string; code?: number }>, status = 200) {
  const ran: string[] = [];
  const runner: Runner = {
    exec: async (cmd, _cwd, out) => {
      const line = cmd.join(" ");
      ran.push(line);
      const key = Object.keys(answers).find((k) => line.includes(k));
      const a = key ? answers[key]! : {};
      if (a.out) out(a.out);
      return a.code ?? 0;
    },
    fetch: async () => ({ status }),
  };
  return { runner, ran };
}

const CONFIG = 'RB {"adopt":false,"edge":true,"box":false}\n';

async function app(runner: Runner, extra: Record<string, unknown> = {}) {
  const call = await boot({ GH_CLI: "off", ...extra });
  opened.push(call);
  call.env.PREVIEW_RUNNER = runner;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: "{}" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=package.json", { message: "package.json" });
  return { call, send };
}

const finish = async (call: any) => {
  let d: any;
  for (const end = performance.now() + 15_000; performance.now() < end;) { d = await (await call("ryan", "/api/repos/ryan/lab/preview")).json(); if (d.run?.done) break; await Bun.sleep(10); }
  return d.run;
};
const statuses = (run: any) => Object.fromEntries(run.steps.map((s: any) => [s.key, s.status]));

test("a preview goes up on a stage of its own, answers, and comes down", async () => {
  const { runner, ran } = fake({ "bun -e": { out: CONFIG }, "rustybuns deploy": { out: 'deployed\n{ url: "https://lab-abc-preview.ryan.workers.dev" }\n' } });
  const { call, send } = await app(runner);
  expect((await call("ana", "/api/repos/ryan/lab/preview")).status).toBe(403);
  const started = await send("ryan", "/api/repos/ryan/lab/preview", {});
  expect(started.status).toBe(202);
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", deploy: "done", check: "done", destroy: "done" });
  expect(run.url).toBe("https://lab-abc-preview.ryan.workers.dev");
  expect(ran.find((l) => l.includes("rustybuns deploy"))).toContain(`--stage ${run.stage}`);
  expect(ran.find((l) => l.includes("rustybuns destroy"))).toContain(`--stage ${run.stage}`);
  // The clone's token never reaches the log.
  expect(run.steps[0].out).toContain("<remote>");
  expect(run.steps[0].out).not.toContain("://x:");
  // It's logged beside the real deploys, so it outlives this process, but not in their list.
  let d: any;
  for (const end = performance.now() + 15_000; performance.now() < end && (d = await (await call("ryan", "/api/repos/ryan/lab/preview")).json()).history[0]?.status === "running";) await Bun.sleep(10);
  expect(d.history).toHaveLength(1);
  expect(d.history[0]).toMatchObject({ id: run.id, stage: run.stage, by: "ryan", trigger: "preview", status: "done", url: run.url });
  expect((await (await call("ryan", "/api/repos/ryan/lab/deploy")).json()).history).toEqual([]);
});

test("a preview runs in the app's folder from the deploy settings", async () => {
  const { runner, ran } = fake({ "bun -e": { out: CONFIG }, "rustybuns deploy": { out: 'url: "https://lab.ryan.workers.dev"\n' } });
  const cwds: string[] = [];
  const exec = runner.exec;
  runner.exec = (cmd, cwd, out) => { if (cmd.join(" ").includes("bun x rustybuns")) cwds.push(cwd); return exec(cmd, cwd, out); };
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/deploy", { dir: "apps/web" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/preview", {});
  const run = await finish(call);
  expect(statuses(run).destroy).toBe("done");
  expect(ran).toContain("test -d apps/web");
  expect(cwds).toHaveLength(2);
  for (const c of cwds) expect(c).toMatch(/\/repo\/apps\/web$/);
});

test("each repo keeps its last runs, previews and deploys counted apart", async () => {
  const { call } = await app(fake({}).runner);
  const log = (i: number, trigger: "preview" | "button") =>
    logStart(call.env, "ryan", "lab", { id: `${trigger}-${i}`, at: i, stage: "s", steps: [], done: true }, "ryan", trigger);
  for (let i = 0; i < KEEP + 3; i++) await log(i, "preview");
  await log(0, "button");
  const ids = (sql: string) => call.env.DB.prepare(sql).all().then((r: any) => r.results.map((x: any) => x.id));
  const previews = await ids("SELECT id FROM deploys WHERE trigger = 'preview' ORDER BY at");
  expect(previews).toHaveLength(KEEP);
  expect(previews[0]).toBe("preview-3");   // the three oldest went
  expect(await ids("SELECT id FROM deploys WHERE trigger = 'button'")).toEqual(["button-0"]);
});

test("a failed check still tears the stack down", async () => {
  const { runner, ran } = fake({ "bun -e": { out: CONFIG }, "rustybuns deploy": { out: 'url: "https://x.workers.dev"' } }, 502);
  const real = Bun.sleep;
  (Bun as any).sleep = () => real(0);
  try {
    const { call, send } = await app(runner);
    await send("ryan", "/api/repos/ryan/lab/preview", {});
    const run = await finish(call);
    expect(statuses(run)).toMatchObject({ check: "failed", destroy: "done" });
    expect(ran.some((l) => l.includes("rustybuns destroy"))).toBe(true);
  } finally { (Bun as any).sleep = real; }
});

test("a deploy that isn't logged in says how to log in, and still runs destroy", async () => {
  const { runner } = fake({ "bun -e": { out: CONFIG }, "rustybuns deploy": { out: "Error: Unauthorized (missing CLOUDFLARE_API_TOKEN)\n", code: 1 } });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/preview", {});
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", deploy: "failed", check: "skipped", destroy: "done" });
  expect(run.note).toContain("rustybuns login cloudflare");
});

test("an adopting stack is refused before anything is created", async () => {
  const { runner, ran } = fake({ "bun -e": { out: 'RB {"adopt":true,"edge":true}\n' } });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/preview", {});
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", deploy: "failed", check: "skipped", destroy: "skipped" });
  expect(run.steps[2].out).toContain("adopt");
  expect(ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);
});

/** Run the config read in a folder laid out from `files`; its RB line, parsed. */
async function readConfig(files: Record<string, string>) {
  const { mkdtempSync, rmSync } = await import("node:fs"), { join } = await import("node:path"), { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-read-"));
  try {
    for (const [f, text] of Object.entries(files)) await Bun.write(join(dir, f), text);
    const p = Bun.spawnSync([process.execPath, "-e", CONFIG_READ], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(p.stderr.toString()).toBe("");
    return JSON.parse(/RB (\{.*\})/.exec(p.stdout.toString())![1]!);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the config read says which of a Hetzner box's crates would have to compile", async () => {
  const crates = { "native/Cargo.toml": "[workspace]\n", "native/crates/fast/Cargo.toml": "[package]\nname = \"fast\"\n",
    "native/crates/wasm/Cargo.toml": "[package]\nname = \"wasm\"\n[package.metadata.rustybuns]\ndesktop = false\n" };
  const config = (box: object, desktop: object = {}) => ({ "rustybuns.config.ts": `export default ${JSON.stringify({ name: "lab", targets: { box, desktop } })}` });
  // An arm box builds its crates in Docker every time; the wasm-only one opts out.
  expect((await readConfig({ ...crates, ...config({ provider: "hetzner", serverType: "cax11" }) })).native).toEqual({ arch: "linux-arm64", crates: ["fast"] });
  // An x86 one (the default cpx12) only has to when its build isn't committed.
  expect((await readConfig({ ...crates, ...config({ provider: "hetzner" }) })).native).toEqual({ arch: "linux-x64", crates: ["fast"] });
  expect((await readConfig({ ...crates, ...config({ provider: "hetzner" }), "native/dist/fast/linux-x64/libfast.so": "" })).native).toBeNull();
  // Railway builds them in its own image; desktop.native: false keeps them out.
  expect((await readConfig({ ...crates, ...config({ provider: "railway" }) })).native).toBeNull();
  expect((await readConfig({ ...crates, ...config({ provider: "hetzner" }, { native: false }) })).native).toBeNull();
  const plain = await readConfig(config({ provider: "hetzner" }));
  expect(plain).toEqual({ adopt: false, edge: false, box: true, native: null });
});

test("a hosted deploy refuses a box whose crates need compiling, before anything is created", async () => {
  const native = 'RB {"adopt":false,"edge":true,"box":true,"native":{"arch":"linux-arm64","crates":["fast"]}}\n';
  const steps = () => (["clone", "install", "deploy", "check"] as const).map((key) => ({ key, status: "waiting" as const, out: "" }));
  const { mkdtempSync, rmSync } = await import("node:fs"), { join } = await import("node:path"), { tmpdir } = await import("node:os");
  const work = mkdtempSync(join(tmpdir(), "codesplitters-hosted-"));
  try {
    const hosted = fake({ "bun -e": { out: native } });
    const run: Run = { id: "a", at: Date.now(), stage: "prod", steps: steps(), done: false };
    await preview({ ...hosted.runner, noRust: true, workdir: work }, "https://git.example/r.git", run, { keep: true });
    expect(Object.fromEntries(run.steps.map((s) => [s.key, s.status]))).toEqual({ clone: "done", install: "done", deploy: "failed", check: "skipped" });
    expect(run.steps[2]!.out).toContain("fast");
    expect(run.note).toContain("desktop");
    expect(hosted.ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);
    // The desktop has Docker (or says to start it), so it goes ahead.
    const desk = fake({ "bun -e": { out: native }, "rustybuns deploy": { out: 'url: "https://x.workers.dev"' } });
    const run2: Run = { id: "b", at: Date.now(), stage: "prod", steps: steps(), done: false };
    await preview({ ...desk.runner, workdir: work }, "https://git.example/r.git", run2, { keep: true });
    expect(desk.ran.some((l) => l.includes("rustybuns deploy"))).toBe(true);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("a failed destroy keeps the clone and says how to finish", async () => {
  const { runner } = fake({ "bun -e": { out: CONFIG }, "rustybuns deploy": { out: 'url: "https://x.workers.dev"' }, "rustybuns destroy": { code: 1 } });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/preview", {});
  const run = await finish(call);
  expect(run.kept).toBeTruthy();
  expect(run.note).toContain(`destroy --yes --stage ${run.stage}`);
  const { rmSync } = await import("node:fs");
  rmSync(run.kept.replace(/\/repo$/, ""), { recursive: true, force: true });
});

test("urlIn reads Alchemy's outputs", () => {
  expect(urlIn('Outputs: { url: "https://a.workers.dev", box: "https://b.up.railway.app" }')).toBe("https://b.up.railway.app");
  expect(urlIn("live at https://lab-x.ryan.workers.dev now")).toBe("https://lab-x.ryan.workers.dev");
  expect(urlIn("nothing here")).toBeUndefined();
});

test("over the preview limit, one queues: the replay starts the run, and the page polls it as before", async () => {
  const { call } = await app(fake({ "bun -e": { out: CONFIG } }).runner, { ADMINS: "boss" });   // else everyone is an admin, and never limited
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('preview', 1, 3600, 1, 'queue')").run();
  const start = () => call("ryan", "/api/repos/ryan/lab/preview", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" }, body: "{}" });
  expect((await start()).status).toBe(202);
  const first = await finish(call);
  const over = await start();
  expect(over.status).toBe(202);
  const { queued } = (await over.json()) as any;
  expect(queued).toMatchObject({ rule: "preview", state: "waiting", place: 1, label: "Preview deploys" });
  // Room again: the next poll replays it, and it answers as the POST would have.
  await call.env.DB.prepare("DELETE FROM limit_hits").run();
  const job = (await (await call("ryan", `/api/jobs/${queued.id}`)).json()) as any;
  expect(job).toMatchObject({ state: "done", status: 202 });
  expect(job.result.run.id).not.toBe(first.id);
  expect((await finish(call)).id).toBe(job.result.run.id);
  // The profile's list names it, and links to the repo whose page follows the run.
  const { jobs } = (await (await call("ryan", "/api/jobs")).json()) as any;
  expect(jobs[0]).toMatchObject({ what: "preview of ryan/lab", result: { owner: "ryan", name: "lab" } });
});
