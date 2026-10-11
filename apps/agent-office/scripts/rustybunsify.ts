#!/usr/bin/env bun
// 🥐 Rusty Buns-ify Agent Office (https://github.com/AgentSystemLabs/agent-office, MIT).
//
//   bun scripts/rustybunsify.ts                  fetch the pinned release into ./office, swap node-pty for the Bun shim
//   bun scripts/rustybunsify.ts compile          ...then build ./dist/agent-office-<os>-<arch>, one self-contained file
//   bun scripts/rustybunsify.ts compile --all    ...for darwin-arm64, darwin-x64, linux-x64 and linux-arm64
//   --check                                      type check our code (tsconfig.json) first; nothing is built on errors
//
// The release is pinned below, with its tarball's sha256, since it's compiled into the binary we hand out.
// AGENT_OFFICE_TAG=v0.1.212 AGENT_OFFICE_SHA256=<its agent-office.tgz digest> tries another; bump PINNED once it works.
// Nothing upstream is forked: every run starts from the release tarball and applies the same few patches,
// each of which fails loudly if its target moves.
//
// The office is retold as the Druids Curse forest (druids/), with models fetched from the live game
// (DRUIDS_CURSE_URL overrides it). AGENT_OFFICE_SKIN=office keeps Agent Office as it ships.
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checksBarClient, checkTallyServer, SERVER_IMPORT } from "../checks/patch.ts";
import { pullsFollowUpClient, pullsFollowUpServer } from "./briefs.ts";
import { PINNED, REPO, releaseTarball } from "./release.ts";
import { TRIAGE_READ_ONLY } from "../triage/tools.ts";

const root = path.dirname(import.meta.dir);
const office = path.join(root, "office");
const srv = path.join(office, "dist/server/server");

const tag = process.env.AGENT_OFFICE_TAG ?? PINNED.tag;
const sha256 = process.env.AGENT_OFFICE_SHA256 ?? (tag === PINNED.tag ? PINNED.sha256 : undefined);
if (!sha256) {
  throw new Error(`AGENT_OFFICE_TAG=${tag} needs AGENT_OFFICE_SHA256 too: ` +
    `gh release view ${tag} -R ${REPO} --json assets --jq '.assets[]|select(.name=="agent-office.tgz").digest'`);
}
if (process.argv.includes("--check")) {
  const r = await $`bun check -p ${path.join(root, "tsconfig.json")} --no-pretty`.nothrow();
  if (r.exitCode !== 0) throw new Error("type errors; nothing was built. Drop --check to build anyway.");
}
const skin = process.env.AGENT_OFFICE_SKIN ?? "druids";
const stamp = path.join(office, ".rustybuns");
if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === `${tag} ${skin} lucide live clock mem pulls checks triage` && !process.argv.includes("--fresh")) {
  console.log(`🥐 Agent Office ${tag} already Rusty Buns-ified in ./office`);
  // the skin is ours and changes far more often than the release, so it's rebuilt every start
  if (skin === "druids") await buildSkin(path.join(office, "dist/public/druids"));
  await buildPageScripts();
  await buildLive();
} else {
  await prepare(tag);
}
if (process.argv[2] === "compile") await compile(tag);

