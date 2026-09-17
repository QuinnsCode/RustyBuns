import { test, expect } from "bun:test";
import { infer } from "../src/glue/infer.ts";
import { analyze, plan } from "../src/glue/boundary.ts";
import { parseWrangler, wranglerToConfig } from "../src/wrangler.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { generateWrangler } from "../src/gen/wrangler.ts";

const root = new URL("../../../apps/spa-example", import.meta.url).pathname;

test("infer: framework, pm, deps, vite aliases from the repo itself", () => {
  const i = infer(root);
  expect(i.framework).toBe("rwsdk");
  expect(i.hasReact).toBe(true);
  expect(i.vite.plugins).toContain("cloudflare");
  expect(i.vite.aliases["@"]).toBe("src");
  expect(i.vite.configPath).not.toBeNull();
});

test("boundary: tiers, action exports, leak via server import, stub names", () => {
  const { modules } = analyze({ root, srcDir: "src", aliases: { "@": "src" } });
  const t = Object.fromEntries(modules.map((m) => [m.file, m.tier]));
  expect(t["src/app/actions/social/socialCrud.ts"]).toBe("action");
  expect(t["src/app/components/Dashboard.tsx"]).toBe("server");
  expect(t["src/app/components/Leaky.tsx"]).toBe("leak");
  expect(t["src/app/components/FriendsPanel.tsx"]).toBe("client");   // importing an action is fine
  expect(t["src/app/components/Pure.tsx"]).toBe("client");
  const p = plan(modules);
  expect(p.actions[0]!.exports).toEqual(["listFriends", "addFriend"]);
  expect(p.stubNames["@/db"]).toEqual(["visits"]);
});

test("wrangler round trip keeps every binding and generates both files", async () => {
  const w = parseWrangler(await Bun.file(root + "/wrangler.jsonc").text());
  const c = wranglerToConfig(w);
  expect(Object.keys(c.bindings).sort()).toEqual(["ASSETS_BUCKET", "BETTER_AUTH_URL", "DB", "MAP_BUILDER_DO", "PRESENCE_KV", "SESSION_DURABLE_OBJECT", "WEBAUTHN_APP_NAME", "WORLD_DURABLE_OBJECT"]);
  const a = generateAlchemy(c);
  expect(a).toContain('Cloudflare.D1.Database("DB"');
  expect(a).toContain("Cloudflare.InferEnv<typeof Worker>");
  expect(a).toContain('WORLD_DURABLE_OBJECT: Cloudflare.DurableObject("WORLD_DURABLE_OBJECT", { className: "WorldDurableObject" })');
  expect(a).not.toContain("DurableObjectNamespace");
  expect(a).toContain('import * as Command from "alchemy/Command"');
  expect(a).toContain("providers: Cloudflare.providers()");
  const g = JSON.parse(generateWrangler(c).replace(/^\/\/.*$/gm, ""));
  expect(g.durable_objects.bindings.length).toBe(3);
  expect(g.r2_buckets[0].bucket_name).toBe("druids-curse-assets");
});

test("layout: app/ with ~ and #lib from tsconfig paths, no src/", () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const r = mkdtempSync(tmpdir() + "/oddapp-");
  mkdirSync(r + "/app/lib", { recursive: true });
  writeFileSync(r + "/package.json", JSON.stringify({ name: "odd", dependencies: { vite: "6", react: "19" } }));
  writeFileSync(r + "/tsconfig.json", `{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./app/*"], "#lib/*": ["./app/lib/*"] } } }`);
  writeFileSync(r + "/app/act.ts", `"use server";\nimport { thing } from "#lib/db";\nexport async function act() { return thing(); }\n`);
  writeFileSync(r + "/app/lib/db.ts", `import { env } from "cloudflare:workers";\nexport const thing = () => env.X;\n`);
  writeFileSync(r + "/app/C.tsx", `"use client";\nimport { act } from "~/act";\nexport const C = () => null;\n`);
  const i = infer(r);
  expect(i.srcDir).toBe("app");
  expect(i.srcDirSource).toBe("tsconfig");
  expect(i.aliases).toEqual({ "~": "app", "#lib": "app/lib" });
  const { modules } = analyze({ root: r, srcDir: i.srcDir, aliases: i.aliases });
  const t = Object.fromEntries(modules.map((m) => [m.file, m.tier]));
  expect(t["app/act.ts"]).toBe("action");
  expect(t["app/lib/db.ts"]).toBe("server");
  expect(t["app/C.tsx"]).toBe("client");
  expect(plan(modules).stubNames["#lib/db"]).toEqual(["thing"]);
});

