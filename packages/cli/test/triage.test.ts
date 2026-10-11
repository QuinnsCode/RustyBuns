import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsOnPath, triage, type TriageOptions } from "../src/triage.ts";
import { rustybunsContext } from "../src/triage-context.ts";

function setup(over: Partial<TriageOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rb-triage-"));
  const logs: string[] = [], runs: { command: string; args: string[]; cwd: string }[] = [];
  const o: TriageOptions = {
    product: "RustyBuns", command: "rustybuns triage", dir, context: "# facts\n", playbook: "# playbook\nask first\n", argv: [],
    cwd: "/proj", installed: () => ["claude"], log: (l) => logs.push(l), now: () => new Date("2026-10-11T09:00:00Z"),
    run: async (command, args, cwd) => { runs.push({ command, args, cwd }); return 0; },
    ...over,
  };
  const run = join(dir, "2026-10-11T09-00-00-000Z");
  return { o, dir, run, logs, runs };
}

test("writes the facts and the playbook, then starts the one agent there is on a one-line pointer", async () => {
  const { o, run, runs, logs } = setup({ argv: ["--model", "opus"] });
  expect(await triage(o)).toBe(0);
  expect(readFileSync(join(run, "context.md"), "utf8")).toBe("# facts\n");
  const prompt = readFileSync(join(run, "prompt.md"), "utf8");
  expect(prompt).toContain("started this session with `rustybuns triage`");
  expect(prompt).toContain(join(run, "context.md"));
  expect(prompt).toEndWith("# playbook\nask first\n");
  expect(runs).toEqual([{ command: "claude", args: ["--model", "opus", expect.stringContaining(`Read the file "${join(run, "prompt.md")}"`)], cwd: "/proj" }]);
  expect(logs).toEqual(["Starting Claude Code. It will ask what went wrong.\n"]);
});

test("both installed: asks, or says to pick with --agent when there's no terminal", async () => {
  const both = { installed: () => ["claude", "codex"] as const as any };
  const a = setup({ ...both, choose: async () => "codex" });
  await triage(a.o);
  expect(a.runs[0]!.command).toBe("codex");
  const b = setup({ ...both, choose: async () => undefined });
  expect(await triage(b.o)).toBe(2);
  expect(b.logs[0]).toContain("--agent claude or --agent codex");
  expect(b.runs).toEqual([]);
});

test("no agent, --print, or one that isn't there: the files are the fallback", async () => {
  const none = setup({ installed: () => [] });
  expect(await triage(none.o)).toBe(0);
  expect(none.logs[0]).toStartWith("No coding agent CLI (claude, codex) was found here.");
  expect(readdirSync(none.run).sort()).toEqual(["context.md", "prompt.md"]);
  const print = setup({ argv: ["--print"] });
  expect(await triage(print.o)).toBe(0);
  expect(print.logs[0]).toStartWith("The triage prompt and the machine facts are in:");
  expect(print.runs).toEqual([]);
  const missing = setup({ argv: ["--agent", "codex"] });
  expect(await triage(missing.o)).toBe(1);
  expect(missing.logs[0]).toContain("codex isn't installed");
  expect(await triage(setup({ argv: ["--agent", "cursor"] }).o)).toBe(2);
  expect(await triage(setup({ argv: ["--nope"] }).o)).toBe(2);
});

test("agentsOnPath finds executables on PATH, not plain files", () => {
  const bin = mkdtempSync(join(tmpdir(), "rb-bin-"));
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(join(bin, "codex"), "not executable");
  expect(agentsOnPath({ PATH: bin })).toEqual(["claude"]);
});

test("the context: the box's health and memory, whether the secret is set (never its value), the installed packages", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rb-proj-"));
  mkdirSync(join(cwd, ".alchemy/state/shop/live_me"), { recursive: true });
  writeFileSync(join(cwd, ".alchemy/state/shop/live_me/Service.json"), JSON.stringify({ attr: { url: "https://shop.example/" } }));
  mkdirSync(join(cwd, "node_modules/@rustybuns/cli"), { recursive: true });
  writeFileSync(join(cwd, "node_modules/@rustybuns/cli/package.json"), JSON.stringify({ version: "9.9.9" }));
  const send = (async (u: string) => u.endsWith("/health") ? new Response("ok")
    : Response.json({ rssMb: 210, heapMb: 60, peakRssMb: 220, uptimeS: 7200, slopeMbPerHour: 12.5, hoursToMax: 23.2, maxMb: 500, samples: 12, boots: 3 })) as typeof fetch;
  const cfg = { name: "shop", state: "project", bindings: { RB_PROF_SECRET: { type: "secret" } }, targets: { box: { provider: "railway" } } } as any;
  const md = await rustybunsContext({ cwd, version: "0.1.10", cfg, stage: "live_me", env: { RB_PROF_SECRET: "a-very-secret-value-123" }, send });
  expect(md).toContain("- Targets: box (railway)");
  expect(md).toContain("- URL: https://shop.example");
  expect(md).toContain("- /health: 200");
  expect(md).toContain("rss 210 MB, heap 60 MB, peak 220 MB, +12.5 MB/h, ceiling 500 MB (~23.2h away), up 120 min, 3 boots on this disk");
  expect(md).toContain("- RB_PROF_SECRET: set here");
  expect(md).not.toContain("a-very-secret-value-123");
  expect(md).toContain("- @rustybuns/cli 9.9.9");

  const down = await rustybunsContext({ cwd, version: "0.1.10", cfg, stage: "live_me", env: {}, send: (async () => { throw new Error("ECONNREFUSED"); }) as any });
  expect(down).toContain("- /health: no answer (ECONNREFUSED)");
  expect(down).toContain("declared, but not set");
  expect(await rustybunsContext({ cwd, version: "0.1.10", cfg: null, stage: "x", env: {} })).toContain("no rustybuns.config.ts here");
  expect(await rustybunsContext({ cwd, version: "0.1.10", cfg: { error: "boom" }, stage: "x", env: {} })).toContain("failed to load: boom");
});
