// The Hetzner box target (#345): its defaults, the config it refuses, the
// stack it generates, the launcher run for real, and the guard on its Volume.
import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxArch, boxDefaults, boxLauncher, checkBox } from "../src/box.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { statefulDeletes } from "../src/guard.ts";
import type { HetznerBoxTarget, RustyBunsConfig } from "../src/config.ts";

const boxed = (box: Partial<HetznerBoxTarget> = {}, bindings: RustyBunsConfig["bindings"] = {}) =>
  ({ name: "hippo", bindings, targets: { box: { provider: "hetzner", ...box } } }) as RustyBunsConfig;

test("defaults: cpx12 in nbg1 with a 10 GB Volume; location wins over the old region", () => {
  expect(boxDefaults({ provider: "hetzner" })).toEqual({ location: "nbg1", serverType: "cpx12", image: "ubuntu-24.04", port: 3000, volumeSize: 10 });
  expect(boxDefaults({ provider: "hetzner", region: "hel1" }).location).toBe("hel1");
  expect(boxDefaults({ provider: "hetzner", region: "hel1", location: "fsn1" }).location).toBe("fsn1");
  // 0 is a choice, not a missing value.
  expect(boxDefaults({ provider: "hetzner", volumeSize: 0 }).volumeSize).toBe(0);
});

test("arch: cax is ARM in any case, every other type is x86", () => {
  for (const t of ["cax11", "CAX21", "cax41"]) expect(boxArch(t)).toBe("linux-arm64");
  for (const t of ["cpx12", "cx23", "ccx13", "something-new"]) expect(boxArch(t)).toBe("linux-x64");
});

test("checkBox: a Volume under 10 GB is refused, since Alchemy would replace it on every redeploy", () => {
  for (const volumeSize of [0, 10, 50, 10240, undefined]) expect(() => checkBox(boxed({ volumeSize }))).not.toThrow();
  for (const volumeSize of [1, 5, 9, 10.5, 10241, -10]) expect(() => checkBox(boxed({ volumeSize }))).toThrow(/whole number of GB from 10 to 10240/);
  for (const port of [0, 70000, 3000.5]) expect(() => checkBox(boxed({ port }))).toThrow(/port from 1 to 65535/);
  expect(() => checkBox(boxed({ port: 8080 }))).not.toThrow();
  // Railway and edge-only stacks have nothing to check here.
  expect(() => checkBox({ name: "x", targets: { box: { provider: "railway", port: 0 } } } as RustyBunsConfig)).not.toThrow();
  expect(() => checkBox({ name: "x", targets: {} } as RustyBunsConfig)).not.toThrow();
});

test("stack: the port, the old region, secrets from the shell, and no Volume keep data on the root disk", () => {
  const s = generateAlchemy(boxed({ region: "ash", port: 8080, volumeSize: 0 }, { API_KEY: { type: "secret" }, MODE: { type: "var", value: "x" } }));
  expect(s).toContain('location: "ash"');
  expect(s).toContain("  port: 8080,");
  expect(s).toContain(`env: { API_KEY: process.env["API_KEY"] ?? "", DATA_DIR: "/var/lib/hippo" },`);
  expect(s).toContain("declare const process:");
  expect(s).not.toContain("Hetzner.Volume");
  expect(s).not.toContain("yield* Data");
  // With a Volume the unit waits for it, and DATA_DIR is the launcher's to find.
  const v = generateAlchemy(boxed({ volumeSize: 20 }));
  expect(v).toContain('Hetzner.Volume("Data", { size: 20,');
  expect(v.indexOf("yield* Data;")).toBeLessThan(v.indexOf("const service = yield* Service;"));
  expect(v).toContain("env: {  },");
  expect(v).not.toContain("declare const process:");
});

/** The launcher beside a fake host that reports what it was given. */
function launcherDir(c: RustyBunsConfig, host: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rb-box-")));
  writeFileSync(join(dir, "launch.mjs"), boxLauncher(c));
  writeFileSync(join(dir, c.name), `#!/bin/sh\n${host}\n`);
  chmodSync(join(dir, c.name), 0o644);   // as the unit zip leaves it
  return dir;
}
const launch = (dir: string, env: Record<string, string> = {}, ...args: string[]) =>
  Bun.spawn([process.execPath, join(dir, "launch.mjs"), ...args], { env: { PATH: process.env.PATH!, ...env }, stdout: "pipe", stderr: "pipe" });

test("launcher: restores the exec bit, passes args and DATA_DIR, and exits with the host's code", async () => {
  const dir = launcherDir(boxed({ volumeSize: 0 }), `echo "data=$DATA_DIR args=$*"; exit 3`);
  const p = launch(dir, {}, "--flag", "x");
  expect(await p.exited).toBe(3);
  expect(await new Response(p.stdout).text()).toBe("data=/var/lib/hippo args=--flag x\n");
  // DATA_DIR set on the unit wins, Volume or not.
  for (const c of [boxed({ volumeSize: 0 }), boxed()]) {
    const q = launch(launcherDir(c, `echo "$DATA_DIR"`), { DATA_DIR: "/srv/hippo" });
    expect(await q.exited).toBe(0);
    expect(await new Response(q.stdout).text()).toBe("/srv/hippo\n");
  }
});

test("launcher: systemd's SIGTERM reaches the host, and its exit code comes back", async () => {
  const dir = launcherDir(boxed({ volumeSize: 0 }), `trap 'echo stopping; exit 7' TERM\necho up\nwhile :; do sleep 0.05; done`);
  const p = launch(dir);
  const reader = p.stdout.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("up\n");
  p.kill("SIGTERM");
  expect(await p.exited).toBe(7);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("stopping\n");
});

test("launcher: with a Volume, a host whose disk never mounts is not started on the root disk", () => {
  const src = boxLauncher(boxed());
  expect(src).toContain('startsWith("HC_Volume_")');
  expect(src).toContain("process.exit(1)");
  expect(src).not.toContain("/var/lib/hippo");
});

test("guard: dropping a deployed box's Volume, or moving the box to Railway, names the Volume", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rb-box-state-")));
  const stage = join(dir, ".alchemy", "state", "hippo", "prod");
  mkdirSync(stage, { recursive: true });
  for (const [f, v] of Object.entries({
    "Box.json": { logicalId: "Box", resourceType: "Hetzner.Server" },
    "Data.json": { logicalId: "Data", resourceType: "Hetzner.Volume", props: { name: "hippo-prod-data" } },
    "Service.json": { logicalId: "Service", resourceType: "Hetzner.Service" },
  })) writeFileSync(join(stage, f), JSON.stringify(v));
  const check = (c: RustyBunsConfig) => statefulDeletes(dir, c, "prod", generateAlchemy(c));
  expect(check(boxed())).toEqual([]);
  expect(check(boxed({ volumeSize: 0 }))).toEqual(["Volume Data (hippo-prod-data)"]);
  // Railway's Volume is also "Data": the same id from another provider is still a delete.
  for (const volume of [true, false]) {
    const rail = { name: "hippo", bindings: {}, targets: { box: { provider: "railway", volume } } } as RustyBunsConfig;
    expect(check(rail)).toEqual(["Volume Data (hippo-prod-data)"]);
  }
});