async function prepare(tag: string) {
  console.log(`🥐 Rusty Buns-ifying Agent Office ${tag}`);

  // 1. the release tarball, cached, and checked against its sha256 every time
  const cache = path.join(root, ".cache");
  const tgz = await releaseTarball(tag, sha256!, cache);
  rmSync(office, { recursive: true, force: true });
  const tmp = `${office}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await $`tar -xzf ${tgz} -C ${tmp}`.quiet();
  renameSync(path.join(tmp, "package"), office);
  rmSync(tmp, { recursive: true, force: true });

  // 2. its runtime dependencies, with Bun
  await $`bun install --production --ignore-scripts`.cwd(office).quiet();

  // 3. native node-pty out, the Bun PTY shim in
  const lydell = path.join(office, "node_modules/@lydell");
  for (const d of existsSync(lydell) ? readdirSync(lydell) : []) rmSync(path.join(lydell, d), { recursive: true, force: true });
  cpSync(path.join(root, "shim/node-pty"), path.join(lydell, "node-pty"), { recursive: true });

  // 4. Node loads xterm's CJS "main"; Bun's bundler would pick the ESM "module", which has no default export
  for (const p of ["@xterm/headless", "@xterm/addon-serialize"]) {
    const f = path.join(office, "node_modules", p, "package.json");
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    delete pkg.module;
    writeFileSync(f, JSON.stringify(pkg, null, 2));
  }

  // 5. small patches so it also runs from inside a compiled binary, where its code lives at /$bunfs
  patch("http/static.js", "const candidates = [",
    "const candidates = [...(process.env.AGENT_OFFICE_PUBLIC_DIR ? [process.env.AGENT_OFFICE_PUBLIC_DIR] : []), ");
  // /$bunfs "exists" to the binary's own fs calls, but the OS can't chdir there, so check the path itself
  patch("ptys.js", "cwd: path.dirname(here),",
    "cwd: path.dirname(here).includes('$bunfs') ? __rbHome() : path.dirname(here),");
  prepend("ptys.js", "import { homedir as __rbHome } from 'node:os';\n");
  patch("workers/process.js", "export function binScript(name) {",
    "export function binScript(name) {\n    if (process.env.AGENT_OFFICE_RUSTYBUNS_BIN)\n        return `/rustybuns/bin/${name}`;");

  // 6. the GitHub boards kept fresh (live/github.ts): a worker's own gh writes and git pushes look again at once,
  // and a busy floor asks GitHub every few seconds, with a free conditional request, whether anything changed
  await buildLive();
  prepend("floor.js", "import { liveGitHub as __rbLive } from './rb-live.js';\n");
  patch("floor.js", "        void this.github.refresh();\n        // A floor with people on it",
    "        void this.github.refresh();\n        this.__rbLive = __rbLive(this, def.dir);\n        // A floor with people on it");
  patch("floor.js", "this.github.stop();", "this.github.stop();\n        this.__rbLive?.stop();");
  patch("workers/manager.js", "notePr: (command, output) => this.prs.noteOwn(w, command, output),",
    "notePr: (command, output) => {\n                this.prs.noteOwn(w, command, output);\n                this.__rbOnGh?.(command);\n            },");

  // 7. the office and each floor's pty host watch their own memory (live/mem.ts), served at /__rb/mem with the
  // office's CPU profiles and heap snapshots (triage/server.ts): signed in, and to workers on the hook port
  prepend("http/router.js", "import { officeTriage as __rbTriage } from '../rb-triage.js';\n");
  patch("http/router.js", "const signedIn = routes.filter((r) => r.auth === 'session');",
    "const signedIn = routes.filter((r) => r.auth === 'session');\n    const __rbRoutes = __rbTriage(ctx.cfg.dataDir, () => ctx.floors.values());");
  patch("http/router.js", "            for (const route of signedIn)\n",
    "            const __rb = p.startsWith('/__rb/') && await __rbRoutes(req.method, url, req.headers['x-rb-triage'] === '1');\n" +
    "            if (__rb)\n                return send(res, __rb.status, __rb.body);\n            for (const route of signedIn)\n");
  prepend("hooks/server.js", "import { officeTriage as __rbTriage } from '../rb-triage.js';\n");
  patch("hooks/server.js", "        if (url.pathname === '/office/queue')\n",
    "        if (url.pathname.startsWith('/__rb/')) {\n" +
    "            const id = url.searchParams.get('worker') ?? '';\n" +
    "            if (!ctx.workerFloor(id)?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\\s+/i, '')))\n" +
    "                return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });\n" +
    "            const __rb = await (ctx.__rbTriage ??= __rbTriage(ctx.cfg.dataDir, () => ctx.floors.values()))(req.method, url, true);\n" +
    "            return __rb ? send(res, __rb.status, __rb.body) : send(res, 404, { error: 'No such route' });\n" +
    "        }\n        if (url.pathname === '/office/queue')\n");
  // the same as tools in the workers' MCP server (bin/office-workers.js), the looking ones without asking
  patch("../../../bin/office-workers.js", "import { fileURLToPath } from 'node:url';\n",
    "import { fileURLToPath } from 'node:url';\nimport { TRIAGE_NOTE as __rbTriageNote, TRIAGE_TOOLS as __rbTriageTools, runTriageMcp as __rbTriage } from './rb-triage.js';\n");
  patch("../../../bin/office-workers.js", "];\n\nconst INSTRUCTIONS =", "  ...__rbTriageTools,\n];\n\nconst INSTRUCTIONS =");
  patch("../../../bin/office-workers.js", "'The office-workers command on your PATH does the same from a shell.';",
    "'The office-workers command on your PATH does the same from a shell.' + __rbTriageNote;");
  patch("../../../bin/office-workers.js", "  throw new Error(`Unknown tool: ${name}`);\n}",
    "  if (__rbTriageTools.some((t) => t.name === name)) return __rbTriage(name, a, io);\n  throw new Error(`Unknown tool: ${name}`);\n}");
  patch("office-workers.js", "export const MCP_READ_ONLY = [`mcp__${MCP_NAME}__list_workers`];",
    `export const MCP_READ_ONLY = [\`mcp__\${MCP_NAME}__list_workers\`, ...${JSON.stringify(TRIAGE_READ_ONLY)}.map((t) => \`mcp__\${MCP_NAME}__\${t}\`)];`);
  prepend("ptyhost.js", "import { ptyHostMem as __rbMem } from './rb-mem.js';\n");
  patch("ptyhost.js", "const token = JSON.parse(readFileSync(infoPath, 'utf8')).token;",
    "const token = JSON.parse(readFileSync(infoPath, 'utf8')).token;\n__rbMem(infoPath);");

  // 8. Lucide icons for the emoji, on every page, and a search box for the queue
  await buildPageScripts();

  // 9. the time on the issues and PR boards, in front of "Updated …" (its setting is a page script, clock/)
  clockOnBoards();

  // 10. the PR agent's brief: follow up with workers once their pull requests merge (briefs.ts)
  pullsFollowUp();

  // 11. a health bar of each PR's checks on the PR board (checks/), its tally from the list the board already fetches
  writeFileSync(path.join(srv, "github.js"), checkTallyServer(readFileSync(path.join(srv, "github.js"), "utf8")));
  prepend("github.js", SERVER_IMPORT);
  patchAsk(checksBarClient);

  // 12. the Druids Curse skin
  if (skin === "druids") await druids(cache);

  writeFileSync(stamp, `${tag} ${skin} lucide live clock mem pulls checks triage\n`);
  console.log("   ✓ ./office  (bun run office starts it)");
}

