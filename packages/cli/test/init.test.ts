import { test, expect, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferTsconfigAliases, detectPm, inferPostgres, viteProxyPaths, viteProxyTargets, proxyServers, type SiblingServer } from "../src/glue/infer.ts";
import { parseWranglerToml, droppedWranglerKeys } from "../src/wrangler.ts";
import { workspaceRoot } from "../src/glue/deploy-deps.ts";
import { craProxy, viteConfig, vueCliProxy } from "../src/glue/port-vite.ts";

// These tests spawn the CLI, which takes seconds under --parallel load; bun ignores bunfig's timeout.
setDefaultTimeout(30_000);
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
      "triggers": { "crons": ["* * * * *"] }, "services": [{ "binding": "API", "service": "api" }], "env": { "staging": { "define": { "X": "1" } } },
      "d1_databases": [{ "binding": "DB", "database_name": "d" }] }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/not carried over: services, env\.staging\.define/);
  expect(r.out).toMatch(/adopt will refuse/);
  expect(p.read("wrangler.jsonc")).toContain('"services"');
  const adopt = p.run("adopt");
  expect(adopt.code).toBe(1);
  expect(adopt.out).toMatch(/adopt would delete from wrangler\.jsonc: services, env\.staging\.define/);
  expect(p.read("wrangler.jsonc")).toContain('"services"');
  expect(p.run("adopt", "--force").code).toBe(0);
  expect(p.read("rustybuns.config.ts")).toMatch(/"crons": \[\s*"\* \* \* \* \*"\s*\]/);   // Cron Triggers carry over
});

test("init: env blocks become stages, with account_id, workers_dev and preview_urls; adopt goes ahead (#1211)", () => {
  const acct = "0123456789abcdef0123456789abcdef", other = "fedcba9876543210fedcba9876543210";
  const p = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts", "account_id": "${acct}", "preview_urls": false,
      "routes": [{ "pattern": "app.example.com", "custom_domain": true }],
      "vars": { "API_URL": "https://example.com", "MODE": "prod" },
      "d1_databases": [{ "binding": "DB", "database_name": "r-db", "migrations_dir": "db" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "r-files" }],
      "env": {
        "staging": { "account_id": "${other}", "workers_dev": true,
          "routes": [{ "pattern": "staging.example.com", "custom_domain": true }],
          "vars": { "API_URL": "https://staging.example.com", "MODE": "prod", "DEBUG": "1" },
          "d1_databases": [{ "binding": "DB", "database_name": "r-db-staging", "migrations_dir": "db" }],
          "r2_buckets": [{ "binding": "FILES", "bucket_name": "r-files-staging" }] },
        "dev": { "name": "r-dev-worker", "vars": { "API_URL": "http://localhost" } } } }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/not carried over/);
  expect(r.out).toMatch(/stages: +staging dev/);
  // Wrangler doesn't inherit bindings into an env; the dev block left these out.
  expect(r.out).toMatch(/env\.dev: DB, env\.dev: FILES, env\.dev: MODE/);
  const cfg = p.read("rustybuns.config.ts");
  const json = JSON.parse(cfg.slice(cfg.indexOf("defineConfig(") + 13, cfg.lastIndexOf(")")));
  expect(json.targets.edge).toEqual({ provider: "cloudflare", domain: "app.example.com", accountId: acct, previewUrls: false });
  expect(json.stages).toEqual({
    staging: { workerName: "r-staging", accountId: other, workersDev: true, domain: "staging.example.com", routes: [],
      bindings: { DB: { databaseName: "r-db-staging" }, FILES: { bucketName: "r-files-staging" },
        API_URL: { value: "https://staging.example.com" }, DEBUG: { type: "var", value: "1" } } },
    dev: { workerName: "r-dev-worker", bindings: { API_URL: { value: "http://localhost" } } },
  });
  expect(p.run("adopt").code).toBe(0);
  // The stack follows the config as written; a stage's comes from `--stage` at plan time.
  expect(p.read(".rustybuns/alchemy.run.ts")).toContain(`workersDev: {"previewsEnabled":false}`);
});

