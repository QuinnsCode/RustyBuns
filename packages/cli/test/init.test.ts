import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferTsconfigAliases, detectPm } from "../src/glue/infer.ts";
import { parseWranglerToml, droppedWranglerKeys } from "../src/wrangler.ts";
import { workspaceRoot } from "../src/glue/deploy-deps.ts";
import { viteConfig } from "../src/glue/port-vite.ts";

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
  const none = project({ "README.md": "# hi" });
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
      "vectorize": [{ "binding": "V", "index_name": "v" }], "triggers": { "crons": ["* * * * *"] }, "env": { "staging": {} },
      "d1_databases": [{ "binding": "DB", "database_name": "d" }] }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/not carried over: vectorize, env/);
  expect(r.out).toMatch(/adopt will refuse/);
  expect(p.read("wrangler.jsonc")).toContain('"vectorize"');
  const adopt = p.run("adopt");
  expect(adopt.code).toBe(1);
  expect(adopt.out).toMatch(/adopt would delete from wrangler\.jsonc: vectorize, env/);
  expect(p.read("wrangler.jsonc")).toContain('"vectorize"');
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
  // A Vectorize index's dimensions aren't in wrangler's config, so it can't be carried over; Workers AI can.
  const w = parseWranglerToml('name = "x"\n[ai]\nbinding = "AI"\n[[vectorize]]\nbinding = "V"\nindex_name = "v"\n[triggers]\ncrons = ["* * * * *"]\n');
  expect(droppedWranglerKeys(w)).toEqual(["vectorize"]);
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
  expect(cfg).toMatch(/"IMAGES": \{\s*"type": "images"/);
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
  expect(b).toContain('"IMAGES"');

  // Images: a renamed binding is followed; compile and passthrough need none.
  const imageCfg = (opts: string) => {
    const q = project({
      "package.json": JSON.stringify({ name: "q", dependencies: { astro: "^7", "@astrojs/cloudflare": "^14" } }),
      "astro.config.mjs": ASTRO_CF.replace("adapter: cloudflare()", `adapter: cloudflare(${opts})`),
    });
    expect(q.run("init").code).toBe(0);
    return q.read("rustybuns.config.ts");
  };
  expect(imageCfg('{ imagesBindingName: "PICS" }')).toMatch(/"PICS": \{\s*"type": "images"/);
  expect(imageCfg('{ imageService: "cloudflare-binding" }')).toContain('"type": "images"');
  expect(imageCfg('{ imageService: "compile" }')).not.toContain('"type": "images"');
  expect(imageCfg('{ imageService: "passthrough" }')).not.toContain('"type": "images"');
  expect(imageCfg('{ imageService: { build: "compile", runtime: "cloudflare-binding" } }')).toContain('"type": "images"');
  expect(imageCfg('{ imageService: { build: "compile" } }')).not.toContain('"type": "images"');
  expect(b).toContain('"build": "astro build"');
});

test("init: static Astro is the desktop and a static site on the web; another adapter is refused", () => {
  const s = project({ "package.json": JSON.stringify({ name: "s", dependencies: { astro: "^7" } }), "astro.config.mjs": "export default {};\n", "bun.lock": "" });
  const r = s.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/a static Astro site: the desktop, and the web/);
  const c = s.read("rustybuns.config.ts");
  expect(c).toContain('"clientBuild": "bunx astro build --outDir dist/ui"');
  expect(c).toContain('"build": "bunx astro build --outDir dist/web"');
  expect(c).toContain('"notFoundHandling": "404-page"');

  const node = project({
    "package.json": JSON.stringify({ name: "n", dependencies: { astro: "^7", "@astrojs/node": "^9" } }),
    "astro.config.mjs": 'import node from "@astrojs/node";\nexport default { output: "server", adapter: node({ mode: "standalone" }) };\n',
  });
  const n = node.run("init");
  expect(n.code).toBe(1);
  expect(n.out).toMatch(/uses @astrojs\/node.*astro add cloudflare/);
  expect(existsSync(join(node.dir, "rustybuns.config.ts"))).toBe(false);
});

