import { test, expect } from "bun:test";
import { infer } from "../src/glue/infer.ts";
import { analyze, plan } from "../src/glue/boundary.ts";
import { parseWrangler, wranglerToConfig } from "../src/wrangler.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { generateWrangler } from "../src/gen/wrangler.ts";
import { desktopEntry, spaEntry } from "../src/build.ts";

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
  // stub the project's alchemy so no real one runs; record what it was called with
  const bin = r + "/node_modules/.bin"; mkdirSync(bin, { recursive: true });
  writeFileSync(bin + "/alchemy", `#!/bin/sh\necho "STUB alchemy $@" >> ${r}/calls.log\n`); require("node:fs").chmodSync(bin + "/alchemy", 0o755);
  const env = { ...process.env };
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
  expect(installCommand("pnpm", true)).toMatch(/^pnpm add -Dw alchemy@2\.0\.0-beta\.77 @alchemy\.run\/frontend-frameworks@2\.0\.0-beta\.77 effect@4\.0\.0-rc\.112 /);
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

import { entryImport, entryName } from "../src/glue/desktop-scaffold.ts";
test("add desktop --entry: path is relative to packages/desktop, #Name is a named import", () => {
  expect(entryImport("/app", "/app/packages/desktop", "./src/ui/App.tsx#App")).toBe('import { App } from "../../src/ui/App.tsx";');
  expect(entryImport("/app", "/app/packages/desktop", "./src/Main.tsx")).toBe('import App from "../../src/Main.tsx";');
  expect(entryImport("/app", "/app/packages/desktop", "@/app/App#Game")).toBe('import { Game } from "@/app/App";');
  expect(entryName("./x.tsx#Game")).toBe("Game");
  expect(entryName("./x.tsx")).toBe("App");
});