test("init: workflows, analytics, loaders, containers, routes, observability and dead-letter queues carry over (#1195)", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts",
      "workflows": [{ "binding": "FLOW", "name": "r-flow", "class_name": "Flow" }],
      "analytics_engine_datasets": [{ "binding": "AE", "dataset": "events" }],
      "worker_loaders": [{ "binding": "LOADER" }],
      "durable_objects": { "bindings": [{ "name": "BOX", "class_name": "Box" }, { "name": "REMOTE", "class_name": "Remote" }] },
      "containers": [{ "class_name": "Box", "image": "./Dockerfile", "max_instances": 3, "instance_type": "basic" },
        { "class_name": "Remote", "image": "docker.io/org/remote:1" }],
      "routes": [{ "pattern": "app.example.com", "custom_domain": true }, "example.com/api/*"],
      "observability": { "enabled": true, "head_sampling_rate": 0.5 },
      "queues": { "producers": [{ "binding": "JOBS", "queue": "jobs" }],
        "consumers": [{ "queue": "jobs", "max_retries": 2, "dead_letter_queue": "jobs-dlq" }, { "queue": "jobs-dlq" }] } }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  // A registry image can't be built here, so that container stays a plain Durable Object.
  expect(r.out).toMatch(/not carried over: containers\n/);
  const cfg = p.read("rustybuns.config.ts");
  const json = JSON.parse(cfg.slice(cfg.indexOf("defineConfig(") + 13, cfg.lastIndexOf(")")));
  expect(json.bindings.FLOW).toEqual({ type: "workflow", className: "Flow" });
  expect(json.bindings.AE).toEqual({ type: "analytics_engine", dataset: "events" });
  expect(json.bindings.LOADER).toEqual({ type: "worker_loader" });
  expect(json.bindings.BOX).toEqual({ type: "container", className: "Box", dockerfile: "Dockerfile", maxInstances: 3, instanceType: "basic" });
  expect(json.bindings.REMOTE).toEqual({ type: "durable_object", className: "Remote" });
  expect(json.bindings.JOBS).toEqual({ type: "queue", queueName: "jobs", consumer: { maxRetries: 2, deadLetterQueue: "JOBS_DLQ" } });
  expect(json.bindings.JOBS_DLQ).toEqual({ type: "queue", queueName: "jobs-dlq", consumer: {}, producer: false });
  expect(json.targets.edge).toEqual({ provider: "cloudflare", domain: "app.example.com", routes: [{ pattern: "example.com/api/*" }] });
  expect(json.worker.observability).toEqual({ enabled: true, headSamplingRate: 0.5 });
  // The config it wrote loads, and generates the stack.
  expect(existsSync(join(p.dir, ".rustybuns/alchemy.run.ts"))).toBe(true);
});

test("init: a Vectorize index carries over, and init asks for the dimensions wrangler doesn't record", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts", "vectorize": [{ "binding": "V", "index_name": "docs" }] }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/not carried over/);
  expect(r.out).toMatch(/todo: +bindings\.V\.dimensions: docs's vector length/);
  expect(p.read("rustybuns.config.ts")).toContain('"indexName": "docs"');
  // Until they're set, the config refuses to load rather than guess (a wrong guess replaces the index).
  expect(p.run("adopt").out).toMatch(/bindings\.V\.dimensions: missing/);

  // Code that names its embedding model settles them: bge-base is 768.
  const named = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts", "vectorize": [{ "binding": "V", "index_name": "docs" }] }`,
    "src/worker.ts": `export const MODEL = "@cf/baai/bge-base-en-v1.5"; export default {}`,
  });
  const n = named.run("init");
  expect(n.out).toMatch(/V: 768 dimensions, from @cf\/baai\/bge-base-en-v1\.5/);
  expect(n.out).not.toMatch(/todo: +bindings\.V/);
  expect(named.read("rustybuns.config.ts")).toContain('"dimensions": 768');
});