async function druids(cache: string) {
  const pub = path.join(office, "dist/public");
  const dir = path.join(pub, "druids");

  // every race and the forest, from the live game, cached
  const { MODELS } = await import("../druids/assets.ts");
  const game = process.env.DRUIDS_CURSE_URL ?? "https://druids-curse-votv.notryanquinn.workers.dev";
  for (const name of MODELS) {
    const glb = path.join(cache, "druids", `${name}.glb`);
    if (!existsSync(glb)) {
      const res = await fetch(`${game}/non_repo/models/${name}.glb`);
      if (!res.ok) throw new Error(`Druids Curse model ${name} failed (${res.status}) from ${game}`);
      await Bun.write(glb, res);
    }
    mkdirSync(path.dirname(path.join(dir, "models", name)), { recursive: true });
    cpSync(glb, path.join(dir, "models", `${name}.glb`));
  }

  // the KTX2 transcoder the game's textures need, from the same three as the bundle
  const three = path.dirname(Bun.resolveSync("three/package.json", root));
  cpSync(path.join(three, "examples/jsm/libs/basis"), path.join(dir, "basis"), { recursive: true });
  await buildSkin(dir);

  const [main, ...more] = [...new Bun.Glob("assets/main-*.js").scanSync({ cwd: pub })];
  if (!main || more.length) throw new Error(`Agent Office changed: expected one assets/main-*.js, found ${more.length + (main ? 1 : 0)}`);
  const file = path.join(pub, main);
  // every worker hands itself to the skin as it's built
  patch(file, ",this.setName(e)}setPropSpot", ",this.setName(e),(globalThis.__rbWorkers??=[]).push(this)}setPropSpot");
  // and every person (you, your teammates, the bartender) to Qoa
  patch(file, "legR:this.legR},this.setLabel(e,!1)}setColor(e){", "legR:this.legR},this.setLabel(e,!1),(globalThis.__rbPeople??=[]).push(this)}setColor(e){");
  // and every frame, once the sky has set the lights, the forest gets a turn
  patch(file, "l.setWeather(s.rain,1-s.daylight)}function b(t)",
    "l.setWeather(s.rain,1-s.daylight),globalThis.__rbOfficeTick?.(e,n.stage,r,i)}function b(t)");
  // the bundle is served as immutable, so a patched one needs its own name or browsers keep the old one
  const renamed = main.replace(/\.js$/, `-rb${Bun.hash(readFileSync(file)).toString(36).slice(0, 6)}.js`);
  renameSync(file, path.join(pub, renamed));
  patch(path.join(pub, "index.html"), `<script type="module" crossorigin src="/${main}">`,
    `<script type="module" src="/druids/druids.js"></script>\n    <script type="module" crossorigin src="/${renamed}">`);
  console.log(`   ✓ Druids Curse office: ${MODELS.length} models`);
}

