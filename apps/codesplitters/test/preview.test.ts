import { afterAll, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { urlIn, type Runner } from "../src/preview.ts";

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

async function app(runner: Runner) {
  const call = await boot({ GH_CLI: "off" });
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
  for (let i = 0; i < 200; i++) { d = await (await call("ryan", "/api/repos/ryan/lab/preview")).json(); if (d.run?.done) break; await Bun.sleep(10); }
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