test("init: a plain Vite SPA goes on the web as an assets-only Worker; one with a Node server stays desktop-only", () => {
  const p = project({ "package.json": VITE, "bun.lock": "", "src/main.tsx": "" });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/the desktop, and the web as static files on Workers/);
  expect(r.out).toMatch(/rustybuns plan/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"edge": {\n      "provider": "cloudflare"');
  expect(c).toContain('"assets": "dist/web"');
  expect(c).toContain('"build": "bunx vite build --outDir dist/web --emptyOutDir"');
  expect(c).toContain('"notFoundHandling": "single-page-application"');
  expect(c).not.toContain('"main"');
  // plan's generate step: a Worker with no main line, Cloudflare serving the files itself.
  expect(p.run("generate").code).toBe(0);
  const a = p.read(".rustybuns/alchemy.run.ts");
  expect(a).not.toMatch(/^\s*main:/m);
  expect(a).toContain('directory: "dist/web"');
  expect(a).toContain('notFoundHandling: "single-page-application"');

  const k = project({ "package.json": JSON.stringify({ name: "kuma", dependencies: { vite: "^5", express: "^4", "socket.io": "^4" } }), "bun.lock": "" });
  const kr = k.run("init");
  expect(kr.code).toBe(0);
  expect(kr.out).toMatch(/desktop-only: it runs a Node server \(express, socket\.io\)/);
  expect(k.read("rustybuns.config.ts")).not.toContain('"edge"');
});

test("init: a plain Worker from wrangler gets no RWSDK build; a Vite-plugin one builds where the plugin writes", () => {
  const w = project({
    "package.json": JSON.stringify({ name: "d1-app", scripts: { deploy: "wrangler deploy", predeploy: "wrangler d1 migrations apply DB --remote" }, devDependencies: { wrangler: "^4" } }),
    "wrangler.json": JSON.stringify({ name: "d1-app", main: "src/index.ts", compatibility_date: "2025-10-08", d1_databases: [{ binding: "DB", database_name: "d1-app-db", database_id: "x" }] }),
    "src/index.ts": "export default { fetch: () => new Response('hi') };\n", "bun.lock": "",
  });
  const r = w.run("init", "--force");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/build:    none \(a plain Worker: Alchemy bundles src\/index\.ts\)/);
  const c = w.read("rustybuns.config.ts");
  for (const k of ['"builtMain"', '"assets"', '"build"']) expect(c).not.toContain(k);
  expect(w.read(".rustybuns/alchemy.run.ts")).toContain('main: "src/index.ts"');

  const v = project({
    "package.json": JSON.stringify({ name: "vite-react-template", scripts: { build: "tsc -b && vite build", deploy: "wrangler deploy" }, dependencies: { react: "^19" }, devDependencies: { vite: "^7", "@cloudflare/vite-plugin": "^1" } }),
    "vite.config.ts": 'import { cloudflare } from "@cloudflare/vite-plugin";\nexport default { plugins: [cloudflare()] };\n',
    "wrangler.json": JSON.stringify({ name: "vite-react-template", main: "./src/worker/index.ts", compatibility_date: "2025-10-08", assets: { directory: "./dist/client", not_found_handling: "single-page-application" } }),
    "src/worker/index.ts": "export default {};\n", "bun.lock": "",
  });
  const vr = v.run("init");
  expect(vr.code).toBe(0);
  const vc = v.read("rustybuns.config.ts");
  expect(vc).toContain('"builtMain": "dist/vite_react_template/index.js"');
  expect(vc).toContain('"build": "tsc -b && vite build"');   // the build script, not the deploy-only one
  expect(vc).toContain('"notFoundHandling": "single-page-application"');
});

test("init: an Astro adapter entry that's a package isn't reported missing", () => {
  const a = project({
    "package.json": JSON.stringify({ name: "bc", scripts: { build: "astro build" }, dependencies: { astro: "^5", "@astrojs/cloudflare": "^12" } }),
    "astro.config.mjs": 'import cloudflare from "@astrojs/cloudflare";\nexport default { output: "server", adapter: cloudflare() };\n',
    "wrangler.jsonc": JSON.stringify({ name: "bc", main: "@astrojs/cloudflare/entrypoints/server", compatibility_date: "2025-10-08" }), "bun.lock": "",
  });
  const r = a.run("init");
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/does not exist/);
});

