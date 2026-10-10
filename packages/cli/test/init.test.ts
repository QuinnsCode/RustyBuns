import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferTsconfigAliases, detectPm } from "../src/glue/infer.ts";
import { parseWranglerToml, droppedWranglerKeys } from "../src/wrangler.ts";
import { workspaceRoot } from "../src/glue/deploy-deps.ts";

const CLI = new URL("../src/index.ts", import.meta.url).pathname;

/** Make a throwaway project from { path: contents } and run the real CLI in it. */
function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "rb-init-"));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  const run = (...args: string[]) => {
    const p = Bun.spawnSync(["bun", CLI, ...args], { cwd: dir, env: { ...process.env, npm_config_user_agent: "" } });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };
  return { dir, run, read: (f: string) => readFileSync(join(dir, f), "utf8") };
}

const VITE = JSON.stringify({ name: "spa", dependencies: { vite: "^5", react: "^18" } });

test("init: refuses to overwrite an existing config unless --force", () => {
  const p = project({ "package.json": VITE, "src/main.tsx": "" });
  expect(p.run("init").code).toBe(0);
  writeFileSync(join(p.dir, "rustybuns.config.ts"), p.read("rustybuns.config.ts") + "// mine\n");
  const again = p.run("init");
  expect(again.code).toBe(1);
  expect(again.out).toMatch(/already exists/);
  expect(p.read("rustybuns.config.ts")).toContain("// mine");
  expect(p.run("init", "--force").code).toBe(0);
  expect(p.read("rustybuns.config.ts")).not.toContain("// mine");
});

test("init: no package.json, unknown framework and monorepo roots are refused before writing", () => {
  const none = project({});
  expect(none.run("init").out).toMatch(/no package\.json/);
  expect(existsSync(join(none.dir, "rustybuns.config.ts"))).toBe(false);

  const unk = project({ "package.json": '{"name":"x"}' });
  expect(unk.run("init").out).toMatch(/does not look like a web app/);
  expect(unk.run("init", "--force").code).toBe(0);

  const mono = project({ "package.json": '{"name":"m","workspaces":["apps/*"]}' });
  expect(mono.run("init").out).toMatch(/monorepo root/);
  expect(existsSync(join(mono.dir, "rustybuns.config.ts"))).toBe(false);
});

test("init: malformed package.json fails up front with the file named", () => {
  const p = project({ "package.json": "{oops" });
  const r = p.run("init");
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/package\.json is not valid JSON/);
  expect(existsSync(join(p.dir, "rustybuns.config.ts"))).toBe(false);
  expect(existsSync(join(p.dir, "desktop"))).toBe(false);
});

test("init: wrangler keys that cannot be carried over are reported, and adopt refuses to drop them", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts", // comment
      "ai": { "binding": "AI" }, "triggers": { "crons": ["* * * * *"] }, "env": { "staging": {} },
      "d1_databases": [{ "binding": "DB", "database_name": "d" }] }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/not carried over: ai, env/);
  expect(r.out).toMatch(/adopt will refuse/);
  expect(p.read("wrangler.jsonc")).toContain('"ai"');
  const adopt = p.run("adopt");
  expect(adopt.code).toBe(1);
  expect(adopt.out).toMatch(/adopt would delete from wrangler\.jsonc: ai, env/);
  expect(p.read("wrangler.jsonc")).toContain('"ai"');
  expect(p.run("adopt", "--force").code).toBe(0);
  expect(p.read("rustybuns.config.ts")).toMatch(/"crons": \[\s*"\* \* \* \* \*"\s*\]/);   // Cron Triggers carry over
});

test("init: wrangler.toml is read, and a missing worker entry is flagged", () => {
  const p = project({
    "package.json": VITE,
    "wrangler.toml": `name = "t"\nmain = "src/missing.ts"\n[[kv_namespaces]]\nbinding = "KV"\nid = "x"\n`,
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/does not exist/);
  expect(p.read("rustybuns.config.ts")).toContain('"KV"');
});

test("init --spa with a wrangler file says it is ignoring it", () => {
  const p = project({ "package.json": VITE, "wrangler.jsonc": '{"name":"w"}' });
  const r = p.run("init", "--spa");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/ignoring wrangler\.jsonc/);
});

test("init: a project-root source guess is called out", () => {
  const p = project({ "package.json": VITE });
  expect(p.run("init").out).toMatch(/whole project root is treated as source/);
});

test("tsconfig: relative extends is followed, nearer paths win, baseUrl is per-file", () => {
  const p = project({
    "tsconfig.json": '{ "extends": "./config/tsconfig.base", "compilerOptions": { "paths": { "~/*": ["./web/*"] } } }',
    "config/tsconfig.base.json": '{ "compilerOptions": { "baseUrl": "..", "paths": { "@/*": ["app/*"], "~/*": ["old/*"] } } }',
  });
  expect(inferTsconfigAliases(p.dir)).toEqual({ "@": "app", "~": "web" });
});