test("jsonc: URLs and quoted slashes inside comments do not break parsing", async () => {
  const { parseJsonc } = await import("../src/glue/jsonc.ts");
  const j = parseJsonc(`{
    /* see https://aka.ms/tsconfig.json */
    "a": "http://x/y", // trailing
    /** needs "esnext"/"nodenext" and "*" */
    "b": ["*/", "//not a comment"],
  }`);
  expect(j).toEqual({ a: "http://x/y", b: ["*/", "//not a comment"] });
});

test("actions include/exclude globs", async () => {
  const { selectActions, globToRegExp } = await import("../src/glue/desktop-scaffold.ts");
  expect(globToRegExp("src/app/actions/game/**").test("src/app/actions/game/mapActions.ts")).toBe(true);
  expect(globToRegExp("src/app/actions/game/**").test("src/app/actions/social/x.ts")).toBe(false);
  expect(globToRegExp("**/user/functions.ts").test("src/app/pages/user/functions.ts")).toBe(true);
  const mk = (file: string) => ({ file } as any);
  const all = [mk("src/app/actions/game/mapActions.ts"), mk("src/app/actions/social/socialCrud.ts"), mk("src/app/pages/user/functions.ts")];
  expect(selectActions(all, { include: ["src/app/actions/game/**"] }).on.map((m) => m.file)).toEqual(["src/app/actions/game/mapActions.ts"]);
  expect(selectActions(all, { exclude: ["**/user/**", "**/social/**"] }).off.length).toBe(2);
});

test("deploy guardrail: refuses without a matching plan, accepts --yes", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const r = mkdtempSync(tmpdir() + "/rbdeploy-");
  writeFileSync(r + "/package.json", JSON.stringify({ name: "g", dependencies: { vite: "6", react: "19" } }));
  writeFileSync(r + "/wrangler.jsonc", `{ "name": "g", "main": "src/worker.tsx", "compatibility_date": "2026-01-01" }`);
  mkdirSync(r + "/src"); writeFileSync(r + "/src/worker.tsx", "export default { fetch: () => new Response('') }");
  const cli = new URL("../src/index.ts", import.meta.url).pathname;
  // stub bunx so no real alchemy runs; record what it was called with
  const bin = r + "/bin"; mkdirSync(bin);
  writeFileSync(bin + "/bunx", `#!/bin/sh\necho "STUB $@" >> ${r}/calls.log\n`); require("node:fs").chmodSync(bin + "/bunx", 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const run = (...a: string[]) => Bun.spawnSync(["bun", cli, ...a], { cwd: r, env, stdout: "pipe", stderr: "pipe" });
  // init needs @rustybuns/cli resolvable for the config import; link the package dir
  mkdirSync(r + "/node_modules/@rustybuns", { recursive: true });
  require("node:fs").symlinkSync(new URL("..", import.meta.url).pathname, r + "/node_modules/@rustybuns/cli");
  const i = run("init"); if (i.exitCode !== 0) console.log(i.stdout.toString(), i.stderr.toString());
  expect(i.exitCode).toBe(0);
  const d1 = run("deploy");
  expect(d1.exitCode).toBe(2);
  expect(d1.stderr.toString()).toContain("no plan on record");
  expect(run("plan").exitCode).toBe(0);
  expect(run("deploy").exitCode).toBe(0);
  const calls = await Bun.file(r + "/calls.log").text();
  expect(calls).toContain("STUB alchemy plan");
  expect(calls).toContain("STUB alchemy deploy");
  // config change invalidates the plan
  writeFileSync(r + "/rustybuns.config.ts", (await Bun.file(r + "/rustybuns.config.ts").text()).replace('"name": "g"', '"name": "g2"'));
  const d2 = run("deploy");
  expect(d2.exitCode).toBe(2);
  expect(d2.stderr.toString()).toContain("config changed");
  expect(run("deploy", "--yes").exitCode).toBe(0);
});