test("init: a vite root of public/ builds into the app's dist, not public/dist", () => {
  const { viteRoot } = require("../src/glue/infer.ts");
  expect(viteRoot('export default { root: "public" }')).toBe("public");
  expect(viteRoot("export default { root: './src/app', plugins: [] }")).toBe("src/app");
  expect(viteRoot("export default defineConfig({ root: resolve(__dirname, 'public'), base: './' })")).toBe("public");
  expect(viteRoot("const root = path.join(import.meta.dirname, 'web', 'ui');\nexport default defineConfig({\n  root,\n})")).toBe("web/ui");
  expect(viteRoot("export default { plugins: [react()] }")).toBeNull();
  const p = project({ "package.json": VITE, "bun.lock": "", "vite.config.ts": "import { resolve } from 'node:path';\nexport default { root: resolve(import.meta.dirname, 'public') };\n" });
  expect(p.run("init").code).toBe(0);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"build": "bunx vite build --outDir ../dist/web --emptyOutDir"');
  expect(c).toContain('"clientBuild": "bunx vite build --outDir ../dist/ui --emptyOutDir"');
  expect(c).toContain('"assets": "dist/web"');
});

test("init: a static build runs the app's prebuild steps, reads its non-default vite config and new URL aliases", () => {
  const { inferStaticBuild } = require("../src/glue/build-script.ts");
  expect(inferStaticBuild({ prebuild: "node gen.js", build: "npm run icons && rimraf dist && vite build -c vite.app.config.ts && zip -r out.zip dist", icons: "node icons.js" }))
    .toEqual({ pre: ["node gen.js", "node icons.js"], config: "vite.app.config.ts" });
  expect(inferStaticBuild({ build: "tsc -b && vite build --config=vite.web.config.mjs" })).toEqual({ pre: ["tsc -b"], config: "vite.web.config.mjs" });
  expect(inferStaticBuild({ build: "webpack" })).toEqual({ pre: [], config: null });
  // create-vue's stock scripts: run-p is followed into build-only, type-check is left out
  expect(inferStaticBuild({ build: 'run-p type-check "build-only {@}" --', "build-only": "node scripts/gen.mjs && vite build", "type-check": "vue-tsc --build" }))
    .toEqual({ pre: ["node scripts/gen.mjs"], config: null });
  expect(inferStaticBuild({ build: "npm-run-all -s lint build:web", lint: "eslint .", "prebuild:web": "node icons.js", "build:web": "vite build -c vite.web.config.ts" }))
    .toEqual({ pre: ["node icons.js"], config: "vite.web.config.ts" });

  const p = project({
    "package.json": JSON.stringify({ name: "yacht", scripts: { prebuild: "node gen-config.js", build: "vite build --config vite.app.config.ts", test: "vitest" }, dependencies: { vite: "^5", vue: "^3" } }),
    "bun.lock": "",
    "vite.config.ts": "export default { root: 'wrong' };\n",
    "vite.app.config.ts": 'import { fileURLToPath, URL } from "node:url";\nexport default { root: "web", resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } } };\n',
  });
  expect(p.run("init").code).toBe(0);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"build": "node gen-config.js && bunx vite build --config vite.app.config.ts --outDir ../dist/web --emptyOutDir"');
  expect(c).toContain('"clientBuild": "node gen-config.js && bunx vite build --config vite.app.config.ts --outDir ../dist/ui --emptyOutDir"');
  expect(c).toContain('"@": "src"');
});

test("init: React Router on @cloudflare/vite-plugin runs its Worker build, on the desktop too; on Node it's refused", () => {
  const rr = (vite: string, extra: Record<string, string> = {}) => project({
    "package.json": JSON.stringify({ name: "rr", scripts: { build: "react-router build", deploy: "wrangler deploy" }, dependencies: { react: "^19", "react-router": "^7" }, devDependencies: { vite: "^7", "@react-router/dev": "^7", "@cloudflare/vite-plugin": "^1" } }),
    "vite.config.ts": vite,
    "wrangler.json": JSON.stringify({ name: "rr", main: "./workers/app.ts", compatibility_date: "2025-10-08", vars: { GREETING: "hi" } }),
    "workers/app.ts": "export default {};\n", "bun.lock": "", ...extra,
  });
  const CF = 'import { reactRouter } from "@react-router/dev/vite";\nimport { cloudflare } from "@cloudflare/vite-plugin";\nexport default { plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter()] };\n';
  const p = rr(CF);
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: react-router/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": "build/server/index.js"');
  expect(c).toContain('"assets": "build/client"');
  expect(c).toContain('"build": "react-router build"');
  expect(c).toContain('"mode": "worker"');
  expect(c).not.toContain("clientBuild");

  const moved = rr(CF, { "react-router.config.ts": 'export default { ssr: true, buildDirectory: "out" };\n' });
  expect(moved.run("init").code).toBe(0);
  expect(moved.read("rustybuns.config.ts")).toContain('"builtMain": "out/server/index.js"');

  const node = rr('import { reactRouter } from "@react-router/dev/vite";\nexport default { plugins: [reactRouter()] };\n');
  const n = node.run("init");
  expect(n.code).not.toBe(0);
  expect(n.out).toMatch(/@cloudflare\/vite-plugin.*issues\/318/);
  expect(existsSync(join(node.dir, "rustybuns.config.ts"))).toBe(false);
});