test("init: a Pages project's functions/ runs as a Worker, ahead of its static files, with Pages' context", async () => {
  const p = project({
    "package.json": JSON.stringify({ name: "pg", scripts: { build: "vite build" }, dependencies: { vite: "5" } }),
    "wrangler.toml": `name = "pg"\npages_build_output_dir = "dist"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "pg"\ndatabase_id = "x"\n`,
    ".dev.vars": "API_TOKEN=x\nVITE_API_ORIGIN=http://localhost\n",
    "public/_routes.json": JSON.stringify({ version: 1, include: ["/*"], exclude: ["/assets/*"] }),
    "src/main.ts": "",
    "functions/_middleware.ts": `export const onRequest = async (c) => { c.data.seen = ["root"]; const r = await c.next(); r.headers.set("x-mw", "root"); return r; };`,
    "functions/api/_middleware.ts": `export const onRequest = [async (c) => { c.data.seen.push("api"); return c.next(); }];`,
    "functions/api/items/index.ts": `export const onRequestGet = (c) => Response.json({ list: true, seen: c.data.seen });`,
    "functions/api/items/[id].ts": `export async function onRequestGet(c) { return Response.json({ id: c.params.id, db: typeof c.env.DB }); }\nexport const onRequestDelete = () => new Response(null, { status: 204 });`,
    "functions/api/items/new.ts": `export const onRequest = () => Response.json({ new: true });`,
    "functions/api/tile/[[path]].ts": `export const onRequestGet = (c) => Response.json({ path: c.params.path });`,
    "functions/api/_lib/util.ts": `export const onRequest = () => new Response("helper, not a route");`,
    "functions/api/items.test.ts": `export const onRequest = () => new Response("a test, not a route");`,
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/pages: +functions\/ -> \.rustybuns\/pages\/index\.ts \(4 routes, 2 middleware\)/);
  const cfg = p.read("rustybuns.config.ts");
  expect(cfg).toContain('"main": ".rustybuns/pages/index.ts"');
  expect(cfg).toContain('"assets": "dist"');
  expect(cfg).toMatch(/"build": "[^"]*rustybuns pages-functions && vite build"/);
  expect(cfg).toContain('"mode": "worker"');
  expect(cfg).toContain('"API_TOKEN"');
  expect(cfg).not.toContain("VITE_API_ORIGIN");   // Vite's, not the Worker's

  const worker = (await import(join(p.dir, ".rustybuns/pages/index.ts"))).default;
  const env = { DB: {}, ASSETS: { fetch: (req: Request) => new Response(`asset ${new URL(req.url).pathname}`) } };
  const ctx = { waitUntil() {} };
  const go = (path: string, method = "GET") => worker.fetch(new Request(`http://x${path}`, { method }), env, ctx) as Promise<Response>;
  let res = await go("/api/items");
  expect(await res.json()).toEqual({ list: true, seen: ["root", "api"] });   // outermost middleware first, data shared
  expect(res.headers.get("x-mw")).toBe("root");
  expect(await (await go("/api/items/42")).json()).toEqual({ id: "42", db: "object" });
  expect(await (await go("/api/items/new")).json()).toEqual({ new: true });   // a static name beats [id]
  expect((await go("/api/items/42", "DELETE")).status).toBe(204);
  expect(await (await go("/api/items/42", "POST")).text()).toBe("asset /api/items/42");   // no handler for the method
  expect(await (await go("/api/tile/a/b/c.jpg")).json()).toEqual({ path: ["a", "b", "c.jpg"] });
  expect(await (await go("/api/_lib/util")).text()).toBe("asset /api/_lib/util");
  expect(await (await go("/api/items.test")).text()).toBe("asset /api/items.test");
  res = await go("/assets/app.js");   // _routes.json: straight to the files, no middleware
  expect([await res.text(), res.headers.get("x-mw")]).toEqual(["asset /assets/app.js", null]);
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
  // Vectorize carries over (init asks for its dimensions), and so do env blocks and the account.
  const w = parseWranglerToml('name = "x"\naccount_id = "a"\n[ai]\nbinding = "AI"\n[[vectorize]]\nbinding = "V"\nindex_name = "v"\n[triggers]\ncrons = ["* * * * *"]\n[env.staging]\nname = "x-staging"\n');
  expect(droppedWranglerKeys(w)).toEqual([]);
  // An env key a stage can't say is reported only when it differs from the top level's.
  const e = parseWranglerToml('name = "x"\nmain = "a.ts"\n[env.staging]\nmain = "a.ts"\n[env.qa]\nmain = "b.ts"\n[env."bad name"]\nname = "y"\n');
  expect(droppedWranglerKeys(e)).toEqual(["env.qa.main", "env.bad name"]);
  // limits.cpu_ms is carried (worker.cpuMs); any other limit is not
  expect(droppedWranglerKeys({ limits: { cpu_ms: 30000 } } as any)).toEqual([]);
  expect(droppedWranglerKeys({ limits: { cpu_ms: 30000, subrequests: 100 } } as any)).toEqual(["limits"]);
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
  expect(r.out).toContain("bunx rustybuns add deploy then bunx rustybuns plan");
  expect(p.read(".gitignore")).toContain(".rustybuns/");
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

test("init: a repo whose app is a folder down names that folder instead of refusing blind", () => {
  // A self-hosted app: the Vite frontend and a plain Node API side by side, a root package.json for tooling.
  const p = project({ "package.json": JSON.stringify({ devDependencies: { "js-yaml": "^4" } }), "frontend/package.json": VITE, "frontend/src/main.tsx": "", "api/package.json": JSON.stringify({ scripts: { start: "node server.js" } }) });
  const r = p.run("init");
  expect(r.code).toBe(1);
  expect(r.out).toContain("Found an app in frontend/: `cd frontend && rustybuns init`");
  expect(r.out).not.toMatch(/--force/);
  const bare = project({ "README.md": "# hi", "web/package.json": VITE, "apps/site/package.json": VITE });
  expect(bare.run("init").out).toContain("Found apps in apps/site/, web/");
});

test("vite server.proxy: its top-level paths, not the option keys inside", () => {
  expect(viteProxyPaths(`export default defineConfig({ server: { fs: { allow: ['..'] }, proxy: {
    '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
    "/img": { target: media },
    '^/ws/.*': 'ws://localhost:3001',
  } }, build: { outDir: 'x' } })`)).toEqual(["/api", "/img", "^/ws/.*"]);
  expect(viteProxyPaths("export default { plugins: [] }")).toEqual([]);
});

test("init: a Vite app that proxies to its own server in dev stays desktop-only and names the server", () => {
  const p = project({
    "frontend/package.json": VITE, "frontend/src/main.tsx": "", "frontend/package-lock.json": "{}",
    "frontend/vite.config.js": "export default { server: { proxy: { '/api': { target: 'http://127.0.0.1:3000' }, '/img': 'http://127.0.0.1:8888' } } }\n",
    "api/package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
  });
  const run = (...args: string[]) => { const x = Bun.spawnSync(["bun", CLI, ...args], { cwd: join(p.dir, "frontend"), env: { ...process.env, npm_config_user_agent: "" } }); return { code: x.exitCode, out: x.stdout.toString() + x.stderr.toString() }; };
  const r = run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("desktop-only: vite.config.js proxies /api, /img to a separate server in dev");
  expect(r.out).toContain("backend:  ../api (node server.js) looks like the server for /api, /img");
  expect(p.read("frontend/rustybuns.config.ts")).not.toContain('"edge"');
  expect(p.read("frontend/.gitignore")).toContain(".alchemy/");
  expect(run("plan").out).toMatch(/desktop-only app/);
});

test("vite server.proxy targets: a string, an options target, or the URL in the variable named", () => {
  expect(viteProxyTargets(`const backend = process.env.API ?? "http://localhost:3001";
export default defineConfig({ server: { proxy: {
    '/api': { target: backend, changeOrigin: true, headers: { Origin: o } },
    "/img": { target: media },
    '/gif': 'http://127.0.0.1:8888',
    '^/ws/.*': { target: 'ws://localhost:3001', ws: true },
  } } })`)).toEqual({ "/api": "http://localhost:3001", "/img": null, "/gif": "http://127.0.0.1:8888", "^/ws/.*": "ws://localhost:3001" });
});

test("proxy paths grouped by target port, each group given the server listening there", () => {
  const srv = (dir: string, port: number | null, readsPort = true): SiblingServer => ({ dir, runs: "node index.js", entry: `${dir}/index.js`, port, readsPort });
  const api = srv("../api", 3001), media = srv("../media", 8888, false);
  const two = proxyServers({ "/api": "http://localhost:3001", "^/ws": "ws://localhost:3001", "/img": "http://127.0.0.1:8888", "/gif": "http://127.0.0.1:8888", "/x": "http://localhost:9999" }, [api, media]);
  expect(two.found).toEqual([{ server: api, paths: ["/api", "^/ws"] }, { server: media, paths: ["/img", "/gif"], port: 8888 }]);
  expect(two.left).toEqual(["/x"]);
  // One target and one server: that's it, whatever port it names.
  expect(proxyServers({ "/api": "http://localhost:3000" }, [srv("../api", null)]).found.map((f) => f.paths)).toEqual([["/api"]]);
  // Two targets, and no server says which port it's on: neither is guessed.
  expect(proxyServers({ "/api": "http://localhost:3000", "/img": "http://localhost:4000" }, [srv("../api", null), srv("../media", null)]).left).toEqual(["/api", "/img"]);
});

test("init: a proxy to two servers runs both, each with its own paths", () => {
  const p = project({
    "frontend/package.json": VITE, "frontend/src/main.tsx": "", "frontend/package-lock.json": "{}",
    "frontend/vite.config.js": "export default { server: { proxy: { '/api': 'http://localhost:3001', '/img': { target: 'http://localhost:8888' }, '/gif': 'http://localhost:8888' } } }\n",
    "api/package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
    "api/server.js": "require('http').createServer(() => {}).listen(process.env.PORT || 3001);\n",
    "media/package.json": JSON.stringify({ main: "index.js", dependencies: { express: "^4" } }),
    "media/index.js": "const app = require('express')();\napp.listen(8888);\n",
  });
  const x = Bun.spawnSync(["bun", CLI, "init"], { cwd: join(p.dir, "frontend"), env: { ...process.env, npm_config_user_agent: "" } });
  const out = x.stdout.toString() + x.stderr.toString();
  expect(x.exitCode).toBe(0);
  expect(out).toContain("backend:  ../api (node server.js) runs beside the desktop host: desktop.server proxies /api to it");
  expect(out).toContain("backend:  ../media (express) runs beside the desktop host: desktop.server proxies /img, /gif to it");
  const cfg = p.read("frontend/rustybuns.config.ts");
  const server = JSON.parse(cfg.slice(cfg.indexOf("defineConfig(") + 13, cfg.lastIndexOf(")"))).targets.desktop.server;
  // The media server ignores PORT, so the host proxies to the port it keeps.
  expect(server).toEqual([{ entry: "../api/server.js", paths: ["/api"] }, { entry: "../media/index.js", paths: ["/img", "/gif"], port: 8888 }]);
});

test("init: a proxied Vite app whose server file it can find runs that server beside the host", () => {
  const p = project({
    "frontend/package.json": VITE, "frontend/src/main.tsx": "", "frontend/package-lock.json": "{}",
    "frontend/vite.config.js": "export default { server: { proxy: { '/api': { target: 'http://127.0.0.1:3000' } } } }\n",
    "api/package.json": JSON.stringify({ type: "module", scripts: { start: "node --enable-source-maps server.js" } }),
    "api/server.js": "",
  });
  const run = (...args: string[]) => { const x = Bun.spawnSync(["bun", CLI, ...args], { cwd: join(p.dir, "frontend"), env: { ...process.env, npm_config_user_agent: "" } }); return { code: x.exitCode, out: x.stdout.toString() + x.stderr.toString() }; };
  const r = run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("backend:  ../api (node --enable-source-maps server.js) runs beside the desktop host: desktop.server proxies /api to it");
  const c = p.read("frontend/rustybuns.config.ts");
  expect(c).toContain('"server": {\n        "entry": "../api/server.js",\n        "paths": [\n          "/api"\n        ]');
  expect(c).not.toContain('"edge"');
  const plan = run("plan").out;
  expect(plan).toContain("desktop-only app");
  expect(plan).toContain("Add targets.box to host it on a server");
});

test("plan: Alchemy not installed yet says to run add deploy, not to fix the config", () => {
  const p = project({ "package.json": VITE, "bun.lock": "", "src/main.tsx": "" });
  expect(p.run("init").code).toBe(0);
  const r = p.run("plan");
  expect(r.code).toBe(1);
  expect(r.out).toContain("Alchemy and Effect aren't installed here. Run `bunx rustybuns add deploy`, then plan again.");
});

test("plan: a config that can't import @rustybuns/cli says how to install it", () => {
  // node_modules without Rusty Buns in it (the app's own install), so Bun won't auto-install it.
  const p = project({ "package.json": VITE, "package-lock.json": "{}", "src/main.tsx": "", "node_modules/.package-lock.json": "{}" });
  expect(p.run("init").code).toBe(0);
  const r = p.run("plan");
  expect(r.out).toContain("[ConfigLoadFailed]");
  expect(r.out).toContain("@rustybuns/cli isn't installed in this app: `npm i -D @rustybuns/cli @rustybuns/shell-bun`");
});

test("init --force after plan: the wrangler.jsonc plan wrote isn't the app's own", () => {
  const p = project({ "package.json": VITE, "bun.lock": "", "src/main.tsx": "" });
  expect(p.run("init").code).toBe(0);
  expect(p.run("generate").code).toBe(0);
  expect(p.read("wrangler.jsonc")).toMatch(/^\/\/ GENERATED by rustybuns/);
  const r = p.run("init", "--force");
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/from wrangler\.jsonc|worker entry/);
  expect(p.read("rustybuns.config.ts")).toContain('"mode": "spa"');
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
  // No client build to split off, so the desktop runs the Worker itself (a Hono app looks the same).
  expect(c).toContain('"mode": "worker"');
  expect(c).not.toContain("vite.desktop.config.ts");
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

test("init: TanStack Start on @cloudflare/vite-plugin runs its Worker build on the desktop, with its bindings", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "start", scripts: { build: "vite build" }, dependencies: { "@tanstack/react-start": "^1", react: "^19" }, devDependencies: { vite: "^8", "@cloudflare/vite-plugin": "^1" } }),
    "vite.config.ts": 'import { cloudflare } from "@cloudflare/vite-plugin";\nimport { tanstackStart } from "@tanstack/react-start/plugin/vite";\nexport default { plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tanstackStart()] };\n',
    "wrangler.jsonc": JSON.stringify({ name: "start", main: "@tanstack/react-start/server-entry", compatibility_date: "2026-09-01", kv_namespaces: [{ binding: "VISITS", id: "x" }] }),
    "src/router.tsx": "export {};\n", "bun.lock": "",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: tanstack-start/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": "dist/server/index.js"');
  expect(c).toContain('"assets": "dist/client"');
  expect(c).toContain('"mode": "worker"');
  expect(c).toContain('"VISITS"');
  expect(c).not.toContain("clientBuild");
});

test("init: Nuxt on Nitro's cloudflare-module preset runs its Worker build on the desktop, with its bindings", () => {
  const nuxt = (extra: Record<string, string> = {}) => project({
    "package.json": JSON.stringify({ name: "nx", scripts: { build: "nuxt build" }, dependencies: { nuxt: "^4", vue: "^3" } }),
    "nuxt.config.ts": 'export default defineNuxtConfig({ nitro: { preset: "cloudflare-module" } });\n',
    "app/app.vue": "<template><NuxtPage /></template>\n", "bun.lock": "", ...extra,
  });
  // As Nuxt's Cloudflare docs write it: a wrangler.jsonc naming the built Worker and its assets.
  const p = nuxt({ "wrangler.jsonc": JSON.stringify({ name: "nx", main: "./.output/server/index.mjs", compatibility_date: "2026-09-01", assets: { directory: "./.output/public", binding: "ASSETS" }, kv_namespaces: [{ binding: "COUNTER", id: "local" }] }) });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: nuxt/);
  expect(r.out).not.toMatch(/does not exist/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": ".output/server/index.mjs"');
  expect(c).toContain('"assets": ".output/public"');
  expect(c).toContain('"build": "nuxt build"');
  expect(c).toContain('"mode": "worker"');
  expect(c).toContain('"COUNTER"');
  expect(c).not.toContain("clientBuild");

  // No wrangler file yet: the same Worker, from what the preset builds.
  const bare = nuxt();
  expect(bare.run("init").code).toBe(0);
  const b = bare.read("rustybuns.config.ts");
  expect(b).toContain('"builtMain": ".output/server/index.mjs"');
  expect(b).toContain('"assets": ".output/public"');
  expect(b).toContain('"mode": "worker"');
});

test("init: SolidStart on Nitro's Cloudflare preset runs the built Worker on the desktop, with its bindings", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "solid", scripts: { build: "vite build", deploy: "vite build && wrangler deploy" }, dependencies: { "@solidjs/start": "^2", "solid-js": "^1", nitro: "^3", vite: "^8" } }),
    "vite.config.ts": 'import { solidStart } from "@solidjs/start/config";\nimport { nitro } from "nitro/vite";\nexport default { plugins: [solidStart(), nitro({ preset: "cloudflare_module" })] };\n',
    "wrangler.jsonc": JSON.stringify({ name: "solid", main: ".output/server/index.mjs", compatibility_date: "2026-09-01", assets: { directory: ".output/public", binding: "ASSETS" }, kv_namespaces: [{ binding: "COUNTER", id: "local" }] }),
    "src/app.tsx": "export {};\n", "bun.lock": "",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: solidstart/);
  expect(r.out).not.toContain("does not exist");
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": ".output/server/index.mjs"');
  expect(c).toContain('"assets": ".output/public"');
  expect(c).toContain('"build": "vite build"');
  expect(c).toContain('"mode": "worker"');
  expect(c).toContain('"COUNTER"');
  expect(c).not.toContain("clientBuild");
});

