// Real self-hostable repos through rustybuns init -> plan -> deploy -> check -> destroy,
// with this checkout's CLI. Each repo is cloned once into $CORPUS_DIR (default: a
// rustybuns-corpus folder in the temp dir) and reset to its clean state before each run.
//
//   bun scripts/corpus.ts [filter]       init only: reads files, runs none of the repos' code
//   STOP_AT=build bun scripts/corpus.ts  + the build init wrote (the repo's code, no credentials)
//   STOP_AT= bun scripts/corpus.ts       + plan: runs each repo's build, needs a Cloudflare login
//   DEPLOY=1 STOP_AT= bun scripts/corpus.ts   + deploy to stage "corpus", fetch the URL, destroy
//
// One line per repo; the full output of each step is in $CORPUS_DIR/results/<repo>.json.
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..");
const HOME = process.env.CORPUS_DIR ?? join(tmpdir(), "rustybuns-corpus"), WORK = join(HOME, "work"), OUT = join(HOME, "results");
const STOP_AT = process.env.STOP_AT ?? "init";
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });

type Entry = { repo: string; dir?: string; note?: string };
const CORPUS: Entry[] = [
  { repo: "CorentinTh/it-tools", note: "vue + vite SPA" },
  { repo: "drawdb-io/drawdb", note: "vite + react SPA" },
  { repo: "shlinkio/shlink-web-client", note: "vite + react SPA" },
  { repo: "iib0011/omni-tools", note: "vite + react SPA" },
  { repo: "satnaing/astro-paper", note: "astro static blog" },
  { repo: "ccbikai/BroadcastChannel", note: "astro, cloudflare adapter" },
  { repo: "cloudflare/templates", dir: "vite-react-template", note: "vite react + worker" },
  { repo: "cloudflare/templates", dir: "d1-template", note: "worker + D1" },
  { repo: "cloudflare/templates", dir: "hello-world-do-template", note: "worker + DO" },
  { repo: "cloudflare/templates", dir: "to-do-list-kv-template", note: "worker + KV" },
  { repo: "cloudflare/templates", dir: "astro-blog-starter-template", note: "astro + cloudflare" },
  { repo: "cloudflare/templates", dir: "react-starter-template", note: "react + worker" },
  { repo: "cloudflare/templates", dir: "chanfana-openapi-template", note: "hono openapi worker" },
  { repo: "cloudflare/templates", dir: "react-router-starter-template", note: "react router (tracked #318)" },
  { repo: "louislam/uptime-kuma", note: "vite vue + node server" },
  { repo: "ccbikai/Sink", note: "nuxt on workers (tracked #318)" },
  { repo: "gchq/CyberChef", note: "webpack, no framework" },
  // Round 2: servers beside the SPA, monorepo folders, more Astro, more Cloudflare products.
  { repo: "bastienwirtz/homer", note: "vite vue dashboard" },
  { repo: "Lissy93/dashy", note: "vite vue + optional node server" },
  { repo: "thelounge/thelounge", note: "vite vue + node server" },
  { repo: "jesec/flood", note: "vite react + node server" },
  { repo: "go-vikunja/vikunja", dir: "frontend", note: "vite vue, Go backend" },
  { repo: "photoprism/photoprism", dir: "frontend", note: "vite vue, Go backend" },
  { repo: "Sonarr/Sonarr", note: "vite react, C# backend" },
  { repo: "excalidraw/excalidraw", dir: "excalidraw-app", note: "vite react, yarn workspace member" },
  { repo: "hoppscotch/hoppscotch", dir: "packages/hoppscotch-selfhost-web", note: "vite vue, pnpm workspace member" },
  { repo: "onwidget/astrowind", note: "astro static template" },
  { repo: "chrismwilliams/astro-theme-cactus", note: "astro static blog" },
  { repo: "mermaid-js/mermaid-live-editor", note: "sveltekit (tracked #318)" },
  { repo: "redwoodjs/sdk", dir: "starter", note: "rwsdk starter, pnpm workspace member" },
  { repo: "cloudflare/templates", dir: "openauth-template", note: "worker + openauth, D1/KV" },
  { repo: "cloudflare/templates", dir: "workflows-starter-template", note: "worker + Workflows" },
  { repo: "cloudflare/templates", dir: "r2-explorer-template", note: "worker + R2" },
  { repo: "cloudflare/templates", dir: "multiplayer-globe-template", note: "partykit DO" },
  { repo: "cloudflare/templates", dir: "durable-chat-template", note: "DO chat + react" },
  { repo: "cloudflare/templates", dir: "llm-chat-app-template", note: "worker + Workers AI" },
  { repo: "cloudflare/templates", dir: "saas-admin-template", note: "astro + D1 + workflows" },
  { repo: "cloudflare/templates", dir: "containers-template", note: "worker + Containers" },
];

