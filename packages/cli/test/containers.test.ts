import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RustyBunsConfig } from "../src/config.ts";
import { bindingsWhy, containerBindings, contextHash, envFlags, freshness, listText, needDocker, pick, progressLine, readLedger, schemaNames, writeLedger } from "../src/containers.ts";

const cfg = {
  name: "demo",
  bindings: {
    SANDBOX: { type: "container", className: "Sandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" },
    CI: { type: "container", className: "Ci", dockerfile: "deploy/ci.Dockerfile" },
    DB: { type: "d1", databaseName: "x" },
  },
} as unknown as RustyBunsConfig;

test("bindings come from the config with Alchemy's context and defaults; pick names the unknown", () => {
  const bs = containerBindings(cfg);
  expect(bs.map((b) => [b.name, b.context, b.maxInstances, b.instanceType])).toEqual([["SANDBOX", "sandbox", 2, "basic"], ["CI", "deploy", 1, "lite"]]);
  expect(pick(bs, ["CI"]).map((b) => b.name)).toEqual(["CI"]);
  expect(() => pick(bs, ["NOPE"])).toThrow("no container binding NOPE. This app has: SANDBOX, CI");
});

test("staleness: a changed file changes the hash, and the ledger drives built / stale / not built", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-ctr-"));
  mkdirSync(join(dir, "ctx/node_modules"), { recursive: true });
  writeFileSync(join(dir, "ctx/Dockerfile"), "FROM scratch");
  writeFileSync(join(dir, "ctx/server.mjs"), "a");
  const h1 = contextHash(join(dir, "ctx"));
  writeFileSync(join(dir, "ctx/node_modules/x.js"), "ignored");
  expect(contextHash(join(dir, "ctx"))).toBe(h1);
  writeFileSync(join(dir, "ctx/server.mjs"), "b");
  const h2 = contextHash(join(dir, "ctx"));
  expect(h2).not.toBe(h1);

  const b = containerBindings(cfg)[0]!;
  expect(freshness(b, readLedger(dir), h1)).toBe("not built");
  writeLedger({ SANDBOX: { hash: h1, size: 8e8, at: Date.now() - 180_000, dockerfile: b.dockerfile } }, dir);
  expect(freshness(b, readLedger(dir), h1)).toBe("built");
  expect(freshness(b, readLedger(dir), h2)).toBe("stale");
  expect(listText([b], readLedger(dir), () => h1)).toContain("built 3m ago · 800 MB");
});

test("the Docker preflight says one thing, with the binding count, and passes when the daemon is up", () => {
  expect(() => needDocker(bindingsWhy(3), () => false)).toThrow("Docker isn't running. This app has 3 container bindings, and deploy builds their images locally. Start Docker Desktop and run this again.");
  expect(() => needDocker("x", () => true)).not.toThrow();
});

test("BuildKit progress lines become step n/m; --env pairs and .env.schema names are read, values never", () => {
  expect(progressLine("#7 [builder 3/9] RUN apt-get update")).toEqual({ step: 3, of: 9, what: "RUN apt-get update" });
  expect(progressLine("#7 0.5 Get:1 http://deb")).toBeNull();
  expect(envFlags(["a", "--env", "X=1=2", "--env-file", ".e", "b"])).toEqual({ env: { X: "1=2" }, file: ".e", rest: ["a", "b"] });
  const dir = mkdtempSync(join(tmpdir(), "rb-ctr-"));
  writeFileSync(join(dir, ".env.schema"), "# c\nGH_TOKEN=\nPLAIN=1\n");
  expect(schemaNames(dir)).toEqual(["GH_TOKEN", "PLAIN"]);
});

test("the GHA layer cache is one scope per image, read and written", async () => {
  const { ghaCacheArgs } = await import("../src/containers.ts");
  const args = ghaCacheArgs("Codesplitter", { name: "CI_RUNNER" } as never);
  expect(args).toContain("type=gha,scope=codesplitter-ci_runner");
  expect(args).toContain("type=gha,mode=max,scope=codesplitter-ci_runner");
  expect(args[0]).toBe("--load");
});

test("a SIGTERM mid-run removes the container, for run and smoke alike", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-cscope-")), bin = join(dir, "bin"), log = join(dir, "docker.log");
  mkdirSync(join(dir, "api"), { recursive: true });
  writeFileSync(join(dir, "api", "Dockerfile"), "FROM scratch\n");
  mkdirSync(bin);
  // a docker that logs each call: `run` without -d stays attached until the container is removed, like the real client
  writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$*" >> ${log}\ncase "$1" in\n  run) case "$*" in *" -d "*) echo id;; *) while [ ! -f ${dir}/gone ]; do sleep 0.05; done;; esac;;\n  inspect) echo true;;\n  rm) touch ${dir}/gone;;\nesac\n`, { mode: 0o755 });
  const b = { name: "API", className: "Api", dockerfile: "api/Dockerfile", context: join(dir, "api"), maxInstances: 1, instanceType: "lite" };
  writeLedger({ API: { hash: contextHash(b.context), size: 1, at: Date.now(), dockerfile: b.dockerfile } }, dir);
  const src = join(import.meta.dir, "../src");
  for (const cmd of ["runOne", "smokeOne"]) {
    writeFileSync(log, "");
    // the command as `rustybuns containers run|smoke` runs it, in its own process so the signal is real
    const script = join(dir, `${cmd}.ts`);
    writeFileSync(script, `import { ${cmd} } from "${src}/containers.ts"; import { runScoped } from "${src}/lifecycle.ts";
await runScoped(${cmd}("demo", ${JSON.stringify(b)}, { env: {}, dir: ${JSON.stringify(dir)} })).catch((e) => process.exit(e.exitCode ?? 1));`);
    const p = Bun.spawn([process.execPath, script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "ignore", stderr: "ignore" });
    const end = Date.now() + 10_000;
    while (!(await Bun.file(log).text()).includes("run ") && Date.now() < end) await Bun.sleep(20);
    await Bun.sleep(100);
    p.kill("SIGTERM");
    expect(await p.exited).toBe(143);
    expect(await Bun.file(log).text()).toMatch(new RegExp(`^rm -f rb-(smoke-)?demo-api-${p.pid}$`, "m"));
  }
}, 30_000);