test("init: Next.js on @opennextjs/cloudflare runs the Worker OpenNext builds on the desktop, with its bindings", () => {
  const next = (deps: Record<string, string>, extra: Record<string, string> = {}) => project({
    "package.json": JSON.stringify({ name: "nx", scripts: { build: "next build" }, dependencies: { next: "^16", react: "^19", "react-dom": "^19", ...deps } }),
    "app/page.tsx": "export default function Page() { return <h1>hi</h1>; }\n", "bun.lock": "", ...extra,
  });
  const openNext = { "@opennextjs/cloudflare": "^1" };
  // As OpenNext's docs write it: a wrangler.jsonc naming the built Worker and its assets, and an open-next.config.ts.
  const p = next(openNext, {
    "open-next.config.ts": 'import { defineCloudflareConfig } from "@opennextjs/cloudflare";\nexport default defineCloudflareConfig();\n',
    "wrangler.jsonc": JSON.stringify({ name: "nx", main: ".open-next/worker.js", compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"], assets: { directory: ".open-next/assets", binding: "ASSETS" }, kv_namespaces: [{ binding: "COUNTER", id: "local" }] }),
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: next/);
  expect(r.out).not.toMatch(/does not exist/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": ".open-next/worker.js"');
  expect(c).toContain('"assets": ".open-next/assets"');
  // `next build` is not the Worker build: OpenNext's command runs it and then writes .open-next/.
  expect(c).toContain('"build": "bunx opennextjs-cloudflare build"');
  expect(c).toContain('"mode": "worker"');
  expect(c).toContain('"COUNTER"');
  expect(c).not.toContain("clientBuild");

  // No wrangler file yet: the same Worker, from what OpenNext builds.
  const bare = next(openNext);
  expect(bare.run("init").code).toBe(0);
  const b = bare.read("rustybuns.config.ts");
  expect(b).toContain('"builtMain": ".open-next/worker.js"');
  expect(b).toContain('"assets": ".open-next/assets"');
  expect(b).toContain('"mode": "worker"');

  // Plain Next.js with no OpenNext: refused, with the fix.
  const plain = next({}).run("init");
  expect(plain.code).not.toBe(0);
  expect(plain.out).toContain("@opennextjs/cloudflare");
  expect(plain.out).toMatch(/issues\/318/);
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
  expect(cfg).toContain('lang: "jsx"');               // JSX in src/index.js, through Oxc
  expect(cfg).not.toMatch(/esbuild|commonjsOptions/); // Vite 8: Rolldown bundles require() itself
  const pkg = JSON.parse(p.read("package.json"));
  expect(pkg.scripts).toMatchObject({ start: "vite", build: "vite build", test: "react-scripts test", preview: "vite preview" });
  expect(pkg.devDependencies).toMatchObject({ vite: "^8.0.0", "@vitejs/plugin-react": "^6.0.0" });
  expect(pkg.dependencies["@types/node"]).toBe("^20.19.0");
  expect(p.read("rustybuns.config.ts")).toContain("vite build --outDir dist/ui");
});

test("init --port-vite: Vue CLI 2 gets plugin-vue2, Vue 2.7, the @ alias and BASE_URL", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "yacht", dependencies: { vue: "^2.6.12" }, devDependencies: { "@vue/cli-service": "~4.4.0", "vuetify-loader": "^1.7.0" },
      scripts: { serve: "vue-cli-service serve", build: "vue-cli-service build", lint: "vue-cli-service lint" } }),
    "bun.lock": "",
    "public/index.html": `<html><head><title><%= htmlWebpackPlugin.options.title %></title><link rel="icon" href="<%= BASE_URL %>favicon.ico"></head>\n<body>\n  <div id="app"></div>\n  <!-- built files will be auto injected -->\n</body></html>\n`,
    "src/main.js": `import App from "@/App";\n`,
    "src/App.vue": `<template lang="html"><div /></template>\n`,
    "vue.config.js": `module.exports = {\n  publicPath: "./",\n  devServer: {\n    proxy: { "/api": { target: "http://localhost:3000", pathRewrite: { "^/api": "" } } },\n  },\n};\n`,
  });
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/vue\.config\.js isn't read after this: publicPath and devServer\.proxy are in vite\.config\.ts/);
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
  expect(cfg).toContain("Components({ resolvers: [VuetifyResolver()] })");   // vuetify-loader's job
  expect(cfg).toContain('base: "./"');
  expect(cfg).toContain('"/api": { target: "http://localhost:3000", rewrite:');
  const pkg = JSON.parse(p.read("package.json"));
  expect(pkg.devDependencies["unplugin-vue-components"]).toBeDefined();
  expect(pkg.dependencies.vue).toBe("^2.7.16");
  expect(pkg.devDependencies).toMatchObject({ vite: "^7.3.0", "@vitejs/plugin-vue2": "^2.3.0" });  // plugin-vue2 stops at Vite 7
  expect(pkg.scripts).toMatchObject({ serve: "vite", build: "vite build", lint: "vue-cli-service lint" });
});

