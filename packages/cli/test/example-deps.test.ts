// Every example must still install and deploy once it is copied out of the monorepo (#3353):
// a deploy app carries the pinned set `rustybuns add deploy` writes, and a published
// @rustybuns/* package is a version range the workspace satisfies, not `workspace:*`.
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOY_DEPS, DEPLOY_OVERRIDES } from "../src/glue/deploy-deps.ts";

const repo = join(import.meta.dir, "../../..");

type Deps = Record<string, string>;
function deps(v: unknown): Deps {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
}
function readPkg(file: string): { name: string; version: string; private: boolean; all: Deps; overrides: Deps } {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? new Map(Object.entries(raw)) : new Map<string, unknown>();
  const str = (k: string) => { const v = p.get(k); return typeof v === "string" ? v : ""; };
  return {
    name: str("name"), version: str("version"), private: p.get("private") === true,
    all: { ...deps(p.get("dependencies")), ...deps(p.get("devDependencies")) },
    overrides: deps(p.get("overrides")),
  };
}
const pkgs = (dir: string) => readdirSync(join(repo, dir))
  .map((d) => join(repo, dir, d, "package.json")).filter(existsSync)
  .map((f) => ({ dir: f.split("/").at(-2) ?? f, ...readPkg(f) }));

const published = new Map(pkgs("packages").filter((p) => !p.private).map((p) => [p.name, p.version]));
const apps = pkgs("apps");

/** An app deploys when its rustybuns.config.ts has a `worker` or a box target (tscircuit-desktop is parked, not installed). */
async function deploys(dir: string): Promise<boolean> {
  const file = join(repo, "apps", dir, "rustybuns.config.ts");
  if (dir === "tscircuit-desktop" || !existsSync(file)) return false;
  const mod: unknown = await import(file);
  const config: unknown = mod && typeof mod === "object" && "default" in mod ? mod.default : null;
  if (!config || typeof config !== "object") return false;
  const targets: unknown = "targets" in config ? config.targets : null;
  return ("worker" in config && !!config.worker) || (!!targets && typeof targets === "object" && "box" in targets && !!targets.box);
}

test("every app that deploys carries the pinned deploy set and its overrides", async () => {
  const deployers = (await Promise.all(apps.map(async (a) => ("alchemy" in a.all || await deploys(a.dir) ? [a] : [])))).flat();
  expect(deployers.length).toBeGreaterThan(10);
  const wrong = deployers.flatMap((a) => [
    ...Object.entries(DEPLOY_DEPS).filter(([n, v]) => a.all[n] !== v).map(([n, v]) => `${a.dir}: ${n} is ${a.all[n] ?? "missing"}, want ${v}`),
    ...Object.entries(DEPLOY_OVERRIDES).filter(([n, v]) => a.overrides[n] !== v).map(([n, v]) => `${a.dir}: overrides.${n} is ${a.overrides[n] ?? "missing"}, want ${v}`),
  ]);
  expect(wrong).toEqual([]);
});

test("a published @rustybuns package is a range the workspace satisfies, never workspace:", () => {
  const wrong = apps.flatMap((a) => Object.entries(a.all).flatMap(([n, range]) => {
    const version = published.get(n);
    if (!version) return [];
    return Bun.semver.satisfies(version, range) && !range.startsWith("workspace:") ? [] : [`${a.dir}: ${n} is ${range}, workspace has ${version}`];
  }));
  expect(wrong).toEqual([]);
});
