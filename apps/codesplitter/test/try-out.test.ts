import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import type { Runner } from "../src/preview.ts";

/** A fake machine: each command's output and exit code, by a substring of the command line. */
function fake(answers: Record<string, { out?: string; code?: number }>) {
  const ran: { line: string; cwd: string }[] = [];
  const runner: Runner = {
    exec: async (cmd, cwd, out) => {
      const line = cmd.join(" ");
      ran.push({ line, cwd });
      // A clone leaves a repo with a package.json in it, as the real one would.
      if (line.startsWith("git clone")) { const fs = await import("node:fs"); fs.mkdirSync(`${cwd}/repo`, { recursive: true }); fs.writeFileSync(`${cwd}/repo/package.json`, "{}"); }
      const a = answers[Object.keys(answers).find((k) => line.includes(k)) ?? ""] ?? {};
      if (a.out) out(a.out);
      return a.code ?? 0;
    },
    fetch: async () => ({ status: 200 }),
  };
  return { runner, ran };
}

async function app(runner: Runner) {
  const call = await boot({ GH_CLI: "off" });
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
  for (const end = performance.now() + 15_000; performance.now() < end;) { d = await (await call("ryan", "/api/repos/ryan/lab/try")).json(); if (d.run?.done) break; await Bun.sleep(10); }
  return d.run;
};
const statuses = (run: any) => Object.fromEntries(run.steps.map((s: any) => [s.key, s.status]));

test("trying a repo inits it, prints the config, and plans offline", async () => {
  const graph = { app: "lab", stage: "prod", mode: "fresh", targets: ["edge"], nodes: [{ id: "worker", kind: "worker", label: "lab", protected: false }, { id: "INDEX", kind: "vectorize", label: "INDEX", protected: true }], edges: [{ from: "worker", to: "INDEX" }] };
  const { runner, ran } = fake({ "cat rustybuns.config.ts": { out: "export default { name: 'lab' }\n" }, "rustybuns infra": { out: `$ x\nINFRA ${JSON.stringify(graph)}\n` } });
  const { call, send } = await app(runner);
  expect((await call("ana", "/api/repos/ryan/lab/try")).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/try", {})).status).toBe(202);
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", init: "done", infra: "done", plan: "done" });
  expect(run.infra).toEqual(graph);
  expect(ran.some((r) => r.line.endsWith("rustybuns infra --json --stage prod"))).toBe(true);
  expect(run.steps.find((s: any) => s.key === "init").out).toContain("export default");
  expect(ran.some((r) => r.line.endsWith("rustybuns plan --offline"))).toBe(true);
  expect(ran.some((r) => r.line.includes("deploy"))).toBe(false);
});

test("an agent's branch is tried with its files laid over the clone", async () => {
  const { runner, ran } = fake({});
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "agent-edit" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "added.ts", content: "export const x = 1", branch: "agent-edit" });
  expect((await send("ryan", "/api/repos/ryan/lab/try", { branch: "nope" })).status).toBe(404);
  expect((await send("ryan", "/api/repos/ryan/lab/try", { branch: "agent-edit" })).status).toBe(202);
  const run = await finish(call);
  expect(run.stage).toBe("agent-edit");
  expect(run.steps[0].out).toContain("laid 1 changed file over the clone: added.ts");
  expect(ran.length).toBeGreaterThan(2);
});

test("a failed init says so and skips the plan", async () => {
  const { runner } = fake({ "rustybuns init": { out: "no vite or rwsdk dependency\n", code: 1 } });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/try", {});
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", init: "failed", infra: "skipped", plan: "skipped" });
});

test("a repo whose rustybuns has no infra command still plans, just without a map", async () => {
  const { runner } = fake({ "rustybuns infra": { out: "unknown command: infra\n", code: 1 } });
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/try", {});
  const run = await finish(call);
  expect(statuses(run)).toMatchObject({ infra: "failed", plan: "done" });
  expect(run.infra).toBeUndefined();
});

test("saving init's work puts the config on a branch as agent-rustybuns", async () => {
  const { runner, ran } = fake({
    "status --porcelain": { out: "?? rustybuns.config.ts\0 M package.json\0" },
    "show HEAD:package.json": { out: "{}" },
  });
  const wrote = runner.exec;
  runner.exec = async (cmd, cwd, out) => {
    const line = cmd.join(" ");
    if (line.endsWith("rustybuns init")) { const fs = await import("node:fs"); fs.writeFileSync(`${cwd}/rustybuns.config.ts`, "export default { name: 'lab' }\n"); fs.writeFileSync(`${cwd}/package.json`, '{"dependencies":{"rustybuns":"1"}}'); }
    return wrote(cmd, cwd, out);
  };
  const { call, send } = await app(runner);
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "x" });
  expect((await send("ryan", "/api/repos/ryan/lab/try", { save: true, branch: "x" })).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/try", { save: true })).status).toBe(202);
  const run = await finish(call);
  expect(statuses(run)).toEqual({ clone: "done", install: "done", init: "done", save: "done", infra: "done", plan: "done" });
  const branch = run.steps.find((s: any) => s.key === "save").out.match(/branch (rustybuns-init-\S+)/)[1];
  const files = await (await call("ryan", `/api/repos/ryan/lab/branches`)).json() as any[];
  expect(files.find((b) => b.name === branch)).toBeTruthy();
  const cfg = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=rustybuns.config.ts&branch=${branch}`)).json() as any;
  expect(cfg.lines.map((l: any) => l.text).join("\n")).toContain("name: 'lab'");
  expect(cfg.lines[0].by).toBe("agent-rustybuns");
  expect(ran.length).toBeGreaterThan(4);
});