test("port-vite: proxies come from setupProxy.js and devServer.proxy only when they are plain data", () => {
  expect(craProxy(`app.use("/api", createProxyMiddleware({ target: "http://localhost:5000", changeOrigin: true }));`))
    .toEqual({ "/api": { target: "http://localhost:5000", changeOrigin: true } });
  expect(craProxy(`app.use("/api", createProxyMiddleware({ target: process.env.API }));`)).toBeUndefined();
  expect(craProxy(`app.use(cors()); app.use("/a", proxy({ target: "http://x" }));`)).toBeUndefined();
  expect(vueCliProxy(`module.exports = { devServer: { proxy: { "/a": "http://x" } } };`)).toEqual({ "/a": "http://x" });
  expect(vueCliProxy(`module.exports = { devServer: { proxy: { "/a": { target: URL } } } };`)).toBeUndefined();
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

test("init --port-vite: a custom webpack build's printout names its aliases, defines and proxies and drafts a vite.config.ts", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "w", devDependencies: { webpack: "5" } }), "bun.lock": "",
    "webpack.config.js": `module.exports = { entry: { main: "./src/a.js", admin: "./src/b.js" }, output: { publicPath: "/app/" },
      resolve: { alias: { "@": path.resolve("src"), lib: path.resolve("lib") } },
      plugins: [new webpack.DefinePlugin({ VERSION: JSON.stringify("1"), "process.env.X": 1 })],
      devServer: { proxy: { "/api": { target: "http://localhost:1" } } } };`,
  });
  const r = p.run("init", "--port-vite");
  expect(r.code).toBe(1);
  expect(r.out).toContain("resolve.alias -> resolve.alias (@, lib)");
  expect(r.out).toContain("DefinePlugin -> define (VERSION, process.env.X)");
  expect(r.out).toContain("devServer.proxy -> server.proxy (/api)");
  expect(r.out).toContain('base: "/app/"');
  expect(r.out).toContain('input: { main: "main.html", admin: "admin.html" }');
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