async function buildSkin(dir: string) {
  const built = await Bun.build({ entrypoints: [path.join(root, "druids/index.ts")], minify: true, target: "browser" });
  if (!built.success) throw new AggregateError(built.logs, "druids/index.ts failed to build");
  await Bun.write(path.join(dir, "druids.js"), built.outputs[0]);
}

// next to the server code they hook into, rebuilt every start like the skin
async function buildLive() {
  for (const [entry, out] of [["live/github.ts", "rb-live.js"], ["live/mem.ts", "rb-mem.js"], ["checks/tally.ts", "rb-checks.js"], ["triage/server.ts", "rb-triage.js"],
    // beside bin/office-workers.js, the workers' MCP server
    ["triage/mcp.ts", "../../../bin/rb-triage.js"]]) {
    const built = await Bun.build({ entrypoints: [path.join(root, entry!)], target: "bun" });
    if (!built.success) throw new AggregateError(built.logs, `${entry} failed to build`);
    await Bun.write(path.resolve(srv, out!), built.outputs[0]!);
  }
}

// into /assets/, the one place the sign-in pages can load from before you're in; it's served as immutable,
// so the name carries a hash, and every page's tag goes ahead of the page's own script
async function buildPageScripts() {
  await buildPageScript("icons/index.ts", "rb-icons", ["index", "lite", "login", "join", "claim"]);
  // the task queue's search box, on the two pages with the queue
  await buildPageScript("queue/index.ts", "rb-queue", ["index", "lite"]);
  // the boards' clock and its setting, where the boards are
  await buildPageScript("clock/index.ts", "rb-clock", ["index", "lite"]);
  // the PR board's checks health bar
  await buildPageScript("checks/index.ts", "rb-checks", ["index", "lite"]);
  // the triage tools, over WebMCP for an agent in the browser
  await buildPageScript("triage/index.ts", "rb-triage", ["index", "lite"]);
}