test("add deploy: pinned install command and overrides per package manager", async () => {
  const { installCommand, applyOverrides } = await import("../src/glue/deploy-deps.ts");
  expect(installCommand("pnpm", true)).toMatch(/^pnpm add -Dw alchemy@2\.0\.0-beta\.77 effect@4\.0\.0-rc\.112 /);
  expect(installCommand("bun", false)).toMatch(/^bun add -d /);
  const p = applyOverrides({ pnpm: { overrides: { "@types/three": "0.185.4" } } }, "pnpm");
  expect(p.changed).toBe(true);
  expect(p.pkg.pnpm.overrides["@types/three"]).toBe("0.185.4");
  expect(p.pkg.pnpm.overrides["@effect/platform-node-shared"]).toBe("4.0.0-rc.112");
  expect(applyOverrides({}, "yarn").pkg.resolutions["effect"]).toBe("4.0.0-rc.112");
});

test("infer worker build from the release script", async () => {
  const { inferWorkerBuild } = await import("../src/glue/build-script.ts");
  const scripts = {
    build: "vite build",
    clean: "pnpm run clean:vite",
    release: "rw-scripts ensure-deploy-env && pnpm run clean && prisma generate && RWSDK_DEPLOY=1 pnpm run build && wrangler deploy",
  };
  expect(inferWorkerBuild(scripts)).toEqual({ build: "prisma generate && RWSDK_DEPLOY=1 vite build", from: "release" });
  expect(inferWorkerBuild({ build: "vite build" })).toEqual({ build: "vite build", from: "build" });
  expect(inferWorkerBuild({ deploy: "npm run build && wrangler deploy", build: "tsc && vite build" })).toEqual({ build: "tsc && vite build", from: "deploy" });
  expect(inferWorkerBuild({})).toEqual({ build: "vite build", from: "default" });
});

test("spa entry: desktop-only app with a host module, no world, header overrides", async () => {
  const { spaEntry } = await import("../src/build.ts");
  const src = spaEntry({
    name: "tsci-desk",
    targets: { desktop: { mode: "spa", world: false, host: "desktop/host.ts", headers: { "Cross-Origin-Embedder-Policy": "credentialless" } } },
  } as any);
  expect(src).not.toContain("import World");
  expect(src).toContain('import host from "../desktop/host.ts"');
  expect(src).toContain("const WORLD: any = null;");
  expect(src).toContain('"Cross-Origin-Embedder-Policy":"credentialless"');
  expect(src).toContain("await host.fetch(req, hostCtx)");
});

test("spa entry: default still binds the world and has no host", async () => {
  const { spaEntry } = await import("../src/build.ts");
  const src = spaEntry({ name: "x", bindings: {}, targets: { desktop: { mode: "spa" } } } as any);
  expect(src).toContain('import World from "../packages/desktop/world.ts"');
  expect(src).toContain("const host: any = null;");
});

test("nativeDirs refuses crates that were not built", async () => {
  const { nativeDirs } = await import("../src/build.ts");
  expect(() => nativeDirs(["definitely_not_built"])).toThrow(/not built/);
  expect(nativeDirs()).toEqual([]);
});

test("build desktop refuses a client build in dist/, where the binary goes", async () => {
  const { buildDesktop } = await import("../src/build.ts");
  const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "rb-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await expect(buildDesktop({ name: "x", targets: { desktop: { mode: "spa", clientDir: "dist", world: false } } } as any)).rejects.toThrow(/dist\/ui/);
  } finally { process.chdir(cwd); }
});