test("init: turns on the GitHub Pages default plugins a Gemfile-less Jekyll site leans on (#1123)", () => {
  const files = { "_config.yml": "exclude: [drafts]\nplugins: [jekyll-feed]\n", "_layouts/default.html": "{{ content }}", "README.md": "# Docs\n\nRead [the guide](guide.md).\n", "guide.md": "# Guide\n", "drafts/wip.md": "# WIP\n", "_includes/x.md": "# x\n" };
  const pages = project(files);
  const out = pages.run("init").out;
  expect(out).toMatch(/jekyll-optional-front-matter, as on Pages: .*\(guide\.md\)/);
  expect(out).toMatch(/jekyll-relative-links, as on Pages: .*\(README\.md\)/);
  expect(out).toMatch(/jekyll-readme-index, as on Pages: .*\(README\.md\)/);
  expect(out).not.toContain("wip.md");
  const layer = (Bun as any).YAML.parse(pages.read("_config.rustybuns.yml"));
  expect(layer.plugins).toEqual(["jekyll-feed", "jekyll-optional-front-matter", "jekyll-relative-links", "jekyll-titles-from-headings", "jekyll-readme-index"]);
  expect(layer.gems).toBeUndefined();
  // A site on the old `gems` key gets it too, since Jekyll lets it replace `plugins`.
  const old = project({ ...files, "_config.yml": "gems: [jekyll-feed]\n" });
  old.run("init");
  expect((Bun as any).YAML.parse(old.read("_config.rustybuns.yml")).gems).toContain("jekyll-relative-links");
  const gem = project({ ...files, "Gemfile": "gem 'github-pages'\n" });
  expect(gem.run("init").out).not.toContain("jekyll-relative-links");
  expect(gem.read("_config.rustybuns.yml")).not.toContain("plugins");
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

test("init: a Postgres app gets a Hyperdrive binding in front of DATABASE_URL", () => {
  const p = project({
    "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5", pg: "^8" } }),
    "wrangler.jsonc": `{ "name": "r", "main": "src/worker.ts" }`,
    "src/worker.ts": "export default {}",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/postgres: HYPERDRIVE \(Hyperdrive, for pg\) in front of the DATABASE_URL secret/);
  const cfg = p.read("rustybuns.config.ts");
  expect(cfg).toMatch(/"DATABASE_URL": \{\s*"type": "secret"\s*\}/);
  expect(cfg).toMatch(/"HYPERDRIVE": \{\s*"type": "hyperdrive",\s*"urlSecret": "DATABASE_URL"\s*\}/);
  expect(p.read("wrangler.generated.jsonc")).toContain('"hyperdrive"');
});