async function buildPageScript(entry: string, prefix: string, pages: string[]) {
  const built = await Bun.build({ entrypoints: [path.join(root, entry)], minify: true, target: "browser" });
  if (!built.success) throw new AggregateError(built.logs, `${entry} failed to build`);
  const js = await built.outputs[0]!.text();
  const pub = path.join(office, "dist/public");
  for (const old of new Bun.Glob(`assets/${prefix}-*.js`).scanSync({ cwd: pub })) rmSync(path.join(pub, old));
  const name = `assets/${prefix}-${Bun.hash(js).toString(36).slice(0, 8)}.js`;
  writeFileSync(path.join(pub, name), js);
  const tag = `<script type="module" src="/${name}"></script>`;
  for (const page of pages) {
    const file = path.join(pub, `${page}.html`);
    const html = readFileSync(file, "utf8");
    const old = new RegExp(`<script type="module" src="/assets/${prefix}-\\w+\\.js"></script>`);
    if (old.test(html)) writeFileSync(file, html.replace(old, tag));
    else patch(file, "<head>", `<head>\n    ${tag}`);
  }
}

// The boards' "Updated just now" gets the time in front: "3:42 PM PDT · Updated just now". The 3D office and
// /lite share the chunk the boards live in, and the hashed chunks are served as immutable, so the patched one
// gets a new name, and so does each file that imports it.
function clockOnBoards() {
  const pub = path.join(office, "dist/public");
  const [ask, ...more] = [...new Bun.Glob("assets/ask-*.js").scanSync({ cwd: pub })];
  if (!ask || more.length) throw new Error(`Agent Office changed: expected one assets/ask-*.js, found ${more.length + (ask ? 1 : 0)}`);
  // once when the board draws, and again every 15 seconds
  for (const v of ["l", "t"])
    patch(path.join(pub, ask), `${v}.fetchedAt?\`Updated \${c(${v}.fetchedAt)}\``,
      `${v}.fetchedAt?\`\${globalThis.__rbClock?.(${v}.fetchedAt)??\`\`}Updated \${c(${v}.fetchedAt)}\``);
  rehash(pub, ask);
}

// The PR agent's brief, in the server and in the client bundle the prompt settings show its default from.
function pullsFollowUp() {
  const shared = path.join(office, "dist/server/shared/prompts.js");
  writeFileSync(shared, pullsFollowUpServer(readFileSync(shared, "utf8")));
  patchAsk(pullsFollowUpClient);
}

/** Patch the client chunk the boards and the prompt settings live in, then give it a name of its own. */
function patchAsk(change: (js: string) => string) {
  const pub = path.join(office, "dist/public");
  const [ask, ...more] = [...new Bun.Glob("assets/ask-*.js").scanSync({ cwd: pub })];
  if (!ask || more.length) throw new Error(`Agent Office changed: expected one assets/ask-*.js, found ${more.length + (ask ? 1 : 0)}`);
  writeFileSync(path.join(pub, ask), change(readFileSync(path.join(pub, ask), "utf8")));
  rehash(pub, ask);
}

/** Give a patched asset a name of its own, then point everything that loads it there, renaming those in turn. */
function rehash(pub: string, rel: string) {
  const file = path.join(pub, rel);
  const renamed = rel.replace(/\.js$/, `-rb${Bun.hash(readFileSync(file)).toString(36).slice(0, 6)}.js`);
  renameSync(file, path.join(pub, renamed));
  const from = path.basename(rel), to = path.basename(renamed);
  for (const f of ["*.html", "assets/*.js"].flatMap(g => [...new Bun.Glob(g).scanSync({ cwd: pub })])) {
    const s = readFileSync(path.join(pub, f), "utf8");
    if (!s.includes(from)) continue;
    writeFileSync(path.join(pub, f), s.replaceAll(from, to));
    if (f.endsWith(".js")) rehash(pub, f);
  }
}