const CRA = {
  "package.json": JSON.stringify({ name: "cra", dependencies: { react: "^18", "react-scripts": "5", "@types/node": "^16.11.6" },
    scripts: { start: "react-scripts start", build: "react-scripts build", test: "react-scripts test" } }, null, 2),
  "bun.lock": "",
  "public/index.html": `<html>\n  <head><link rel="icon" href="%PUBLIC_URL%/favicon.ico" /></head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n`,
  "src/index.js": `import App from "./App";\nconst Icon = require("./icon");\nrender(<App version={process.env.REACT_APP_VERSION} />);\n`,
  "src/setupProxy.js": `module.exports = require("http-proxy-middleware");\n`,
};

test("init: a webpack app (CRA) is refused, pointing at --port-vite", () => {
  const p = project(CRA);
  const r = p.run("init");
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/Create React App builds with webpack\. `rustybuns init --port-vite`.*issues\/404/);
  expect(existsSync(join(p.dir, "vite.config.ts"))).toBe(false);
});

test("init --port-vite: CRA becomes a Vite app, then init goes on", () => {
  const p = project(CRA);
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/ported to Vite/);
  expect(r.out).toMatch(/todo: src\/setupProxy\.js/);
  expect(r.out).toMatch(/detected: vite-react app "cra"/);
  expect(existsSync(join(p.dir, "public/index.html"))).toBe(false);
  const html = p.read("index.html");
  expect(html).toContain('href="/favicon.ico"');
  expect(html).toContain('    <script type="module" src="/src/index.js"></script>\n  </body>');
  const cfg = p.read("vite.config.ts");
  expect(cfg).toContain('loadEnv(mode, process.cwd(), "REACT_APP_")');
  expect(cfg).toContain('loader: "jsx"');              // JSX in src/index.js
  expect(cfg).toContain("transformMixedEsModules");   // require() in src/index.js
  const pkg = JSON.parse(p.read("package.json"));
  expect(pkg.scripts).toMatchObject({ start: "vite", build: "vite build", test: "react-scripts test", preview: "vite preview" });
  expect(pkg.devDependencies).toMatchObject({ vite: expect.any(String), "@vitejs/plugin-react": expect.any(String) });
  expect(pkg.dependencies["@types/node"]).toBe("^20.19.0");
  expect(p.read("rustybuns.config.ts")).toContain("vite build --outDir dist/ui");
});

test("init --port-vite: Vue CLI 2 gets plugin-vue2, Vue 2.7, the @ alias and BASE_URL", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "yacht", dependencies: { vue: "^2.6.12" }, devDependencies: { "@vue/cli-service": "~4.4.0" },
      scripts: { serve: "vue-cli-service serve", build: "vue-cli-service build", lint: "vue-cli-service lint" } }),
    "bun.lock": "",
    "public/index.html": `<html><head><title><%= htmlWebpackPlugin.options.title %></title><link rel="icon" href="<%= BASE_URL %>favicon.ico"></head>\n<body>\n  <div id="app"></div>\n  <!-- built files will be auto injected -->\n</body></html>\n`,
    "src/main.js": `import App from "@/App";\n`,
    "src/App.vue": `<template lang="html"><div /></template>\n`,
    "vue.config.js": `module.exports = {\n  publicPath: "./",\n  devServer: {\n    proxy: { "/api": {} },\n  },\n};\n`,
  });
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/vue\.config\.js isn't read: port publicPath, devServer by hand/);
  expect(r.out).toMatch(/source:\s+src\/ \(vite, aliases @->src\)/);
  const html = p.read("index.html");
  expect(html).toContain("<title>yacht</title>");
  expect(html).toContain('href="/favicon.ico"');
  expect(html).not.toContain("auto injected");
  expect(html).toContain('<script type="module" src="/src/main.js"></script>');
  const cfg = p.read("vite.config.ts");
  expect(cfg).toContain('from "@vitejs/plugin-vue2"');
  expect(cfg).toContain('"process.env.BASE_URL"');
  expect(cfg).toContain('".vue"]');
  expect(cfg).toContain("template-lang-html");
  const pkg = JSON.parse(p.read("package.json"));
  expect(pkg.dependencies.vue).toBe("^2.7.16");
  expect(pkg.scripts).toMatchObject({ serve: "vite", build: "vite build", lint: "vue-cli-service lint" });
});

