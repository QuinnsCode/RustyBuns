#!/usr/bin/env bun
// 🥐 Rusty Buns-ify Agent Office (https://github.com/AgentSystemLabs/agent-office, MIT).
//
//   bun scripts/rustybunsify.ts                  fetch the pinned release into ./office, swap node-pty for the Bun shim
//   bun scripts/rustybunsify.ts compile          ...then build ./dist/agent-office-<os>-<arch>, one self-contained file
//   bun scripts/rustybunsify.ts compile --all    ...for darwin-arm64, darwin-x64, linux-x64 and linux-arm64
//   --check                                      type check our code (tsconfig.json) first; nothing is built on errors
//   --only=skin,pages,live                       rebuild just those of ./office (office:dev); needs an up-to-date ./office
//   --timings                                    print how long each stage took
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
import { EXTERNAL_IMPORT, externalServer } from "../external/patch.ts";
import { openNewFirstClient } from "./board.ts";
import { pullsFollowUpClient, pullsFollowUpServer } from "./briefs.ts";
import { floorGuardBin, floorGuardHooks, floorGuardQueue } from "./floorguard.ts";
import { hookTokensManager, hookTokensPersist, hookTokensUtil } from "./hooktokens.ts";
import { PINNED, REPO, releaseTarball } from "./release.ts";
import { POWER_PATCHES } from "../power/patch.ts";
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
const timings = process.argv.includes("--timings");
let lapped = performance.now();
/** With --timings, print the time since the last lap, under `name`. */
function lap(name: string) {
  const now = performance.now();
  if (timings) console.log(`   ⏱ ${name.padEnd(32)}${((now - lapped) / 1000).toFixed(2)}s`);
  lapped = now;
}
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
// The skin and the codeSplitter tiles both use three, so they're built together and share one copy of it, in
// /assets/rb-chunk-<hash>.js, instead of each bundling their own. Agent Office's bundle keeps its own, so the
// console still says "Multiple instances of Three.js" once, but not twice. That one stays (#839): the office's three
// is tree-shaken and minified into main-*.js, never exported or put on window (window.__THREE__ is just "186"), and
// our scripts run first anyway. Using it would mean matching ~110 minified names per release for ~92 KB gzipped.
// Should a release ever expose it (window.THREE, or a chunk of its own), use that when it's there.
const SHARED = ["codesplitter/index.ts", "screens/index.ts", ...(skin === "druids" ? ["druids/index.ts"] : [])];
let shared: Promise<Map<string, string>> | undefined;
// (sharedBuild() below; up here because the top-level build runs before the rest of the file is reached)
const stamp = path.join(office, ".rustybuns");
if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === `${tag} ${skin} lucide live clock mem pulls checks triage vale podcast codesplitter hosts hooktokens env ticks power board guard asks brawl ester dexter reload external box` && !process.argv.includes("--fresh")) {
  console.log(`🥐 Agent Office ${tag} already Rusty Buns-ified in ./office`);
  // the skin is ours and changes far more often than the release, so it's rebuilt every start
  if (skin === "druids" && (!only || only.includes("skin"))) { await buildSkin(path.join(office, "dist/public/druids")); lap("skin (druids + shared chunk)"); }
  if (!only || only.includes("pages")) { await buildPageScripts(); lap("page scripts"); }
  if (!only || only.includes("live")) { await buildLive(); lap("server bundles (live)"); }
} else if (only) {
  throw new Error("--only needs ./office built from this release and skin: run without it first");
} else {
  await prepare(tag);
}
if (process.argv[2] === "compile") await compile(tag);