async function compile(tag: string) {
  const gen = path.join(root, ".gen");
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });

  // the 3D client, embedded file by file; the binary unpacks it once into the user's cache
  const pub = path.join(office, "dist/public");
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: pub, dot: true })].sort();
  // keyed by content too, so a re-patched client (the skin, say) never reuses an older unpack of the same tag
  const sum = new Bun.CryptoHasher("sha1");
  for (const f of files) sum.update(f).update(readFileSync(path.join(pub, f)));
  const unpack = `${tag}-${sum.digest("hex").slice(0, 8)}`;
  writeFileSync(path.join(gen, "assets.js"),
    files.map((f, i) => `import a${i} from ${JSON.stringify(path.join(pub, f))} with { type: "file" };`).join("\n") +
    `\nexport default [${files.map((f, i) => `[${JSON.stringify(f)}, a${i}]`).join(",")}];\n`);

  // one entry for every job the binary has: the office, its pty host, and the office-workers / office-queue commands
  const bin = (name: string) => JSON.stringify(path.join(office, "bin", name));
  writeFileSync(path.join(gen, "entry.js"), `
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const arg = process.argv[2] ?? "";
const helper = { "/rustybuns/bin/office-workers.js": "workers", "/rustybuns/bin/office-queue.js": "queue" }[arg];
if (helper === "workers") {
  process.exitCode = await (await import(${bin("office-workers.js")})).main(process.argv.slice(3));
} else if (helper === "queue") {
  process.exitCode = await (await import(${bin("office-queue.js")})).main(process.argv.slice(3));
} else if (path.basename(arg).startsWith("ptyhost")) {
  // the office re-runs itself as its pty host: <bin> <code dir>/ptyhost.js <socket> <info>
  process.argv.splice(2, 1);
  await import(${JSON.stringify(path.join(srv, "ptyhost.js"))});
} else {
  const { default: assets } = await import("./assets.js");
  const cache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  const dir = path.join(cache, "agent-office-rustybuns", ${JSON.stringify(unpack)}, "public");
  if (!existsSync(path.join(dir, ".ok"))) {
    const tmp = dir + ".tmp-" + process.pid;
    for (const [rel, src] of assets) {
      mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      writeFileSync(path.join(tmp, rel), new Uint8Array(await Bun.file(src).arrayBuffer()));
    }
    writeFileSync(path.join(tmp, ".ok"), "");
    mkdirSync(path.dirname(dir), { recursive: true });
    try { renameSync(tmp, dir); } catch {}
  }
  process.env.AGENT_OFFICE_PUBLIC_DIR ??= dir;
  process.env.AGENT_OFFICE_RUSTYBUNS_BIN = "1";
  await import(${JSON.stringify(path.join(srv, "cli.js"))});
}
`);

  const host = `${process.platform}-${process.arch}`;
  const targets = process.argv.includes("--all") ? ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] : [host];
  mkdirSync(path.join(root, "dist"), { recursive: true });
  for (const t of targets) {
    const out = path.join(root, "dist", `agent-office-${t}`);
    // macOS kills a signed binary rewritten in place, so never overwrite one
    rmSync(out, { force: true });
    const t0 = performance.now();
    await $`bun build --compile --minify-syntax --target=bun-${t} ${path.join(gen, "entry.js")} --outfile ${out}`.cwd(office).quiet();
    const mb = (Bun.file(out).size / 1e6).toFixed(0);
    console.log(`   ✓ dist/agent-office-${t}  ${mb} MB  ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
}

function patch(rel: string, from: string, to: string) {
  const file = path.resolve(srv, rel);
  const s = readFileSync(file, "utf8");
  if (!s.includes(from)) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  writeFileSync(file, s.replace(from, to));
}

function prepend(rel: string, text: string) {
  const file = path.join(srv, rel);
  writeFileSync(file, text + readFileSync(file, "utf8"));
}