test("tsconfig: extends cycles and package presets do not hang or throw", () => {
  const p = project({
    "tsconfig.json": '{ "extends": ["@tsconfig/node20/tsconfig.json", "./a.json"] }',
    "a.json": '{ "extends": "./tsconfig.json", "compilerOptions": { "paths": { "@/*": ["src/*"] } } }',
  });
  expect(inferTsconfigAliases(p.dir)).toEqual({ "@": "src" });
});

test("package manager: lockfiles, then packageManager field", () => {
  expect(detectPm(project({ "package-lock.json": "{}" }).dir)).toBe("npm");
  expect(detectPm(project({ "package.json": '{"packageManager":"pnpm@9.1.0"}' }).dir)).toBe("pnpm");
  expect(detectPm(project({ "yarn.lock": "", "package-lock.json": "{}" }).dir)).toBe("yarn");
});

test("wrangler toml parse and dropped keys", () => {
  const w = parseWranglerToml('name = "x"\n[ai]\nbinding = "AI"\n[triggers]\ncrons = ["* * * * *"]\n');
  expect(droppedWranglerKeys(w)).toEqual(["ai"]);
});

test("add deploy writes overrides at the workspace root, where bun reads them", () => {
  const root = mkdtempSync(join(tmpdir(), "rb-ws-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*", "apps/*"] }));
    for (const d of ["apps/web", "packages/lib", "tools/script"]) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, "package.json"), "{}"); }
    expect(workspaceRoot(join(root, "apps/web"))).toBe(root);
    expect(workspaceRoot(join(root, "packages/lib"))).toBe(root);
    expect(workspaceRoot(join(root, "tools/script"))).toBeNull();      // not a listed member
    expect(workspaceRoot(root)).toBeNull();                                // the root itself is not a member
    // yarn's object form, and a negated pattern
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: { packages: ["apps/*"] } }));
    expect(workspaceRoot(join(root, "apps/web"))).toBe(root);
    // a lone project has no workspace
    const lone = mkdtempSync(join(tmpdir(), "rb-lone-"));
    writeFileSync(join(lone, "package.json"), JSON.stringify({ name: "solo" }));
    expect(workspaceRoot(lone)).toBeNull();
    rmSync(lone, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const ASTRO_CF = `import { defineConfig } from "astro/config";\nimport cloudflare from "@astrojs/cloudflare";\nexport default defineConfig({ output: "server", adapter: cloudflare() });\n`;

test("init: Astro with @astrojs/cloudflare runs the adapter's Worker, on the desktop too", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "@me/site", scripts: { build: "astro build" }, dependencies: { astro: "^7", "@astrojs/cloudflare": "^14" } }),
    "astro.config.mjs": ASTRO_CF,
    "src/pages/index.astro": "",
    "wrangler.jsonc": '{ "name": "site", "compatibility_date": "2026-09-01", "kv_namespaces": [{ "binding": "COUNTER" }] }',
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: astro/);
  expect(r.out).not.toMatch(/does not exist/);
  const cfg = p.read("rustybuns.config.ts");
  expect(cfg).toContain('"main": "@astrojs/cloudflare/entrypoints/server"');
  expect(cfg).toContain('"builtMain": "dist/server/entry.mjs"');
  expect(cfg).toContain('"assets": "dist/client"');
  expect(cfg).toContain('"build": "astro build"');
  expect(cfg).toContain('"mode": "worker"');
  expect(cfg).toMatch(/"COUNTER"[\s\S]*"SESSION"/);
  expect(cfg).not.toContain("clientBuild");

  // No wrangler file: the package name, the default session binding, and a build with no script.
  const bare = project({
    "package.json": JSON.stringify({ name: "@me/bare", dependencies: { astro: "^7", "@astrojs/cloudflare": "^14" } }),
    "astro.config.ts": ASTRO_CF.replace("adapter: cloudflare()", 'adapter: cloudflare({ sessionKVBindingName: "SESS" })'),
  });
  expect(bare.run("init").code).toBe(0);
  const b = bare.read("rustybuns.config.ts");
  expect(b).toContain('"name": "bare"');
  expect(b).toContain('"SESS"');
  expect(b).toContain('"build": "astro build"');
});

test("init: static Astro is a desktop-only site; another adapter is refused", () => {
  const s = project({ "package.json": JSON.stringify({ name: "s", dependencies: { astro: "^7" } }), "astro.config.mjs": "export default {};\n", "bun.lock": "" });
  const r = s.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/a static Astro site/);
  expect(s.read("rustybuns.config.ts")).toContain('"clientBuild": "bunx astro build --outDir dist/ui"');

  const node = project({
    "package.json": JSON.stringify({ name: "n", dependencies: { astro: "^7", "@astrojs/node": "^9" } }),
    "astro.config.mjs": 'import node from "@astrojs/node";\nexport default { output: "server", adapter: node({ mode: "standalone" }) };\n',
  });
  const n = node.run("init");
  expect(n.code).toBe(1);
  expect(n.out).toMatch(/uses @astrojs\/node.*astro add cloudflare/);
  expect(existsSync(join(node.dir, "rustybuns.config.ts"))).toBe(false);
});