async function prepare(tag: string) {
  console.log(`🥐 Rusty Buns-ifying Agent Office ${tag}`);

  // 1. the release tarball, cached, and checked against its sha256 every time
  const cache = path.join(root, ".cache");
  const tgz = await releaseTarball(tag, sha256!, cache);
  lap("release tarball (cached/verified)");
  rmSync(office, { recursive: true, force: true });
  const tmp = `${office}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await $`tar -xzf ${tgz} -C ${tmp}`.quiet();
  renameSync(path.join(tmp, "package"), office);
  rmSync(tmp, { recursive: true, force: true });

  // 2. its runtime dependencies, with Bun
  await $`bun install --production --ignore-scripts`.cwd(office).quiet();

  lap("extract + bun install");

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

  lap("shim + static patches");

  // 6. the GitHub boards kept fresh (live/github.ts): a worker's own gh writes and git pushes look again at once,
  // and a busy floor asks GitHub every few seconds, with a free conditional request, whether anything changed
  await buildLive();
  lap("server bundles (live)");
  prepend("floor.js", "import { liveGitHub as __rbLive } from './rb-live.js';\n");
  patch("floor.js", "        void this.github.refresh();\n        // A floor with people on it",
    "        void this.github.refresh();\n        this.__rbLive = __rbLive(this, def.dir);\n        // A floor with people on it");
  patch("floor.js", "this.github.stop();", "this.github.stop();\n        this.__rbLive?.stop();");
  patch("workers/manager.js", "notePr: (command, output) => this.prs.noteOwn(w, command, output),",
    "notePr: (command, output) => {\n                this.prs.noteOwn(w, command, output);\n                this.__rbOnGh?.(command);\n            },");

  // 7. the office and each floor's pty host watch their own memory (live/mem.ts), served at /__rb/mem with the
  // office's CPU profiles and heap snapshots (triage/server.ts): signed in, and to workers on the hook port
  prepend("http/router.js", "import { officeTriage as __rbTriage } from '../rb-triage.js';\nimport { codesplitterRoute as __rbCs } from '../rb-codesplitter.js';\nimport { podcastRoute as __rbPod } from '../rb-podcast.js';\nimport { boxRoute as __rbBox } from '../rb-box.js';\n");
  patch("http/router.js", "const signedIn = routes.filter((r) => r.auth === 'session');",
    "const signedIn = routes.filter((r) => r.auth === 'session');\n    const __rbRoutes = __rbTriage(ctx.cfg.dataDir, () => ctx.floors.values());\n    const __rbCsRoute = __rbCs();\n    const __rbPodRoute = __rbPod();\n    const __rbBoxRoute = __rbBox();");
  patch("http/router.js", "            for (const route of signedIn)\n",
    "            const __rb = p.startsWith('/__rb/') && (await __rbCsRoute(req.method, url) ?? await __rbPodRoute(req.method, url) ?? await __rbBoxRoute(req.method, url) ?? await __rbRoutes(req.method, url, req.headers['x-rb-triage'] === '1'));\n" +
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

  // 7b. a Host allowlist in front of every request and socket (live/hosts.ts): the DNS-rebinding guard
  prepend("http/router.js", "import { guardHost as __rbGuardHost } from '../rb-hosts.js';\n");
  patch("http/router.js", "    return async (req, res) => {\n        const { cfg, auth } = ctx;\n",
    "    const __rbHost = __rbGuardHost(ctx.cfg);\n    return async (req, res) => {\n        if (__rbHost(req, res))\n            return;\n        const { cfg, auth } = ctx;\n");
  prepend("ws/upgrade.js", "import { guardUpgrade as __rbGuardUpgrade } from '../rb-hosts.js';\n");
  patch("ws/upgrade.js", "        socket.on('error', () => socket.destroy());\n",
    "        socket.on('error', () => socket.destroy());\n        if ((ctx.__rbHost ??= __rbGuardUpgrade(cfg))(req, socket))\n            return;\n");

  // 7c. workers, their shells and the office's own claude and gh get its environment less the secrets (live/env.ts)
  prepend("workers/env.js", "import { workerEnv as __rbWorkerEnv } from '../rb-env.js';\n");
  patch("workers/env.js", "            env[k] = v;\n    return env;\n}", "            env[k] = v;\n    return __rbWorkerEnv(env);\n}");

  // 7d. Excalibrawl on every floor's whiteboard (live/brawl.ts): replays most of the hour, the live fight on the
  // hour, people's drawing put back after. AGENT_OFFICE_BRAWL=0 turns it off.
  prepend("floor.js", "import { excalibrawl as __rbBrawl } from './rb-brawl.js';\n");
  patch("floor.js", "        this.whiteboard = new Whiteboard(dataDir);\n",
    "        this.whiteboard = new Whiteboard(dataDir);\n        this.__rbBrawl = __rbBrawl(this, (msg) => ctx.emit(this, msg), () => ctx.people(this) > 0);\n");
  patch("floor.js", "        this.whiteboard.flush();", "        this.__rbBrawl?.stop();\n        this.whiteboard.flush();");

  // 8. Lucide icons for the emoji, on every page, a search box for the queue, and the codeSplitter mark (codesplitter/)
  lap("server patches (6-7d)");
  await buildPageScripts();
  lap("page scripts");

  // 9. the time on the issues and PR boards, in front of "Updated …" (its setting is a page script, clock/)
  clockOnBoards();

  // 10. the PR agent's brief: follow up with workers once their pull requests merge (briefs.ts)
  pullsFollowUp();

  // 11. a health bar of each PR's checks on the PR board (checks/), its tally from the list the board already fetches
  writeFileSync(path.join(srv, "github.js"), checkTallyServer(readFileSync(path.join(srv, "github.js"), "utf8")));
  prepend("github.js", SERVER_IMPORT);

  // 11b. an orange `external` label on issues and PRs from outside the repo's team (external/)
  writeFileSync(path.join(srv, "github.js"), externalServer(readFileSync(path.join(srv, "github.js"), "utf8")));
  prepend("github.js", EXTERNAL_IMPORT);
  patchAsk(checksBarClient);

  // 12. workers.json keeps a hash of each worker's hook token, not the token, so a worker can't read another's (#642)
  for (const [rel, change] of [["workers/util.js", hookTokensUtil], ["workers/persist.js", hookTokensPersist], ["workers/manager.js", hookTokensManager]] as const)
    writeFileSync(path.join(srv, rel), change(readFileSync(path.join(srv, rel), "utf8")));

  // 12b. the agent-to-agent endpoint stops trusting every worker on the floor (#644, live/floorguard.ts): a forced
  // send_home keeps another worker's uncommitted work, tell_worker says who it's from, AGENT_OFFICE_PEOPLE_ONLY
  writeFileSync(path.join(srv, "hooks/office-workers.js"), floorGuardHooks(readFileSync(path.join(srv, "hooks/office-workers.js"), "utf8")));
  // a board agent's queued tasks too: the same mark and the same guards, under the word `queue`
  writeFileSync(path.join(srv, "hooks/office-queue.js"), floorGuardQueue(readFileSync(path.join(srv, "hooks/office-queue.js"), "utf8")));
  // and AGENT_OFFICE_ASK_FIRST holds an agent's request for a person's Allow / Deny (#727): asked at /__rb/asks
  // (the card is a page script, asks/), with the office-workers command waiting long enough for the answer
  const bin = path.resolve(srv, "../../../bin/office-workers.js");
  writeFileSync(bin, floorGuardBin(readFileSync(bin, "utf8")));
  prepend("http/router.js", "import { asksRoute as __rbAsks } from '../rb-floorguard.js';\n");
  patch("http/router.js", "const __rb = p.startsWith('/__rb/') && (await __rbCsRoute(req.method, url)",
    "const __rb = p.startsWith('/__rb/') && (__rbAsks(req.method, url, req.headers['x-rb-ask'] === '1', session.account?.name) ?? await __rbCsRoute(req.method, url)");

  // 13. a per-frame hook in the 3D office, for either skin: the forest and the codeSplitter tiles both hang off it
  officeTicks();

  // 13b. the issues board's Open column puts issues already handed to a worker last, so new ones are on top (board.ts)
  patchAsk(openNewFirstClient);

  // 14. the Druids Curse skin
  lap("client patches (9-13b)");
  if (skin === "druids") await druids(cache);
  lap("druids skin (assets + build)");

  writeFileSync(stamp, `${tag} ${skin} lucide live clock mem pulls checks triage vale podcast codesplitter hosts hooktokens env ticks power board guard asks brawl ester dexter reload external\n`);
  console.log("   ✓ ./office  (bun run office starts it)");
}

async function druids(cache: string) {
  const pub = path.join(office, "dist/public");
  const dir = path.join(pub, "druids");

  // every enemy, the forest and the sounds, from the live game, cached
  const { MODELS, SOUND_FILES } = await import("../druids/assets.ts");
  const game = process.env.DRUIDS_CURSE_URL ?? "https://druids-curse-votv.notryanquinn.workers.dev";
  for (const file of [...MODELS.map((m) => `models/${m}.glb`), ...SOUND_FILES.map((f) => `sfx/${f}`)]) {
    const cached = path.join(cache, "druids", file.replace(/^models\//, ""));
    if (!existsSync(cached)) {
      const res = await fetch(`${game}/non_repo/${file}`);
      if (!res.ok) throw new Error(`Druids Curse ${file} failed (${res.status}) from ${game}`);
      await Bun.write(cached, res);
    }
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    cpSync(cached, path.join(dir, file));
  }

  // the jukebox has two tunes now, the Ambiance of the Vale and your podcast feed (druids/audio.ts plays them): on the
  // server, which keeps what's on, and in the client chunk its menu reads the list from
  const vale = "{ id: 'vale', title: 'Ambiance of the Vale', mood: 'the forest, breathing' }, { id: 'podcast', title: 'Podcast', mood: 'your feed, episode after episode' }";
  const tunes = path.join(office, "dist/server/shared/jukebox.js");
  const server = readFileSync(tunes, "utf8");
  const serverList = /export const JUKEBOX_TUNES = \[\n[^\]]*\];/;
  if (!serverList.test(server)) throw new Error("Agent Office changed: JUKEBOX_TUNES moved in shared/jukebox.js");
  writeFileSync(tunes, server.replace(serverList, `export const JUKEBOX_TUNES = [${vale}];`));
  const [dom, ...doms] = [...new Bun.Glob("assets/dom-*.js").scanSync({ cwd: pub })];
  if (!dom || doms.length) throw new Error(`Agent Office changed: expected one assets/dom-*.js, found ${doms.length + (dom ? 1 : 0)}`);
  const client = readFileSync(path.join(pub, dom), "utf8");
  const clientList = /\[\{id:`rainy-window`[^\]]*\]/;
  if (!clientList.test(client)) throw new Error("Agent Office changed: the jukebox's tunes moved in " + dom);
  writeFileSync(path.join(pub, dom), client.replace(clientList, "[{id:`vale`,title:`Ambiance of the Vale`,mood:`the forest, breathing`},{id:`podcast`,title:`Podcast`,mood:`your feed, episode after episode`}]"));
  // renames main-*.js too, which imports it
  rehash(pub, dom);

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
  // the gong rings the game's totem once it's loaded, and the jukebox plays the vale (druids/audio.ts)
  patch(file, "gong(e){_I(this.a,e)}", "gong(e){globalThis.__rbGong?.(this.a,e)||_I(this.a,e)}");
  patch(file, "let r=this.tune=new XS(t,this.musicIn,n.track)",
    "let r=this.tune=globalThis.__rbTune?.(t,this.musicIn,n.track)??new XS(t,this.musicIn,n.track)");
  // the bundle is served as immutable, so a patched one needs its own name or browsers keep the old one
  const renamed = main.replace(/\.js$/, `-rb${Bun.hash(readFileSync(file)).toString(36).slice(0, 6)}.js`);
  renameSync(file, path.join(pub, renamed));
  patch(path.join(pub, "index.html"), `<script type="module" crossorigin src="/${main}">`,
    `<script type="module" src="/druids/druids.js"></script>\n    <script type="module" crossorigin src="/${renamed}">`);
  console.log(`   ✓ Druids Curse office: ${MODELS.length} models, ${SOUND_FILES.length} sounds`);
}

// Every frame, once the sky has set the lights, each add-on on globalThis.__rbOfficeTicks gets a turn with the
// office (app, stage, dt, t): the Druids forest (druids/forest.ts), the codeSplitter tiles (codesplitter/).
function officeTicks() {
  const pub = path.join(office, "dist/public");
  const [main, ...more] = [...new Bun.Glob("assets/main-*.js").scanSync({ cwd: pub })];
  if (!main || more.length) throw new Error(`Agent Office changed: expected one assets/main-*.js, found ${more.length + (main ? 1 : 0)}`);
  patch(path.join(pub, main), "l.setWeather(s.rain,1-s.daylight)}function b(t)",
    "l.setWeather(s.rain,1-s.daylight),globalThis.__rbOfficeTicks?.forEach(f=>f(e,n.stage,r,i))}function b(t)");
  // Battery (power/): a frame rate to suit what you're doing, and no discrete GPU
  for (const [from, to] of POWER_PATCHES) patch(path.join(pub, main), from, to);
  rehash(pub, main);
}

function sharedBuild() {
  return (shared ??= (async () => {
    const built = await Bun.build({
      entrypoints: SHARED.map((e) => path.join(root, e)), root, minify: true, target: "browser",
      splitting: true, publicPath: "/", naming: { entry: "[dir]/[name].[ext]", chunk: "assets/rb-chunk-[hash].[ext]" },
    });
    if (!built.success) throw new AggregateError(built.logs, `${SHARED.join(", ")} failed to build`);
    const pub = path.join(office, "dist/public");
    for (const old of new Bun.Glob("assets/rb-chunk-*.js").scanSync({ cwd: pub })) rmSync(path.join(pub, old));
    const entries = new Map<string, string>();
    for (const out of built.outputs) {
      if (out.kind === "chunk") await Bun.write(path.join(pub, out.path), out);
      else entries.set(out.path.replace(/^\.\//, "").replace(/\.js$/, ".ts"), await out.text());
    }
    return entries;
  })());
}

async function buildSkin(dir: string) {
  writeFileSync(path.join(dir, "druids.js"), (await sharedBuild()).get("druids/index.ts")!);
}

// next to the server code they hook into, rebuilt every start like the skin
async function buildLive() {
  for (const [entry, out] of [["live/github.ts", "rb-live.js"], ["live/mem.ts", "rb-mem.js"], ["live/hosts.ts", "rb-hosts.js"], ["live/env.ts", "rb-env.js"], ["live/floorguard.ts", "rb-floorguard.js"], ["checks/server.ts", "rb-checks.js"], ["external/server.ts", "rb-external.js"], ["triage/server.ts", "rb-triage.js"],
    ["codesplitter/server.ts", "rb-codesplitter.js"], ["podcast/feed.ts", "rb-podcast.js"], ["sandbox/server.ts", "rb-box.js"], ["live/brawl.ts", "rb-brawl.js"],
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
  // the codeSplitter mark by the boards, off until Settings › You turns it on
  await buildPageScript("codesplitter/index.ts", "rb-codesplitter", ["index", "lite"]);
  // the Graphics setting and the frame rate it picks (power/), in the 3D office only
  await buildPageScript("power/index.ts", "rb-power", ["index"]);
  // the Box section of Settings (sandbox/), which reads and edits the box's permission set
  await buildPageScript("sandbox/page.ts", "rb-box", ["index"]);
  // AGENT_OFFICE_ASK_FIRST's Allow / Deny card, for an agent's request waiting on a person (#727)
  await buildPageScript("asks/index.ts", "rb-asks", ["index", "lite"]);
  // the gitpath, Mervin and Ester screens over the boards, in the 3D office only, off until Settings › You turns one on
  await buildPageScript("screens/index.ts", "rb-screens", ["index"]);
  // Ester and Mervin, the helper badges in the corner (ester/)
  await buildPageScript("ester/index.ts", "rb-ester", ["index", "lite"]);
  // refresh when the office's code changes, and say when the server has to restart (reload/, live/reload.ts)
  await buildPageScript("reload/index.ts", "rb-reload", ["index", "lite"]);
}

async function buildPageScript(entry: string, prefix: string, pages: string[]) {
  const js = SHARED.includes(entry) ? (await sharedBuild()).get(entry)! : await buildOne(entry);
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

async function buildOne(entry: string) {
  const built = await Bun.build({ entrypoints: [path.join(root, entry)], minify: true, target: "browser" });
  if (!built.success) throw new AggregateError(built.logs, `${entry} failed to build`);
  return built.outputs[0]!.text();
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
  // one at a time, looking again after each: renaming one importer renames the files that import it in turn, so a
  // file shared by two of them (main imports both ask and dom, say) would be gone from a list made up front
  const importer = () => ["*.html", "assets/*.js"].flatMap(g => [...new Bun.Glob(g).scanSync({ cwd: pub })])
    .find((f) => readFileSync(path.join(pub, f), "utf8").includes(from));
  for (let f = importer(); f; f = importer()) {
    writeFileSync(path.join(pub, f), readFileSync(path.join(pub, f), "utf8").replaceAll(from, to));
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
  // and the binary checks every start that the unpack still matches it, so a local process can't edit the page's script
  const sum = new Bun.CryptoHasher("sha256");
  for (const f of files) sum.update(f).update(readFileSync(path.join(pub, f)));
  const digest = sum.digest("hex");
  const unpack = `${tag}-${digest.slice(0, 8)}`;
  writeFileSync(path.join(gen, "assets.js"),
    files.map((f, i) => `import a${i} from ${JSON.stringify(path.join(pub, f))} with { type: "file" };`).join("\n") +
    `\nexport default [${files.map((f, i) => `[${JSON.stringify(f)}, a${i}]`).join(",")}];\n`);

  // one entry for every job the binary has: the office, its pty host, and the office-workers / office-queue commands
  const bin = (name: string) => JSON.stringify(path.join(office, "bin", name));
  writeFileSync(path.join(gen, "entry.js"), `
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  const intact = () => {
    if (!existsSync(path.join(dir, ".ok"))) return false;
    const sum = new Bun.CryptoHasher("sha256");
    try { for (const [rel] of assets) sum.update(rel).update(readFileSync(path.join(dir, rel))); } catch { return false; }
    return sum.digest("hex") === ${JSON.stringify(digest)};
  };
  if (!intact()) {
    const tmp = dir + ".tmp-" + process.pid;
    rmSync(tmp, { recursive: true, force: true });
    for (const [rel, src] of assets) {
      mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(tmp, rel), new Uint8Array(await Bun.file(src).arrayBuffer()));
    }
    writeFileSync(path.join(tmp, ".ok"), "");
    mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
    // an unpack that failed the check is moved aside first; a second office starting at once may win the rename
    if (existsSync(dir)) { const old = dir + ".bad-" + process.pid; try { renameSync(dir, old); rmSync(old, { recursive: true, force: true }); } catch {} }
    try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); }
    if (!intact()) throw new Error("agent-office: the office client in " + dir + " doesn't match this binary; remove it and start again");
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