const slug = (e: Entry) => (e.repo + (e.dir ? "-" + e.dir : "")).replace(/[^\w.-]+/g, "_");
const tail = (s: string, n = 2500) => s.length > n ? "…" + s.slice(-n) : s;

async function sh(cmd: string[], cwd: string, timeoutMs = 600_000, scrub = true) {
  const t = Date.now();
  // The repo's own code (install, build) never sees a token, key or login; only plan/deploy/destroy get them.
  const env = scrub ? Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|SECRET|KEY|PASSWORD|CLOUDFLARE|AWS_|GH_|GITHUB/i.test(k))) : process.env;
  // As bunx / bun run do: every node_modules/.bin from here up, so a script's bare `vite` or `astro` resolves.
  const bins: string[] = [];
  for (let d = cwd; ; d = dirname(d)) { bins.push(join(d, "node_modules/.bin")); if (dirname(d) === d) break; }
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...env, CI: "1", PATH: [...bins, env.PATH].join(":") } });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited; clearTimeout(timer);
  return { ok: code === 0, code, out: out + (err ? "\n[stderr]\n" + err : ""), ms: Date.now() - t };
}

async function one(e: Entry) {
  const s = slug(e), r: any = { ...e, steps: [] as any[] };
  const step = async (name: string, cmd: string[], cwd: string, ms?: number) => {
    const x = await sh(cmd, cwd, ms, !["plan", "deploy", "destroy"].includes(name)); r.steps.push({ name, ok: x.ok, code: x.code, ms: x.ms, out: tail(x.out) }); return x;
  };
  const root = join(WORK, e.repo.replace("/", "__"));
  if (!existsSync(root)) { const c = await step("clone", ["git", "clone", "-q", "--depth", "1", `https://github.com/${e.repo}.git`, root], WORK); if (!c.ok) return r; }
  const app = e.dir ? join(root, e.dir) : root;
  // Back to the repo as cloned: an earlier init's files (wrangler.jsonc, desktop/) would be read as the app's own.
  await sh(["git", "checkout", "--", "."], root); await sh(["git", "clean", "-fdq", "-e", "node_modules", "--", e.dir ?? "."], root);
  if (!(await step("install", ["bun", "install", "--ignore-scripts"], app, 900_000)).ok) return r;
  // The CLI from this checkout, as if `bun add -d @rustybuns/cli` had run.
  mkdirSync(join(app, "node_modules/@rustybuns"), { recursive: true });
  rmSync(join(app, "node_modules/@rustybuns/cli"), { recursive: true, force: true });
  symlinkSync(CLI, join(app, "node_modules/@rustybuns/cli"));
  const rb = (sub: string, ...a: string[]) => ["bun", join(CLI, "src/index.ts"), sub, ...a];
  if (!(await step("init", rb("init"), app)).ok) return r;
  if (STOP_AT === "init") return r;
  // The build init wrote, with no credentials: does the output land where the config says?
  const cfg = await sh(["bun", "-e", `const c = (await import(process.cwd() + "/rustybuns.config.ts")).default; console.log(JSON.stringify(c.worker ?? null))`], app);
  const w = cfg.ok ? JSON.parse(cfg.out.trim().split("\n").at(-1)!) as { build?: string; builtMain?: string; main?: string; assets?: string } | null : null;
  if (w?.build) {
    const b = await step("build", ["sh", "-c", w.build], app, 900_000);
    if (!b.ok) return r;
    const want = [w.builtMain, w.assets].filter((x): x is string => !!x);
    const missing = want.filter((f) => !existsSync(join(app, f)));
    r.steps.push({ name: "output", ok: missing.length === 0, out: missing.length ? `missing after build: ${missing.join(", ")}` : `found ${want.join(", ")}` });
    if (missing.length) return r;
  }
  if (STOP_AT === "build") return r;
  if (!(await step("plan", rb("plan", "--stage", "corpus"), app, 900_000)).ok) return r;
  if (process.env.DEPLOY !== "1") return r;
  const d = await step("deploy", rb("deploy", "--yes", "--stage", "corpus"), app, 900_000);
  const url = /https:\/\/[\w.-]+\.workers\.dev\S*/.exec(d.out)?.[0];
  if (url) { const res = await fetch(url).catch((x) => ({ status: String(x) } as any)); r.steps.push({ name: "check", ok: typeof res.status === "number" && res.status < 500, out: `${url} -> ${res.status}` }); }
  await step("destroy", rb("destroy", "--yes", "--stage", "corpus"), app, 900_000);
  return r;
}

const filter = process.argv[2];
for (const e of CORPUS.filter((e) => !filter || slug(e).includes(filter))) {
  const r = await one(e).catch((x) => ({ ...e, error: String(x) }));
  writeFileSync(join(OUT, slug(e) + ".json"), JSON.stringify(r, null, 2));
  console.log(`${slug(e).padEnd(56)} ${r.steps?.map((s: any) => (s.ok ? "✓" : "✗") + s.name).join(" ") ?? r.error}`);
}