test("postgres: drivers, and Drizzle or Prisma only when set to postgresql", () => {
  const pg = (files: Record<string, string>, deps: Record<string, string>) => inferPostgres(project(files).dir, deps);
  expect(pg({}, { postgres: "3" })).toBe("postgres");
  expect(pg({}, { "@neondatabase/serverless": "1" })).toBeNull();
  expect(pg({ "drizzle.config.ts": `export default defineConfig({ dialect: "postgresql" })` }, { "drizzle-orm": "1" })).toBe("drizzle (postgresql)");
  expect(pg({ "drizzle.config.ts": `export default defineConfig({ dialect: "sqlite" })` }, { "drizzle-orm": "1" })).toBeNull();
  expect(pg({ "prisma/schema.prisma": `datasource db {\n  provider = "postgresql"\n}` }, { prisma: "6" })).toBe("prisma (postgresql)");
  expect(pg({ "prisma/schema.prisma": `datasource db {\n  provider = "sqlite"\n}` }, { prisma: "6" })).toBeNull();
});

test("init: names source files that differ only by case (#1198)", () => {
  const p = project({ "package.json": VITE, "src/main.tsx": "", "src/app/cover/factBar.ts": "", "src/app/cover/FactBar.tsx": "", "src/app/cover/Fact.tsx": "", "src/app/cover/fact.css": "" });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("warning:  src/app/cover/FactBar.tsx and src/app/cover/factBar.ts differ only by case");
  expect(r.out).not.toMatch(/Fact\.tsx and/);
});