test("port-vite: a Vue 3 app gets @vitejs/plugin-vue, and nothing it doesn't need", () => {
  const cfg = viteConfig({ stack: "vue-cli" });
  expect(cfg).toContain('import vue from "@vitejs/plugin-vue";');
  expect(cfg).not.toMatch(/commonjsOptions|esbuild|template-lang-html/);
});

test("init --port-vite: never overwrites vite.config.ts or index.html without --force", () => {
  const p = project({ ...CRA, "index.html": "mine" });
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/would overwrite index\.html/);
  expect(p.read("index.html")).toBe("mine");
  expect(existsSync(join(p.dir, "vite.config.ts"))).toBe(false);
  expect(existsSync(join(p.dir, "public/index.html"))).toBe(true);
  expect(p.run("init", "--port-vite", "--force").code).toBe(0);
  expect(p.read("index.html")).toContain("/src/index.js");
});

test("init --port-vite: a custom webpack build gets the list of what to port, and nothing written", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "w", devDependencies: { webpack: "5" } }), "bun.lock": "",
    "webpack.config.js": "new webpack.DefinePlugin({}); new HtmlWebpackPlugin(); new HtmlWebpackPlugin(); devServer: {}",
  });
  expect(p.run("init").out).toMatch(/--port-vite` lists what to port/);
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/DefinePlugin -> define/);
  expect(r.out).toMatch(/several HtmlWebpackPlugin pages/);
  expect(r.out).toMatch(/devServer\.proxy -> server\.proxy/);
  expect(r.out).not.toMatch(/ProvidePlugin/);
  expect(existsSync(join(p.dir, "vite.config.ts"))).toBe(false);
});

test("init: an rwsdk app's desktop build runs what its release build runs before vite (prisma generate)", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "todos", dependencies: { rwsdk: "1.7.0", react: "19" }, devDependencies: { vite: "7" },
      scripts: { build: "vite build", release: "rw-scripts ensure-deploy-env && prisma generate && RWSDK_DEPLOY=1 vite build && wrangler deploy" } }),
    "wrangler.jsonc": JSON.stringify({ name: "todos", main: "src/worker.tsx", compatibility_date: "2025-10-08" }),
    "src/worker.tsx": "export default {}", "bun.lock": "",
  });
  expect(p.run("init").code).toBe(0);
  expect(p.read("rustybuns.config.ts")).toContain('"clientBuild": "prisma generate && bunx vite build --config vite.desktop.config.ts"');
});

test("init: a workspace member that gets vite from the root package.json is a vite app", () => {
  const w = project({
    "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["app", "packages/*"], devDependencies: { vite: "^5" } }),
    "app/package.json": JSON.stringify({ name: "app", dependencies: { react: "^19" } }),
    "app/src/index.tsx": "", "bun.lock": "",
  });
  const p = Bun.spawnSync(["bun", CLI, "init"], { cwd: join(w.dir, "app"), env: { ...process.env, npm_config_user_agent: "" } });
  const out = p.stdout.toString() + p.stderr.toString();
  expect(p.exitCode).toBe(0);
  expect(out).toMatch(/detected: vite-react app "app"/);
  expect(w.read("app/rustybuns.config.ts")).toContain('"assets": "dist/web"');
});

test("init: a vite config's own outDir is kept, so plugins that write there still find it", () => {
  const p = project({ "package.json": VITE, "bun.lock": "", "vite.config.ts": 'export default { build: { outDir: "build" }, plugins: [] };\n' });
  expect(p.run("init").code).toBe(0);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"assets": "build"');
  expect(c).toContain('"build": "bunx vite build"');
});

test("init: an older Astro adapter's wrangler paths (dist/_worker.js, dist) are used as built", () => {
  const a = project({
    "package.json": JSON.stringify({ name: "blog", scripts: { build: "astro build" }, dependencies: { astro: "^5", "@astrojs/cloudflare": "12.6.12" } }),
    "astro.config.mjs": 'import cloudflare from "@astrojs/cloudflare";\nexport default { output: "server", adapter: cloudflare() };\n',
    "wrangler.json": JSON.stringify({ name: "blog", main: "./dist/_worker.js/index.js", compatibility_date: "2025-10-08", assets: { directory: "./dist", binding: "ASSETS" } }), "bun.lock": "",
  });
  const r = a.run("init");
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/does not exist/);
  const c = a.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": "dist/_worker.js/index.js"');
  expect(c).toContain('"assets": "dist"');
});

test("init: a plain HTML site with no package.json gets a static config, a package.json and a copy build", () => {
  const p = project({ "index.html": "<h1>hi</h1>", "about/index.html": "<p>about</p>", ".github/x.yml": "", "README.md": "# r" });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("detected: static HTML site in the project root");
  const cfg = p.read("rustybuns.config.ts");
  expect(cfg).toContain('copy-site . dist/ui"');
  expect(cfg).toContain('"notFoundHandling": "404-page"');
  expect(JSON.parse(p.read("package.json")).devDependencies["@rustybuns/cli"]).toMatch(/^\^/);
  // copy-site leaves out dotfiles and Rusty Buns' own files
  expect(p.run("copy-site", ".", "dist/ui").code).toBe(0);
  expect(existsSync(join(p.dir, "dist/ui/about/index.html"))).toBe(true);
  for (const f of [".github", "package.json", "rustybuns.config.ts", "desktop", "dist/ui/dist"]) expect(existsSync(join(p.dir, "dist/ui", f))).toBe(false);
});

test("init: a Jekyll site builds through a layered config that keeps Rusty Buns' files out", () => {
  const p = project({ "_config.yml": "title: Docs\nbaseurl: /docs\nexclude:\n  - notes.md\n", "_layouts/default.html": "{{ content }}", "index.md": "# hi" });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("detected: Jekyll site");
  expect(p.read("rustybuns.config.ts")).toContain("rustybuns jekyll build --config _config.yml,_config.rustybuns.yml --destination dist/ui");
  const layer = p.read("_config.rustybuns.yml");
  expect(layer).toContain('baseurl: ""');
  for (const f of ["notes.md", "dist", "desktop", "rustybuns.config.ts", "package.json"]) expect(layer).toContain(`"${f}"`);
  // No Gemfile means GitHub Pages, whose default-layout plugin gives a page with no layout one.
  expect((Bun as any).YAML.parse(layer).defaults).toEqual([
    { scope: { path: "", type: "pages" }, values: { layout: "default" } },
    { scope: { path: "", type: "posts" }, values: { layout: "default" } },
  ]);
});

test("init: a Jekyll site's own defaults stay, after GitHub Pages' layouts; a Gemfile site gets none of ours", () => {
  const pages = project({ "_config.yml": "defaults:\n  - scope: { path: blog }\n    values: { layout: post }\n", "_layouts/page.html": "{{ content }}", "_layouts/post.html": "{{ content }}", "index.md": "# hi" });
  expect(pages.run("init").code).toBe(0);
  expect((Bun as any).YAML.parse(pages.read("_config.rustybuns.yml")).defaults).toEqual([
    { scope: { path: "", type: "pages" }, values: { layout: "page" } },
    { scope: { path: "", type: "posts" }, values: { layout: "post" } },
    { scope: { path: "blog" }, values: { layout: "post" } },
  ]);
  const gem = project({ "_config.yml": "title: Docs\n", "Gemfile": "gem 'jekyll'\n", "_layouts/default.html": "{{ content }}", "index.md": "# hi" });
  expect(gem.run("init").code).toBe(0);
  expect(gem.read("_config.rustybuns.yml")).not.toContain("defaults");
});

test("init --force: a wrangler.jsonc Rusty Buns generated doesn't hide the static site (#1113)", () => {
  const p = project({ "_config.yml": "title: Docs\n", "_layouts/default.html": "{{ content }}", "index.md": "# hi" });
  expect(p.run("init").code).toBe(0);
  expect(p.run("generate").code).toBe(0);
  expect(p.read("wrangler.jsonc")).toStartWith("// GENERATED");
  const cfg = p.read("rustybuns.config.ts");
  const r = p.run("init", "--force");
  expect(r.code).toBe(0);
  expect(r.out).toContain("detected: Jekyll site");
  expect(p.read("rustybuns.config.ts")).toBe(cfg);
  // A hand-written one still means a Worker app.
  writeFileSync(join(p.dir, "wrangler.jsonc"), '{ "name": "docs", "main": "src/worker.ts" }');
  expect(p.run("init", "--force").out).not.toContain("detected: Jekyll site");
});