test("mounts under ~ or an absolute path are not embedded in the binary", () => {
  const c = wranglerToConfig(parseWrangler('{"name":"m","main":"src/w.ts","compatibility_date":"2025-05-07"}'));
  const host = spaEntry({ ...c, targets: { ...c.targets, desktop: { ...(c.targets as any).desktop, mounts: { "/scenes": "~/SplatRooms", "/asset": ".asset-cache" } } } } as any);
  expect(host).toContain('"/scenes": resolveDir("~/SplatRooms")');
  expect(host).toContain('rel.startsWith("~")');   // the generated host expands it at runtime
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

test("boundary vite plugin swaps actions when vite reports a Windows path", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { generateBoundaryFiles } = await import("../src/glue/desktop-scaffold.ts");
  const r = mkdtempSync(tmpdir() + "/rbwin-");
  mkdirSync(r + "/src/actions", { recursive: true });
  writeFileSync(r + "/package.json", JSON.stringify({ name: "w", dependencies: { vite: "6" } }));
  writeFileSync(r + "/src/actions/bounce.ts", `"use server";\nexport async function bounce() { return 1; }\n`);
  const { modules } = analyze({ root: r, srcDir: "src", aliases: {} });
  await generateBoundaryFiles(r, infer(r), modules, {});
  const { rustybuns } = await import(r + "/.rustybuns/vite.ts");
  const action = `${r}/src/actions/bounce.ts`;
  const asVite = (id: string) => ({ resolve: async () => ({ id }) });
  const proxy = await rustybuns().resolveId.call(asVite(action), "./bounce", r + "/src/x.ts", {});
  expect(proxy).toMatch(/\.rustybuns\/actions\/.*bounce.*\.ts$/);
  // Windows: same file, backslashes (Vite normalizes, but join() on Windows does not)
  expect(await rustybuns().resolveId.call(asVite(action.replace(/\//g, "\\")), "./bounce", r + "/src/x.ts", {})).toBe(proxy);
});

import { boxArch, boxLauncher } from "../src/box.ts";
test("box: Hetzner stack runs the launcher, edge stays off unless asked for", () => {
  const c = wranglerToConfig(parseWrangler('{"name":"b","main":"src/w.ts","compatibility_date":"2025-05-07"}'));
  c.bindings.API_KEY = { type: "secret" };
  const both = generateAlchemy({ ...c, targets: { ...c.targets, box: { provider: "hetzner" } } });
  expect(both).toContain('Hetzner.Server("Box", { serverType: "cpx12", image: "ubuntu-24.04", location: "nbg1" })');
  // the Volume gets the created Server (its serverId), not the Server's definition
  expect(both).toContain("const box = yield* Box;");
  expect(both).toContain('Hetzner.Volume("Data", { size: 10, format: "ext4", server: box, automount: true })');
  expect(both).not.toContain("server: Box, automount");
  expect(both).toContain('main: ".rustybuns/box/launch.mjs"');
  expect(both).toContain("isExternal: true");
  expect(both).toContain('API_KEY: process.env["API_KEY"] ?? ""');
  expect(both).toContain("Layer.mergeAll(Cloudflare.providers(), Hetzner.providers())");
  const boxOnly = generateAlchemy({ ...c, targets: { box: { provider: "hetzner", serverType: "cax11", volumeSize: 0 } } });
  expect(boxOnly).not.toContain("Cloudflare");
  expect(boxOnly).not.toContain("Hetzner.Volume");
  expect(boxOnly).toContain('DATA_DIR: "/var/lib/b"');
  expect(boxOnly).toContain("providers: Hetzner.providers()");
  expect(boxArch("cax11")).toBe("linux-arm64");
  expect(boxArch("cpx12")).toBe("linux-x64");
  expect(boxLauncher({ ...c, targets: { box: { provider: "hetzner" } } })).toContain("HC_Volume_");
});

test("box host: public bind, no token, /health, secrets from env, no browser", () => {
  const c = wranglerToConfig(parseWrangler('{"name":"b","main":"src/w.ts","compatibility_date":"2025-05-07"}'));
  c.bindings.API_KEY = { type: "secret" };
  const box = spaEntry(c, "box");
  expect(box).toContain('hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000)');
  expect(box).toContain("const token = undefined;");
  expect(box).toContain('url.pathname === "/health"');
  expect(box).toContain('API_KEY: process.env["API_KEY"] ?? ""');
  expect(box).toContain('process.env.DATA_DIR ?? "/var/lib/b"');
  expect(box).not.toContain("await openBrowser");
  // Public box: every socket is a guest with its own id; no hosting controls.
  expect(box).toContain("const guest = true;");
  expect(box).toContain("const id = boxIdentity(url);");
  expect(box).toContain('if (url.pathname === "/__rb/host") return reject(404, "not_on_box");');
  expect(box).not.toContain("version_mismatch");
  expect(box).toContain('if (url.pathname === "/__rb/info") return reject(404, "not_on_box");');
  expect(box).toContain("WORLD.idFromName(room)");
  expect(box).toContain("MAX_ROOMS = 200");
  expect(box).toContain('"X-RB-Data": dataMount, "X-RB-Boots": String(boots)');
  expect(box).toContain('join(dataDir, ".rb-boots")');
  const desk = spaEntry(c);
  expect(desk).toContain('const guest = req.headers.get("x-rb-principal") === "guest";');
  expect(desk).not.toContain("boxIdentity");
  expect(desk).toContain('WORLD.idFromName("local")');
  expect(desk).not.toContain("not_on_box");
  expect(desk).toContain("version_mismatch");
  expect(desk).toContain("const token = mintToken();");
  expect(desk).toContain("await openBrowser");
  expect(desk).not.toContain("/health");
});

test("box: honors desktop.host and headers; a box-only app needs no worker section", () => {
  const c = { name: "tsci", bindings: {}, targets: { box: { provider: "hetzner" }, desktop: { mode: "spa", world: false, host: "desktop/host.ts", headers: { "Cross-Origin-Embedder-Policy": "credentialless" } } } } as any;
  const box = spaEntry(c, "box");
  expect(box).toContain('import host from "../desktop/host.ts"');
  expect(box).toContain('"Cross-Origin-Embedder-Policy":"credentialless"');
  expect(box).toContain('hostname: "0.0.0.0"');
  expect(box).toContain('url.pathname === "/health"');
  const stack = generateAlchemy(c);
  expect(stack).toContain('Hetzner.Service("Service"');
  expect(stack).not.toContain("Cloudflare");
  expect(() => generateAlchemy({ ...c, targets: { ...c.targets, edge: { provider: "cloudflare" } } })).toThrow(/no worker section/);
});

import { railwayDockerfile } from "../src/box.ts";
test("box: Railway stack uploads the bundle context, sleeps by default, data on a Volume", () => {
  const c = wranglerToConfig(parseWrangler('{"name":"b","main":"src/w.ts","compatibility_date":"2025-05-07"}'));
  c.bindings.API_KEY = { type: "secret" };
  const both = generateAlchemy({ ...c, targets: { ...c.targets, box: { provider: "railway", region: "europe-west4" } } });
  expect(both).toContain('import * as Railway from "alchemy/Railway"');
  expect(both).toContain("declare const process");
  expect(both).toContain('export const Project = Railway.Project("Project");');
  expect(both).toContain('context: ".rustybuns/railway"');
  expect(both).toContain('region: "europe-west4"');
  expect(both).toContain('healthcheckPath: "/health"');
  expect(both).toContain("sleepApplication: true");
  expect(both).toContain('DATA_DIR: "/data", API_KEY: process.env["API_KEY"] ?? ""');
  expect(both).toContain('Railway.Volume("Data", { project: Project, service: Service, mountPath: "/data", region: "europe-west4" })');
  expect(both).toContain("Layer.mergeAll(Cloudflare.providers(), Railway.providers())");
  expect(both).toContain("return { url: worker.url, box: service.url };");
  expect(both).not.toContain("Hetzner");
  const boxOnly = generateAlchemy({ ...c, targets: { box: { provider: "railway", volume: false, sleep: false } } });
  expect(boxOnly).not.toContain("Cloudflare");
  expect(boxOnly).not.toContain("Railway.Volume");
  expect(boxOnly).toContain('DATA_DIR: "/var/lib/b"');
  expect(boxOnly).toContain("sleepApplication: false");
  expect(boxOnly).toContain("providers: Railway.providers()");
  expect(railwayDockerfile("1.4.2")).toContain("FROM oven/bun:1.4.2-slim");
  expect(railwayDockerfile("1.4.2")).toContain('CMD ["bun", "/app/box.js"]');
});

import { generateEnvSchema, mintedSecrets } from "../src/wheel.ts";
test("experimental.wheel: agent mints secrets in the stack, op secrets go through varlock", () => {
  const c = wranglerToConfig(parseWrangler('{"name":"w","main":"src/w.ts","compatibility_date":"2025-05-07"}'));
  c.bindings.SESSION_SECRET = { type: "secret" };
  c.bindings.STRIPE_KEY = { type: "secret", op: "op://rb-test/stripe/credential" };
  // No flag: unchanged, and an op reference alone is refused.
  expect(() => generateAlchemy(c)).toThrow(/needs experimental.wheel/);
  delete c.bindings.STRIPE_KEY.op;
  expect(generateAlchemy(c)).toContain('SESSION_SECRET: Config.redacted("SESSION_SECRET")');
  expect(generateEnvSchema(c)).toBeNull();
  c.bindings.STRIPE_KEY = { type: "secret", op: "op://rb-test/stripe/credential" };

  const agent = { ...c, experimental: { wheel: "agent" as const } };
  expect(mintedSecrets(agent)).toEqual(["SESSION_SECRET"]);
  const edge = generateAlchemy(agent);
  expect(edge).toContain("export const Worker = Effect.gen(function* () {");
  expect(edge).toContain('  const SESSION_SECRET = yield* Alchemy.makeRandom("SESSION_SECRET");');
  expect(edge).toContain('  return yield* Cloudflare.Worker("Worker", {');
  expect(edge).toContain('SESSION_SECRET: SESSION_SECRET, STRIPE_KEY: Config.redacted("STRIPE_KEY")');
  expect(edge).toContain("Cloudflare.InferEnv<typeof Worker>");
  const schema = generateEnvSchema(agent)!;
  expect(schema).toContain("# @plugin(@varlock/1password-plugin@2.0.4)");
  expect(schema).toContain("# @initOp(token=$OP_TOKEN, allowAppAuth=false)");
  expect(schema).toContain("STRIPE_KEY=op(op://rb-test/stripe/credential)");
  expect(schema).toContain("# SESSION_SECRET: minted by the stack");
  expect(schema).not.toContain("SESSION_SECRET=");

  // Railway: the minted value rides in the Service env; the Volume attaches to the created Service.
  const rail = generateAlchemy({ ...agent, targets: { box: { provider: "railway" } } });
  expect(rail).toContain('return yield* Railway.Service("Service", {');
  expect(rail).toContain('STRIPE_KEY: process.env["STRIPE_KEY"] ?? "", SESSION_SECRET: SESSION_SECRET');
  expect(rail).toContain('return yield* Railway.Volume("Data", { project: Project, service, mountPath: "/data" });');
  expect(rail).toContain("providers: Layer.mergeAll(Railway.providers(), Alchemy.RandomProvider())");
  expect(() => generateAlchemy({ ...agent, targets: { ...c.targets, box: { provider: "hetzner" } } })).toThrow(/can't mint secrets on a Hetzner box/);

  // Human: nothing minted, 1Password through the app only.
  const human = { ...c, experimental: { wheel: "human" as const } };
  expect(mintedSecrets(human)).toEqual([]);
  expect(generateAlchemy(human)).toContain('SESSION_SECRET: Config.redacted("SESSION_SECRET")');
  expect(generateEnvSchema(human)).toContain("# @initOp(allowAppAuth=true)");
  expect(generateEnvSchema(human)).not.toContain("OP_TOKEN");
  // Every secret is listed, so the schema is the whole contract; no op secrets means no plugin.
  expect(generateEnvSchema(human)).toContain("# @sensitive\nSESSION_SECRET=\n");
  const plain = generateEnvSchema({ ...human, bindings: { SESSION_SECRET: { type: "secret" } } })!;
  expect(plain).not.toContain("@plugin");
  expect(plain).toContain("SESSION_SECRET=");
  expect(() => generateAlchemy({ ...human, bindings: { X: { type: "secret", op: "vault/item" } } })).toThrow(/1Password reference/);
});

test("worker-mode host applies D1 migrations, like the spa host", () => {
  const src = desktopEntry({
    name: "w", worker: { main: "src/worker.ts", assets: "dist/client" },
    bindings: { DB: { type: "d1", databaseName: "w-db", migrationsDir: "migrations" } },
    targets: { desktop: { mode: "worker" } },
  } as any);
  expect(src).toContain(`applyD1Migrations(env.DB as any, assetDir("migrations")!)`);
});

test("artifacts: wrangler, alchemy and the desktop host all get the binding", () => {
  const c = {
    name: "g", worker: { main: "src/worker.ts", assets: "dist/client", compatibilityDate: "2026-06-01", compatibilityFlags: [] },
    bindings: { ARTIFACTS: { type: "artifacts", namespace: "codesplitters" } },
    targets: { edge: { provider: "cloudflare" }, desktop: { mode: "worker" } },
  } as any;
  expect(generateWrangler(c)).toContain(`"artifacts": [\n    {\n      "binding": "ARTIFACTS",\n      "namespace": "codesplitters"`);
  const a = generateAlchemy(c);
  expect(a).toContain(`export const ARTIFACTS = Cloudflare.Artifacts.Namespace("ARTIFACTS", { namespace: "codesplitters" });`);
  expect(a).toContain(`ARTIFACTS: ARTIFACTS`);
  const host = desktopEntry(c);
  expect(host).toContain(`ARTIFACTS: local.artifacts("codesplitters"),`);
  expect(host).toContain(`open: { "/__rb/git/": (req: Request) => gitHttp(req, [env.ARTIFACTS as any]) },`);
  expect(host).toContain(`(env.ARTIFACTS as any).remoteBase = shell.url;`);
});