test("init: a proxied Vite app with its server in a folder of its own (./api) runs that server beside the host", () => {
  const p = project({
    "package.json": VITE, "src/main.tsx": "", "package-lock.json": "{}",
    "vite.config.js": "export default { server: { proxy: { '/api': 'http://localhost:3001' } } }\n",
    "api/package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
    "api/server.js": "require('http').createServer(() => {}).listen(process.env.PORT || 3001);\n",
    // Build output and assets with a package.json aren't servers.
    "dist/package.json": JSON.stringify({ main: "index.js", dependencies: { express: "^4" } }), "dist/index.js": "",
  });
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toContain("backend:  api (node server.js) runs beside the desktop host: desktop.server proxies /api to it");
  const cfg = p.read("rustybuns.config.ts");
  expect(JSON.parse(cfg.slice(cfg.indexOf("defineConfig(") + 13, cfg.lastIndexOf(")"))).targets.desktop.server).toEqual({ entry: "api/server.js", paths: ["/api"] });
});

test("init: a hand-written wrangler.json or wrangler.toml stays the app's config", () => {
  for (const f of ["wrangler.json", "wrangler.toml"]) {
    const p = project({
      "package.json": JSON.stringify({ name: "r", dependencies: { vite: "5" } }),
      [f]: f.endsWith("json") ? `{ "name": "r", "main": "src/worker.ts" }` : `name = "r"\nmain = "src/worker.ts"\n`,
      "src/worker.ts": "export default {}",
    });
    const r = p.run("init");
    expect(r.out).toContain("wrangler.generated.jsonc");
    expect(r.code).toBe(0);
    expect(existsSync(join(p.dir, "wrangler.jsonc"))).toBe(false);
    expect(p.read("wrangler.generated.jsonc")).toStartWith("// GENERATED");
  }
});

test("init: SvelteKit on adapter-cloudflare runs its Worker build on the desktop; without the adapter it's refused", () => {
  const sk = (devDeps: Record<string, string>, extra: Record<string, string> = {}) => project({
    "package.json": JSON.stringify({ name: "sk", scripts: { build: "vite build" }, devDependencies: { vite: "^7", "@sveltejs/kit": "^2", svelte: "^5", ...devDeps } }),
    "svelte.config.js": "export default {};\n", "bun.lock": "", ...extra,
  });
  const p = sk({ "@sveltejs/adapter-cloudflare": "^7" });   // no wrangler config: the adapter's defaults
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: sveltekit/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"builtMain": ".svelte-kit/cloudflare/_worker.js"');
  expect(c).toContain('"assets": ".svelte-kit/cloudflare"');
  expect(c).toContain('"mode": "worker"');
  expect(c).not.toContain("clientBuild");

  const auto = sk({ "@sveltejs/adapter-auto": "^6" });
  const n = auto.run("init");
  expect(n.code).not.toBe(0);
  expect(n.out).toMatch(/adapter-cloudflare.*issues\/318/);
  expect(existsSync(join(auto.dir, "rustybuns.config.ts"))).toBe(false);
});

test("init: Qwik City on the cloudflare-pages adapter runs dist/_worker.js on the desktop; without the adapter config it's refused", () => {
  const qwik = (extra: Record<string, string> = {}) => project({
    "package.json": JSON.stringify({ name: "qk", scripts: { build: "qwik build" }, dependencies: { "@builder.io/qwik": "^1", "@builder.io/qwik-city": "^1" }, devDependencies: { vite: "^7" } }),
    "vite.config.ts": 'import { qwikVite } from "@builder.io/qwik/optimizer";\nexport default {};\n', "src/routes/index.tsx": "", "bun.lock": "", ...extra,
  });
  const p = qwik({ "adapters/cloudflare-pages/vite.config.ts": "export default {};\n", "src/entry.cloudflare-pages.tsx": "" });   // no wrangler config: the adapter's defaults
  const r = p.run("init");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/detected: qwik/);
  const c = p.read("rustybuns.config.ts");
  expect(c).toContain('"main": "dist/_worker.js"');
  expect(c).toContain('"builtMain": "dist/_worker.js"');
  expect(c).toContain('"assets": "dist"');
  expect(c).toContain('"build": "bunx vite build && bunx vite build -c adapters/cloudflare-pages/vite.config.ts"');
  expect(c).toContain('"mode": "worker"');
  expect(c).not.toContain("clientBuild");

  const bare = qwik();
  const n = bare.run("init");
  expect(n.code).not.toBe(0);
  expect(n.out).toMatch(/qwik add cloudflare-pages/);
  expect(existsSync(join(bare.dir, "rustybuns.config.ts"))).toBe(false);
});

test("drift: --repair changes the live account, so without a terminal it is refused; --repair on any other command is a usage error", () => {
  const config = `export default { name: "shop", worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [] }, bindings: { KV: { type: "kv" } }, targets: { edge: { provider: "cloudflare" } } };\n`;
  const p = project({ "package.json": VITE, "rustybuns.config.ts": config, "src/worker.ts": "export default {};\n" });
  const repair = p.run("drift", "--repair", "--stage", "preview-1");
  expect(repair.code).toBe(2);
  expect(repair.out).toContain("needs a yes at the terminal");
  const plan = p.run("plan", "--repair", "--stage", "preview-1");
  expect(plan.code).toBe(2);
  expect(plan.out).toContain("--repair is for drift only");
});
