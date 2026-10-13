#!/usr/bin/env bun
// rustybuns: init | generate | deploy | dev | build desktop | eject

import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWrangler, parseWranglerToml, wranglerToConfig, wranglerStages, droppedWranglerKeys } from "./wrangler.ts";
import { generateAlchemy } from "./gen/alchemy.ts";
import { generateWrangler } from "./gen/wrangler.ts";
import { buildDesktop } from "./build.ts";
import { signDarwin } from "./sign.ts";
import { buildBox, checkBox } from "./box.ts";
import { watchDesktop } from "./watch.ts";
import { buildEnv, emptyHome, hostCommand, hostEnv, wantsSandbox } from "./sandbox.ts";
import { desktopServers, forStage, type RustyBunsConfig } from "./config.ts";
import { Effect } from "effect";
import { decodeConfig } from "./config-schema.ts";
import { AlchemyFailed, ConfigLoadFailed, DeployRefused, UsageError, closest, flag, intFlag, renderError } from "./errors.ts";
import { infer, readPackageJson, appsBelow, siblingServers, proxyServers } from "./glue/infer.ts";
import { unsupported } from "./glue/fit.ts";
import { planPort } from "./glue/port-vite.ts";
import { jekyllDefaults, jekyllExcludes, jekyllPagesPlugins, jekyllPlugins, staticBuild, type StaticSite } from "./glue/static-site.ts";
import { copySite, jekyllSiteFiles, staticSiteAt } from "./glue/site-files.ts";
import { jekyllPlan, type JekyllEnv } from "./glue/jekyll.ts";
import { sourceLayout, caseCollisions } from "./glue/source.ts";
import { analyze, report } from "./glue/boundary.ts";
import { generateBoundaryFiles, scaffoldDesktopPackage } from "./glue/desktop-scaffold.ts";
import { installCommand, applyOverrides, workspaceRoot, DEPLOY_DEPS } from "./glue/deploy-deps.ts";
import { workspacePrebuild } from "./glue/workspace-build.ts";
import { Profiler } from "./profile.ts";
import { adoptNote, alchemyStage, linkSharedState, lockState, noteChild, unlinkSharedState } from "./state.ts";
import { runScoped, spawnScoped, step } from "./lifecycle.ts";
import { commitsBehindMain, statefulDeletes, strayState } from "./guard.ts";
import { checkSpend, costReport } from "./costs.ts";
import { cloudflareEnv, cloudflareProblem, withAccount, realTokenCheck, realWrangler, wranglerCli } from "./cloudflare-auth.ts";
import { deployedWorker, redactQueryStrings } from "./redact.ts";
import { tidySourceMaps } from "./sourcemaps.ts";
import { ENV_SCHEMA, generateEnvSchema, schemaNeeds } from "./wheel.ts";
import { PROF_SECRET, boxUrl, fetchHistory, fetchMem, fetchProfile, secretProblem } from "./prof.ts";
import { formatProfileSummary, summarizeProfile } from "@rustybuns/shell-bun/profsummary";
import { formatMemStats } from "@rustybuns/shell-bun/memwatch";
import { formatHistory } from "@rustybuns/shell-bun/history";
import { TRIAGE_USAGE, triage } from "./triage.ts";
import { rustybunsContext } from "./triage-context.ts";
import { checkDisabled, checkVersion } from "./advisories.ts";
import { BUN_CHECK_MIN, STACK_TSCONFIG, checkFlags, compactDiagnostics, pickChecker, runCheck, stackTsconfig, type CheckerName } from "./typecheck.ts";

const [cmd, ...rest] = process.argv.slice(2);
const VERSION = (await Bun.file(new URL("../package.json", import.meta.url)).json()).version as string;

/**
 * rustybuns.config.ts, checked against config-schema.ts: a bad one stops here, naming each field.
 * With `stage`, as that stage deploys it: its `stages` entry laid over the rest.
 */
async function loadConfig(stage?: string): Promise<RustyBunsConfig> {
  const cfg = await loadRawConfig();
  if (stage === undefined) return cfg;
  if (cfg.stages && !cfg.stages[stage]) console.log(`stage ${stage}: no stages.${stage} in rustybuns.config.ts, so it deploys the config as written`);
  return forStage(cfg, stage);
}

async function loadRawConfig(): Promise<RustyBunsConfig> {
  const path = `${process.cwd()}/rustybuns.config.ts`;
  if (!(await Bun.file(path).exists())) throw new ConfigLoadFailed({ message: "no rustybuns.config.ts here; run `rustybuns init` first" });
  let mod: { default?: unknown };
  try { mod = await import(path); } catch (e) {
    const at = (e as { position?: { line: number; column: number } }).position;
    const hint = /Cannot find (package|module) '@rustybuns\/cli/.test((e as Error).message) ? `\n  @rustybuns/cli isn't installed in this app: \`${installHint()}\`` : "";
    throw new ConfigLoadFailed({ message: `rustybuns.config.ts${at ? `:${at.line}:${at.column}` : ""} doesn't load: ${(e as Error).message}${hint}` });
  }
  if (mod.default === undefined) throw new ConfigLoadFailed({ message: "rustybuns.config.ts has no default export; it should end `export default defineConfig({ ... })`" });
  return Effect.runPromise(decodeConfig(mod.default));
}

/** How this app adds Rusty Buns as a dev dependency. */
function installHint() {
  const pm = infer().pm;
  return `${pm === "npm" ? "npm i -D" : pm === "bun" ? "bun add -d" : `${pm} add -D`} @rustybuns/cli @rustybuns/shell-bun`;
}

async function writeIfChanged(path: string, content: string, opts: { adopt?: boolean } = {}) {
  const f = Bun.file(path);
  if (await f.exists()) {
    const cur = await f.text();
    if (cur === content) return "unchanged";
    if (!opts.adopt && !cur.startsWith("// GENERATED")) {
      await Bun.write(path.replace(/(\.[^.]+)$/, ".generated$1"), content);
      return "conflict";
    }
  }
  await Bun.write(path, content);
  return "written";
}

async function boundary(root = process.cwd()) {
  const cfg = (await Bun.file("rustybuns.config.ts").exists()) ? await loadConfig() : undefined;
  const src = sourceLayout(root, cfg);
  const { modules } = analyze({ root, srcDir: src.dir, aliases: src.aliases, ignore: src.ignore });
  const files = await generateBoundaryFiles(root, src.inf, modules, { actions: cfg?.targets.desktop?.actions });
  const { selectActions } = await import("./glue/desktop-scaffold.ts");
  const excluded = new Set(selectActions(modules.filter((m) => m.tier === "action"), cfg?.targets.desktop?.actions).off.map((m) => m.file));
  return { inf: src.inf, src, modules, files, excluded };
}

async function addDesktop(flags: string[]) {
  const root = process.cwd();
  const { inf, src, modules, excluded } = await boundary(root);
  const e = flags.indexOf("--entry");
  const out = await scaffoldDesktopPackage(root, inf, { entryComponent: e >= 0 ? flags[e + 1] : undefined, aliases: src.aliases });
  console.log(report(modules, excluded));
  for (const w of out.written) console.log("wrote   " + w.replace(root + "/", ""));
  for (const s of out.skipped) console.log("kept    " + s.replace(root + "/", ""));
  console.log(`\nnext: ${inf.execCmd("rustybuns build desktop --dev")}, then ${inf.execCmd("rustybuns run desktop")}`);
}

/** Install the pinned Alchemy + Effect set and force transitive @effect/* to match. */
async function addDeploy(dryRun: boolean) {
  const inf = infer();
  // In a workspace the overrides must live in the root package.json; a member's are ignored.
  const root = workspaceRoot(process.cwd());
  const pkgPath = root ? `${root}/package.json` : "package.json";
  const pkg = await Bun.file(pkgPath).json();
  const { changed } = applyOverrides(pkg, inf.pm);
  const cmd = installCommand(inf.pm, await Bun.file("pnpm-workspace.yaml").exists());
  console.log(`pinned deploy deps: ${Object.entries(DEPLOY_DEPS).map(([n, v]) => `${n}@${v}`).join(", ")}`);
  const where = root ? `the workspace root (${pkgPath})` : "package.json";
  if (dryRun) { console.log(`would write ${inf.pm === "pnpm" ? "pnpm.overrides" : "overrides"} to ${where} and run:\n  ${cmd}`); return; }
  if (changed) { await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); console.log(`wrote overrides to ${where}`); }
  console.log(`$ ${cmd}`);
  await $`sh -c ${cmd}`;
  console.log(`\nnext: set a throwaway "name" in rustybuns.config.ts, then ${inf.execCmd("rustybuns plan")}`);
}

/** KEY=VALUE lines from .dev.vars (wrangler's local secrets file). Values never leave the machine. */
function readDevVars(): Record<string, string> {
  if (!existsSync(".dev.vars")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

async function init() {
  const force = rest.includes("--force");
  let inf = infer();
  const spa = rest.includes("--spa");
  // A wrangler.jsonc that plan wrote from an earlier config doesn't make this a Worker app:
  // `init --force` after `plan` would otherwise read its own output back as the app's wrangler.
  const found = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find((f) => existsSync(f)) ?? null;
  const ours = found === "wrangler.jsonc" && readFileSync(found, "utf8").startsWith("// GENERATED by rustybuns");
  const src = ours ? null : found;
  // Refuse before printing or writing anything.
  if (existsSync("rustybuns.config.ts") && !force) throw new Error("rustybuns.config.ts already exists; init would overwrite it. Edit it directly, or pass --force to regenerate from scratch.");
  // No JavaScript app, but a site: plain HTML or a generator's (a GitHub Pages repo, say).
  const site = !src && inf.stack === "unknown" && !inf.scripts.build && !inf.vite.configPath && !inf.isWorkspaceRoot ? staticSiteAt(".") : null;
  if (site) { await initStatic(inf, site); return; }
  // The app is a folder down (frontend/, web/, apps/*): name it rather than refuse blind.
  const below = !src && inf.framework === "unknown" && !inf.vite.configPath ? appsBelow(".") : [];
  const goTo = below.length ? ` Found ${below.length > 1 ? "apps" : "an app"} in ${below.map((d) => `${d}/`).join(", ")}: \`cd ${below[0]} && rustybuns init\`.` : "";
  if (!inf.hasPackageJson) throw new Error(`no package.json here, and no static site (index.html, Jekyll, Hugo or MkDocs) either.${goTo || " Run `rustybuns init` from your app's directory."}`);
  if (inf.isWorkspaceRoot && !src && !inf.vite.configPath && inf.framework === "unknown")
    throw new Error(`this looks like a monorepo root (workspaces, no app here). cd into the package you want to ship and run init there.${goTo}`);
  if (rest.includes("--port-vite")) { await portVite(inf.stack, force); inf = infer(); }
  const later = inf.framework === "unknown" ? unsupported(inf.stack) : null;
  if (later && !force && inf.stack === "react-router")
    throw new Error(`this React Router app doesn't build with @cloudflare/vite-plugin; Rusty Buns runs the Worker that plugin builds (Cloudflare's React Router template). cloudflareDevProxy, Remix v2 and the Node server are ${later.issue}. Pass --force to write a config anyway.`);
  if (later && !force && (inf.stack === "cra" || inf.stack === "vue-cli"))
    throw new Error(`${later.name} builds with webpack. \`rustybuns init --port-vite\` ports it to Vite (vite.config.ts, index.html, package.json) and goes on as a Vite app (${later.issue}).`);
  if (later && !force && inf.stack === "webpack")
    throw new Error(`a custom webpack build isn't supported yet; \`rustybuns init --port-vite\` lists what to port to Vite (${later.issue}). Pass --force to write a config anyway.`);
  if (later && !force)
    throw new Error(`${later.name} isn't supported yet (${later.issue}). Pass --force to write a config anyway.`);
  const astroAdapter = inf.framework === "astro" ? inf.astro?.adapter ?? null : null;
  if (astroAdapter && astroAdapter !== "@astrojs/cloudflare" && !force)
    throw new Error(`this Astro app uses ${astroAdapter}; Rusty Buns runs the Worker that @astrojs/cloudflare builds. Switch with \`${inf.execCmd("astro")} add cloudflare\`, or drop the adapter for a static site. Pass --force to write a static config anyway.`);
  if (inf.framework === "unknown" && !src && !force)
    throw new Error(`no vite or rwsdk dependency in package.json, so this does not look like a web app Rusty Buns can box.${goTo || " Pass --force to write a config anyway."}`);
  console.log(`rustybuns ${(await Bun.file(new URL("../package.json", import.meta.url)).json()).version}`);
  console.log(`detected: ${inf.framework} app "${inf.name}" (${inf.pm}${inf.hasReact ? ", react" : ""}${inf.hasThree ? ", three" : ""}${inf.hasPrisma ? ", prisma" : ""}${inf.hasBetterAuth ? ", better-auth" : ""}${inf.postgres ? ", postgres" : ""})`);
  console.log(`source:   ${inf.srcDir}/ (${inf.srcDirSource}${Object.keys(inf.aliases).length ? `, aliases ${Object.entries(inf.aliases).map(([a, d]) => `${a}->${d}`).join(" ")}` : ""})`);
  if (inf.srcDirSource === "guess") {
    console.log(inf.srcDir === "."
      ? `          no src/, app/, lib/, client/ or web/ found, so the whole project root is treated as source.\n          set source: { dir, aliases } in rustybuns.config.ts before running add desktop`
      : `          not sure about that; set source: { dir, aliases } in rustybuns.config.ts if it's wrong`);
  }
  // macOS disks ignore case, so `./FactBar` can open factBar.ts there and fail the build (#1198).
  for (const g of caseCollisions(".", inf.srcDir))
    console.log(`warning:  ${g.join(" and ")} differ only by case; on macOS an import of one can open the other. Rename one.`);
  // Astro with no Cloudflare adapter is a static site: its build is the whole UI.
  const astroWorker = astroAdapter === "@astrojs/cloudflare" && !spa;
  if (inf.framework === "astro" && !astroWorker) {
    if (src) console.log(`ignoring ${src}: ${spa ? "--spa" : "no @astrojs/cloudflare adapter"}, so this is a static site with a desktop-only config.`);
    await initSpa(inf, `${inf.execCmd("astro")} build --outDir dist/ui`); return;
  }
  // TanStack Start off Cloudflare (Vercel, Netlify, Node) renders on its server and has no
  // index.html, so a SPA build serves nothing. The desktop runs its production server instead.
  if (inf.framework === "tanstack-start" && !src && !spa) { await initStart(inf); return; }
  if ((!src && !astroWorker) || spa) {
    if (src && spa) console.log(`ignoring ${src} (--spa): desktop-only config. Remove the flag to carry its bindings over.`);
    await initSpa(inf); return;
  }
  const wsrc = src ? await Bun.file(src).text() : null;
  // Astro's adapter makes a wrangler config of its own when the app has none.
  const w = wsrc === null ? { name: inf.name.replace(/^@[^/]+\//, "") } : src!.endsWith(".toml") ? parseWranglerToml(wsrc) : parseWrangler(wsrc);
  const dropped = droppedWranglerKeys(w);
  if (dropped.length) console.log(`not carried over: ${dropped.join(", ")}\n          (rustybuns.config.ts has no place for these yet; keep them in ${src} and do NOT run \`rustybuns adopt\`)`);
  // Where the Worker's bundle comes from: RWSDK's or the Cloudflare Vite plugin's build, else
  // none (a plain Worker; Alchemy bundles its main). Astro's adapter is set up below.
  const built = inf.framework === "rwsdk" ? "rwsdk" : !astroWorker && inf.vite.plugins.includes("cloudflare") ? "vite" : null;
  const cfg = wranglerToConfig(w, inf.scripts, built);
  // Astro: no worker source of its own unless the app set one. The adapter builds
  // dist/server/entry.mjs and the client into dist/client, and keeps sessions in KV.
  if (astroWorker) {
    cfg.worker!.main = w.main ?? "@astrojs/cloudflare/entrypoints/server";
    if (!cfg.worker!.build) cfg.worker!.build = "astro build";
  }
  // A package entry (@astrojs/cloudflare/entrypoints/server) resolves through node_modules, not a file here.
  const isFile = (m: string) => m.startsWith(".") || m.startsWith("/") || /\.[mc]?[jt]sx?$/.test(m);
  if (!(astroWorker && !w.main) && isFile(cfg.worker!.main!) && !/^(\.\/)?dist\//.test(cfg.worker!.main!) && !existsSync(cfg.worker!.main!)) console.log(`warning:  worker entry "${cfg.worker!.main}" ${w.main ? "(wrangler main)" : "(wrangler has no main; assumed)"} does not exist`);
  { const { inferWorkerBuild } = await import("./glue/build-script.ts"); const b = inferWorkerBuild(inf.scripts, null);
    console.log(!cfg.worker!.build ? `build:    none (a plain Worker: Alchemy bundles ${cfg.worker!.main})`
      : `build:    ${cfg.worker!.build}  (${b.from === "default" || b.build !== cfg.worker!.build ? "no build script found; using the default" : `from "${b.from}" script`})`); }
  // D1: wrangler's own default migrations dir is ./migrations when migrations_dir is unset.
  for (const b of Object.values(cfg.bindings)) {
    if (b.type === "d1" && !b.migrationsDir && existsSync("migrations")) b.migrationsDir = "migrations";
  }
  // Built worker entry: rwsdk 1.x emits dist/worker/index.js; 0.x and the 1.0.0 alphas emitted
  // dist/worker/worker.js. The build's own dist/worker/wrangler.json settles it at build time.
  {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const rw = String({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }["rwsdk"] ?? "");
    const major = Number(rw.replace(/^[^0-9]*/, "").split(".")[0]);
    if (major >= 1 && !/^[^0-9]*1\.0\.0-alpha/.test(rw)) cfg.worker!.builtMain = "dist/worker/index.js";
  }
  // React Router's Cloudflare template: @cloudflare/vite-plugin builds the Worker into the
  // react-router build directory, and the desktop runs that same Worker.
  const rrWorker = inf.framework === "react-router";
  if (rrWorker) {
    cfg.worker!.builtMain = `${inf.reactRouterBuild}/server/index.js`;
    cfg.worker!.assets = `${inf.reactRouterBuild}/client`;
  }
  if (astroWorker) {
    // Older adapters (and their wrangler files) build dist/_worker.js and serve dist/; newer ones dist/server + dist/client.
    const prebuilt = w.main && /^(\.\/)?dist\//.test(w.main) ? w.main.replace(/^\.\//, "") : null;
    cfg.worker!.builtMain = prebuilt ?? "dist/server/entry.mjs";
    cfg.worker!.assets = prebuilt ? (w.assets?.directory ?? "dist").replace(/^\.\//, "") : "dist/client";
    const kv = inf.astro!.sessionKV;
    if (!cfg.bindings[kv]) { cfg.bindings[kv] = { type: "kv" }; console.log(`sessions: ${kv} (KV, the binding @astrojs/cloudflare keeps sessions in)`); }
    const img = inf.astro!.images;
    if (img && !Object.values(cfg.bindings).some((b) => b.type === "images")) { cfg.bindings[img] = { type: "images" }; console.log(`images:   ${img} (Cloudflare Images, for the adapter's /_image; a passthrough on the desktop)`); }
  }
  // Secrets: names only, from .dev.vars. Values are read from .dev.vars at deploy time.
  const secrets = Object.keys(readDevVars()).filter((k) => !cfg.bindings[k]);
  for (const k of secrets) cfg.bindings[k] = { type: "secret" };
  if (secrets.length) console.log(`secrets:  ${secrets.join(" ")}  (names from .dev.vars)`);
  // Postgres: Hyperdrive in front of it on the edge; the desktop and box connect to the URL itself.
  if (inf.postgres && !Object.values(cfg.bindings).some((b) => b.type === "hyperdrive")) {
    const name = cfg.bindings["HYPERDRIVE"] ? "PG" : "HYPERDRIVE";
    cfg.bindings["DATABASE_URL"] ??= { type: "secret" };
    cfg.bindings[name] = { type: "hyperdrive", urlSecret: "DATABASE_URL" };
    console.log(`postgres: ${name} (Hyperdrive, for ${inf.postgres}) in front of the DATABASE_URL secret; read env.${name}.connectionString`);
  }
  // Desktop client build: always the vite.desktop.config.ts that `add desktop` generates,
  // never the app's own vite config: it can point at files Rusty Buns doesn't own. What the
  // app's build runs before vite (prisma generate, codegen) runs first, as in initSpa (#403).
  const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  // Astro and React Router: the desktop runs the Worker build under Bun, same bundle as the edge.
  if (astroWorker || rrWorker) cfg.targets.desktop = { mode: "worker", targets: [host as any] };
  else {
    const d = cfg.targets.desktop!;
    const { preViteSteps } = await import("./glue/build-script.ts");
    const pre = [...new Set([...inf.prebuild, ...preViteSteps(cfg.worker?.build ?? "")])];
    d.clientBuild = [...pre, `${inf.execCmd("vite")} build --config vite.desktop.config.ts`].join(" && ");
    d.targets = [host as any];
  }
  console.log(`desktop:  building for ${host} only; add other targets in rustybuns.config.ts`);
  cfg.source = { dir: inf.srcDir, aliases: inf.aliases };
  // Wrangler's env.<name> blocks: a stage each, deployed with `--stage <name>`.
  if (w.env && Object.keys(w.env).length) {
    const { stages, missing } = wranglerStages(w, cfg);
    if (Object.keys(stages).length) { cfg.stages = stages; console.log(`stages:   ${Object.keys(stages).join(" ")}  (from wrangler's env blocks; deploy one with --stage <name>)`); }
    if (missing.length) console.log(`warning:  wrangler doesn't bind these in their env, but the stage keeps the top level's: ${missing.join(", ")}`);
  }
  const body = `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`;
  await Bun.write("rustybuns.config.ts", body);
  console.log(`wrote rustybuns.config.ts${src ? ` from ${src}` : ""}`);
  await ignoreOurs();
  // Wrangler doesn't record a Vectorize index's dimensions; the config won't load until they're set.
  const undimensioned = Object.entries(cfg.bindings).filter(([, b]) => b.type === "vectorize" && !b.dimensions);
  for (const [n, b] of undimensioned)
    console.log(`todo:     bindings.${n}.dimensions: ${(b as { indexName: string }).indexName}'s vector length (\`wrangler vectorize info ${(b as { indexName: string }).indexName}\`); wrangler doesn't record it`);
  if (undimensioned.length) { console.log(`\nnext: set those dimensions, then ${inf.execCmd("rustybuns plan")}`); return; }
  await generate({ adopt: false });
  // The boundary report is for `add desktop`'s spa split; a worker-mode desktop runs the whole Worker.
  if (!astroWorker && !rrWorker) { const { modules } = await boundary(); console.log(report(modules)); }
  console.log(astroWorker || rrWorker
    ? `\nnext: ${inf.execCmd("rustybuns build desktop --dev")} && ${inf.execCmd("rustybuns run desktop")}, or ${inf.execCmd("rustybuns plan")}`
    : `\nnext: rustybuns add desktop [--entry ./src/app/App.tsx#App]`);
}

/** What plan and build write and nobody commits. */
async function ignoreOurs() {
  const gi = Bun.file(".gitignore");
  const cur = (await gi.exists()) ? await gi.text() : "";
  const want = [".rustybuns/", "wrangler.generated.jsonc", ".alchemy/"];
  const have = new Set(cur.split("\n").map((l) => l.trim()));
  const missing = want.filter((l) => !have.has(l));
  if (missing.length) {
    const sep = cur === "" || cur.endsWith("\n") ? "" : "\n";
    await Bun.write(".gitignore", `${cur}${sep}\n# rustybuns\n${missing.join("\n")}\n`);
    console.log(`added to .gitignore: ${missing.join(" ")}`);
  }
}

/** `init --port-vite`: CRA or Vue CLI onto Vite (port-vite.ts). Refuses before writing if a file it writes exists. */
async function portVite(stack: ReturnType<typeof infer>["stack"], force: boolean) {
  const port = planPort(process.cwd(), stack);
  if (typeof port === "string") throw new Error(port);
  const taken = ["vite.config.ts", "index.html"].filter((f) => existsSync(f));
  if (taken.length && !force) throw new Error(`--port-vite would overwrite ${taken.join(" and ")}. Move ${taken.length > 1 ? "them" : "it"} aside, or pass --force.`);
  for (const [f, c] of Object.entries(port.writes)) await Bun.write(f, c);
  for (const f of port.remove) await rm(f, { force: true });
  console.log(`ported to Vite: wrote vite.config.ts, index.html (from ${port.remove.join(", ")}), package.json (vite, scripts)`);
  for (const n of port.notes) console.log(`  todo: ${n}`);
  const after = infer();
  console.log(`  then: ${after.pm} install && ${after.execCmd("vite")} build\n`);
}

/**
 * No wrangler: a plain Vite SPA. The desktop target is the whole story:
 * your `vite build` output, served by the Bun host, plus an optional host
 * module for the backend routes the app needs (files, native, exports).
 */
async function initStart(inf: ReturnType<typeof infer>) {
  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const { startLayout } = await import("./glue/start-layout.ts");
  const l = startLayout(inf.vite.configPath ? readFileSync(inf.vite.configPath, "utf8") : "");
  const build = [...inf.prebuild, `${l.env}${inf.execCmd("vite")} build${inf.vite.buildConfig ? ` --config ${inf.vite.buildConfig}` : ""}`].join(" && ");
  const cfg = {
    name: inf.name.replace(/^@[^/]+\//, ""),
    source: { dir: inf.srcDir, aliases: inf.aliases },
    worker: { main: l.builtMain, builtMain: l.builtMain, assets: l.assets, build, compatibilityDate: new Date().toISOString().slice(0, 10), compatibilityFlags: ["nodejs_compat"] },
    bindings: {},
    targets: { desktop: { mode: "worker", targets: [hostTag] } },
  };
  await Bun.write("rustybuns.config.ts", `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`);
  console.log(`wrote rustybuns.config.ts (TanStack Start: the desktop runs its production server, ${l.builtMain})`);
  console.log(`build:    ${build}`);
  if (l.warn) console.log(`warning:  ${l.warn}`);
  console.log(`\nnext: ${inf.execCmd("rustybuns build desktop --dev")} && ${inf.execCmd("rustybuns run desktop")}`);
}

/** A static site: its build output is the UI, on the desktop and as an assets-only Worker on the web. */
async function initStatic(inf: ReturnType<typeof infer>, site: StaticSite) {
  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const name = (inf.hasPackageJson ? inf.name : process.cwd().split(/[\\/]/).pop()!).replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  console.log(`rustybuns ${VERSION}`);
  console.log(`detected: ${site.label}${site.kind === "html" ? ` in ${site.dir === "." ? "the project root" : site.dir + "/"}` : ""}, no JavaScript app`);
  const jekyllConfig = existsSync("_config.yml") ? "_config.yml" : "_config.yaml";
  if (site.kind === "jekyll") {
    // Jekyll copies every file it doesn't exclude into the site: our config, desktop/ and dist/ (binaries) too.
    // A second config file layered on the app's own keeps them out, and serves from / instead of a Pages baseurl.
    const cfgFile = jekyllConfig;
    const own = (Bun as any).YAML.parse(readFileSync(cfgFile, "utf8")) ?? {};
    // No Gemfile: GitHub Pages builds it, with a plugin plain Jekyll lacks that gives layout-less pages one.
    const layouts = existsSync("Gemfile") || !existsSync("_layouts") ? [] : readdirSync("_layouts", { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name.replace(/\.[^.]+$/, ""));
    const defaults = jekyllDefaults(layouts, own.defaults);
    // Pages' other default plugins need their gems: turn on the ones the site leans on, and `rustybuns jekyll` installs them.
    const uses = existsSync("Gemfile") ? [] : jekyllPagesPlugins(jekyllSiteFiles(".", jekyllExcludes(own.exclude)), (f) => readFileSync(f, "utf8"));
    // Jekyll still reads the old `gems` key, and it replaces `plugins`, so a site on it gets both.
    const plugins = jekyllPlugins(uses, own.plugins ?? own.gems);
    await Bun.write("_config.rustybuns.yml", `# Written by rustybuns init: layered on ${cfgFile} for Rusty Buns builds only.\nbaseurl: ""\nexclude: ${JSON.stringify(jekyllExcludes(own.exclude))}\n`
      + (defaults.length ? `# GitHub Pages' default layouts (jekyll-default-layout), and the site's own defaults after them.\ndefaults: ${JSON.stringify(defaults)}\n` : "")
      + (plugins.length ? `# GitHub Pages' default plugins this site leans on, after its own; rustybuns jekyll installs their gems.\nplugins: ${JSON.stringify(plugins)}\n`
        + (own.gems !== undefined ? `gems: ${JSON.stringify(plugins)}\n` : "") : ""));
    console.log(`wrote _config.rustybuns.yml (baseurl "", ${defaults.length ? "GitHub Pages' default layouts, " : ""}${uses.length ? "its default plugins this site needs, " : ""}and Rusty Buns' files kept out of the site)`);
    for (const u of uses) console.log(`plugin:   ${u.plugin}, as on Pages: ${u.what} (${u.files.slice(0, 3).join(", ")}${u.files.length > 3 ? `, ${u.files.length - 3} more` : ""})`);
  }
  const build = (out: string) => staticBuild(site, out, { jekyllConfig, exec: inf.execCmd });
  const cfg = {
    name,
    source: { dir: inf.srcDir, aliases: inf.aliases },
    worker: { assets: "dist/web", compatibilityDate: new Date().toISOString().slice(0, 10), compatibilityFlags: [], build: build("dist/web"), notFoundHandling: "404-page" },
    bindings: {},
    targets: {
      edge: { provider: "cloudflare" },
      desktop: { mode: "spa", clientBuild: build("dist/ui"), clientDir: "dist/ui", world: false, host: "desktop/host.ts", targets: [hostTag] },
    },
  };
  await Bun.write("rustybuns.config.ts", `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`);
  console.log(`wrote rustybuns.config.ts (the desktop, and the web as static files on Workers)`);
  console.log(`build:    ${cfg.targets.desktop.clientBuild}`);
  await writeHost();
  // Rusty Buns is a dev dependency, so a site with no package.json gets one to hold it.
  if (!inf.hasPackageJson) {
    await Bun.write("package.json", JSON.stringify({ name, private: true, devDependencies: { "@rustybuns/cli": `^${VERSION}`, "@rustybuns/shell-bun": `^${VERSION}` } }, null, 2) + "\n");
    console.log(`wrote package.json (Rusty Buns as a dev dependency)`);
  }
  // The generator lives outside npm: say so now, not halfway through a build.
  if (site.kind === "jekyll") {
    const args = ["build", "--config", `${jekyllConfig},_config.rustybuns.yml`];
    const plan = jekyllPlan(args, jekyllEnv(args));
    if (plan.how === "none") console.log(`warning:  ${plan.why}`);
    else if (plan.how === "docker") console.log(`jekyll:   no Ruby 3+ Jekyll${plan.plugins ? " with the site's plugins" : ""} here, so builds run in Docker (${plan.image}; the first one installs Jekyll${plan.plugins ? " and them" : ""})`);
  } else if (site.tool && !Bun.which(site.tool)) {
    const how = { hugo: "`brew install hugo` or gohugo.io", mkdocs: "`pip install mkdocs`" }[site.kind as "hugo" | "mkdocs"];
    console.log(`warning:  ${site.tool} is not on PATH; the build needs ${how}`);
  }
  console.log(`\nnext: ${inf.hasPackageJson ? "" : `${inf.pm} install && `}${inf.execCmd("rustybuns build desktop --dev")} && ${inf.execCmd("rustybuns run desktop")}, or ${inf.execCmd("rustybuns plan")}`);
}

function jekyllEnv(args: string[]): JekyllEnv {
  const ruby = Bun.which("ruby") ? Bun.spawnSync(["ruby", "-e", "print RUBY_VERSION"]).stdout?.toString() ?? "" : "";
  const gemfile = existsSync("Gemfile");
  return { ruby, has: (bin) => !!Bun.which(bin), gemfile, cwd: process.cwd(), plugins: gemfile ? [] : jekyllConfigPlugins(args),
    gem: (name) => Bun.spawnSync(["gem", "list", "-i", `^${name}$`]).exitCode === 0 };
}

/** The `plugins` Jekyll will run with these args: the last `--config` file (default _config.yml) to set them wins. */
function jekyllConfigPlugins(args: string[]): string[] {
  const i = args.findIndex((a) => a === "--config" || a.startsWith("--config="));
  const files = i < 0 ? ["_config.yml", "_config.yaml"].filter((f) => existsSync(f)).slice(0, 1)
    : (args[i]!.includes("=") ? args[i]!.slice(args[i]!.indexOf("=") + 1) : args[i + 1] ?? "").split(",").filter(Boolean);
  let plugins: unknown;
  for (const f of files) {
    let cfg: any;
    try { cfg = (Bun as any).YAML.parse(readFileSync(f, "utf8")); } catch { continue; }
    if (cfg?.plugins !== undefined || cfg?.gems !== undefined) plugins = cfg.plugins ?? cfg.gems;
  }
  return Array.isArray(plugins) ? plugins.map(String) : [];
}

/** `rustybuns jekyll <args>`: Jekyll on this machine's Ruby 3+, else in Docker. Exits with its code. */
function jekyll(args: string[]) {
  const plan = jekyllPlan(args, jekyllEnv(args));
  if (plan.how === "none") throw new Error(plan.why);
  if (plan.how === "docker") console.error(`rustybuns: no Ruby 3+ Jekyll${plan.plugins ? " with the site's plugins" : ""} here; running it in Docker (${plan.image})`);
  process.exit(Bun.spawnSync(plan.argv, { stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1);
}

async function writeHost() {
  if (await Bun.file("desktop/host.ts").exists()) return;
  await Bun.write("desktop/host.ts", `// Your desktop backend. Runs in the Bun host next to your built SPA.
// Return a Response for routes you own, null for everything else.
import type { HostContext } from "@rustybuns/shell-bun";

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname === "/api/hello") return Response.json({ hello: ctx.identity["X-User-Name"], dataDir: ctx.dataDir });
    return null;
  },
};
`);
  console.log("wrote desktop/host.ts");
}

async function initSpa(inf: ReturnType<typeof infer>, clientBuild?: string) {
  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const astro = inf.framework === "astro";
  // vite resolves --outDir against its `root`, so a root of public/ would build into public/dist/ui.
  const outDir = (d: string) => inf.vite.root ? relative(inf.vite.root, d).split("\\").join("/") : d;
  // The app's prebuild steps first, and the vite config its build names (#403).
  const vite = (d: string) => [...inf.prebuild, `${inf.execCmd("vite")} build${inf.vite.buildConfig ? ` --config ${inf.vite.buildConfig}` : ""} --outDir ${outDir(d)} --emptyOutDir`].join(" && ");
  clientBuild ??= vite("dist/ui");
  // The same build, put on the web as an assets-only Worker: Cloudflare serves the files, no
  // code of ours runs. Not for an app with a Node server: its frontend alone wouldn't work.
  // A vite config that names its own outDir keeps it: plugins write there too (a sitemap, a
  // service worker's precache list), and moving the build out from under them breaks it.
  const own = !astro && inf.vite.outDir && !inf.vite.outDir.startsWith("/")
    ? join(inf.vite.root ?? ".", inf.vite.outDir).split("\\").join("/") : null;
  // A dev proxy (server.proxy: /api -> :3000) means the frontend talks to a server of its own
  // that the build doesn't contain: on the web every one of those calls would get index.html.
  const proxied = astro ? [] : inf.vite.proxy;
  const web = inf.serverDeps.length || proxied.length ? null : {
    assets: own ?? "dist/web",
    compatibilityDate: new Date().toISOString().slice(0, 10),
    compatibilityFlags: [],
    build: astro ? `${inf.execCmd("astro")} build --outDir dist/web`
      : own ? [...inf.prebuild, `${inf.execCmd("vite")} build${inf.vite.buildConfig ? ` --config ${inf.vite.buildConfig}` : ""}`].join(" && ") : vite("dist/web"),
    notFoundHandling: astro ? "404-page" : "single-page-application",
  };
  // The servers beside the app the proxy points at, whose files init can name: the host runs each
  // and proxies its paths to it. Paths that go to a server it didn't find are left for host.ts.
  const servers = proxied.length ? siblingServers(".") : [];
  const { found, left } = proxyServers(Object.fromEntries(proxied.map((p) => [p, inf.vite.proxyTargets[p] ?? null])), servers);
  const specs = found.map((f) => ({ entry: f.server.entry!, paths: f.paths, ...(f.port ? { port: f.port } : {}) }));
  const server = specs.length > 1 ? specs : specs[0] ?? null;
  const cfg = {
    name: inf.name.replace(/^@[^/]+\//, ""),
    source: { dir: inf.srcDir, aliases: inf.aliases },
    ...(web ? { worker: web } : {}),
    bindings: {},
    targets: {
      ...(web ? { edge: { provider: "cloudflare" } } : {}),
      desktop: {
        mode: "spa",
        // dist/ holds the binaries; the UI gets its own folder inside it.
        clientBuild,
        clientDir: "dist/ui",
        world: false,
        host: "desktop/host.ts",
        ...(server ? { server } : {}),
        targets: [hostTag],
      },
    },
  };
  await Bun.write("rustybuns.config.ts", `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`);
  const what = astro ? "a static Astro site" : "no wrangler found";
  console.log(web ? `wrote rustybuns.config.ts (${what}: the desktop, and the web as static files on Workers, from ${web.assets})`
    : inf.serverDeps.length ? `wrote rustybuns.config.ts (desktop-only: it runs a Node server (${inf.serverDeps.join(", ")}), so its frontend alone can't go on the web)`
    : `wrote rustybuns.config.ts (desktop-only: ${relative(".", inf.vite.configPath!)} proxies ${proxied.join(", ")} to a separate server in dev, so its frontend alone can't go on the web)`);
  for (const f of found)
    console.log(`backend:  ${f.server.dir} (${f.server.runs}) runs beside the desktop host: desktop.server proxies ${f.paths.join(", ")} to it, with DATA_DIR in the app's data dir. The web can't run it, so the app stays off the edge`);
  if (left.length) {
    const rest = servers.filter((s) => !found.some((f) => f.server === s));
    console.log(rest.length
      ? `backend:  ${rest.map((s) => `${s.dir} (${s.runs})`).join(", ")} ${rest.length > 1 ? "may be" : "looks like"} the server for ${left.join(", ")}. Rusty Buns can't tell which file it runs or which paths are its: add it to desktop.server, answer them in desktop/host.ts, or port it to a Worker, before \`plan\``
      : `backend:  answer ${left.join(", ")} in desktop/host.ts, or port that server to a Worker, before \`plan\``);
  }
  await writeHost();
  await ignoreOurs();
  console.log(`\nnext: ${inf.execCmd("rustybuns build desktop --dev")} && ${inf.execCmd("rustybuns run desktop")}${web ? `, or ${inf.execCmd("rustybuns add deploy")} then ${inf.execCmd("rustybuns plan")}` : ""}`);
}

/** Keys in a hand-written wrangler file that the generated one cannot reproduce. */
function wranglerLosses(): string[] {
  const f = ["wrangler.jsonc", "wrangler.json"].find((x) => existsSync(x));
  if (!f) return [];
  try { return droppedWranglerKeys(parseWrangler(readFileSync(f, "utf8"))); } catch { return []; }
}

/** The stack for `stage` (the config as written when unset); wrangler.jsonc, local dev's, always from the config as written. */
async function generate(opts: { adopt: boolean; stage?: string }) {
  const raw = await loadRawConfig();
  const cfg = forStage(raw, opts.stage ?? "");
  if (!cfg.worker && !cfg.targets.box) { console.log("desktop-only config: nothing to generate for the edge"); return; }
  // A bad cron fails here, not on Cloudflare's side halfway into a deploy.
  if (cfg.worker?.crons?.length) {
    const { parseCron } = await import("@rustybuns/shell-bun");
    for (const c of cfg.worker.crons) parseCron(c);
  }
  const cpu = cfg.worker?.cpuMs;
  if (cpu !== undefined && !(Number.isInteger(cpu) && cpu >= 10 && cpu <= 300_000)) throw new Error(`worker.cpuMs: ${cpu} isn't a whole number of ms from 10 to 300000`);
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/alchemy.run.ts", generateAlchemy(opts.stage === undefined ? cfg : forStage(raw, opts.stage)));
  console.log("wrote .rustybuns/alchemy.run.ts");
  await writeEnvSchema(cfg);
  if (!cfg.worker) return;   // box-only: no wrangler.jsonc
  if (opts.adopt && !rest.includes("--force")) {
    const lost = wranglerLosses();
    if (lost.length) throw new Error(`adopt would delete from wrangler.jsonc: ${lost.join(", ")}. Move those into the config first, or pass --force.`);
  }
  const r = await writeIfChanged("wrangler.jsonc", generateWrangler(cfg, existsSync("wrangler.jsonc") ? readFileSync("wrangler.jsonc", "utf8") : null), opts);
  if (r === "conflict") console.log("wrangler.jsonc is hand-written and differs; wrote wrangler.generated.jsonc. Diff it" + (wranglerLosses().length ? " (it lacks " + wranglerLosses().join(", ") + ", so adopt will refuse)." : ", then `rustybuns adopt`."));
  else console.log(`wrangler.jsonc ${r}`);
}

/** The app's .env.schema: generated until someone removes the header, then theirs. */
async function writeEnvSchema(cfg: RustyBunsConfig) {
  const schema = generateEnvSchema(cfg);
  const cur = existsSync(ENV_SCHEMA) ? readFileSync(ENV_SCHEMA, "utf8") : null;
  if (cur !== null && !cur.startsWith("# GENERATED")) {
    if (cfg.experimental?.wheel) console.log(`${ENV_SCHEMA} is hand-written; using it as-is`);
    return;
  }
  if (!schema) { if (cur !== null) { await rm(ENV_SCHEMA); console.log(`removed ${ENV_SCHEMA} (no experimental.wheel secrets)`); } return; }
  if (cur !== schema) { await Bun.write(ENV_SCHEMA, schema); console.log(`wrote ${ENV_SCHEMA} (experimental.wheel: "${cfg.experimental!.wheel}"; commit it)`); }
  // Plenty of .gitignores carry `.env*`, which would keep the schema out of the repo.
  if (Bun.spawnSync(["git", "check-ignore", "-q", ENV_SCHEMA]).exitCode === 0)
    console.log(`  .gitignore hides ${ENV_SCHEMA}; add a line \`!${ENV_SCHEMA}\` so it travels with the repo`);
}

/** Hash of what would be deployed: the generated stack + the config. */
async function stackHash(): Promise<string> {
  const a = await Bun.file(".rustybuns/alchemy.run.ts").text();
  const c = await Bun.file("rustybuns.config.ts").text();
  return Bun.hash(a + "\n" + c).toString(16);
}

/**
 * The project's own alchemy CLI. Never a bare `bunx alchemy`: that fetches the
 * newest beta from npm, which is not the pinned set and cannot find its peers.
 */
function alchemyCli(): string[] {
  if (existsSync("node_modules/.bin/alchemy")) return ["node_modules/.bin/alchemy"];
  let pkg: string | undefined;
  try { pkg = Bun.resolveSync("alchemy/package.json", process.cwd()); } catch { /* not installed */ }
  // Bun's auto-install resolves from its global cache; that copy has no peers either.
  const version = pkg && !pkg.includes("/.bun/install/cache/") ? JSON.parse(readFileSync(pkg, "utf8")).version : undefined;
  if (version === DEPLOY_DEPS.alchemy) return ["node", join(dirname(pkg!), "bin", "cli.js")];
  throw new Error(version
    ? `this project has alchemy ${version}, not the pinned ${DEPLOY_DEPS.alchemy}. Run \`rustybuns add deploy\` to pin it.`
    : "no Alchemy in this project. Run `rustybuns add deploy` here first (it installs the pinned set), or cd into an app that has it.");
}

/** Alchemy's provider names, for `rustybuns login <provider>`. */
const PROVIDERS: Record<string, string> = { cloudflare: "Cloudflare", hetzner: "Hetzner", railway: "Railway" };

/**
 * The varlock the CLI ships with: it's the process that receives the 1Password
 * values, so a project's node_modules/.bin or PATH doesn't get to swap it out.
 * RUSTYBUNS_VARLOCK names another one on purpose.
 */
function varlockCli(): string[] {
  if (process.env.RUSTYBUNS_VARLOCK) return [process.env.RUSTYBUNS_VARLOCK];
  // A dependency of the CLI, so every install has it; its bin isn't always linked.
  return [process.execPath, join(dirname(fileURLToPath(import.meta.resolve("varlock/package.json"))), "bin", "cli.js")];
}

/**
 * experimental.wheel: run `cmd` under varlock so the op secrets arrive as env.
 * "human" strips any 1Password token, so only the app on this machine can unlock.
 */
function underVarlock(cfg: RustyBunsConfig, cmd: string[], env: Record<string, string | undefined>): string[] {
  const needs = schemaNeeds(readFileSync(ENV_SCHEMA, "utf8"));
  if (cfg.experimental?.wheel === "human") {
    delete env.OP_TOKEN; delete env.OP_SERVICE_ACCOUNT_TOKEN;
    if (needs.opCli && !Bun.which("op")) throw new Error(`experimental.wheel "human" unlocks 1Password through its CLI, \`op\`, which isn't on PATH. Install it and turn on "Integrate with 1Password CLI" in the 1Password app.`);
  } else if (needs.opToken && !env.OP_TOKEN) {
    throw new Error(`experimental.wheel "agent" reads op secrets with a 1Password service account token. Set OP_TOKEN (scope the account to this stack's vault).`);
  }
  return [...varlockCli(), "run", "--path", ENV_SCHEMA, "--", ...cmd];
}

/** The Cloudflare API token the last runAlchemy handed Alchemy, if it had one; the post-deploy settings use it too. */
let cloudflareToken: string | undefined;

/**
 * Run the project-local alchemy with the terminal attached, so its prompts work, for the life
 * of the current scope: interrupted (a signal), it is stopped and waited for. `onStart` gets its pid.
 */
const alchemyProcess = (args: string[], cfg?: RustyBunsConfig, extra: Record<string, string> = {}, onStart?: (pid: number) => void,
  cf?: Record<string, string>) =>
  step(() => alchemyCommand(args, cfg, extra, cf)).pipe(Effect.flatMap(({ cmd, env }) => spawnScoped(cmd, { stdio: ["inherit", "inherit", "inherit"], env }, onStart)));

/** runAlchemy outside plan/deploy/destroy (`login`). */
const runAlchemy = (args: string[], cfg?: RustyBunsConfig) => runScoped(alchemyProcess(args, cfg));

/** Alchemy's env before the Cloudflare login: secret values from .dev.vars, anything exported in the shell wins. */
const alchemyBaseEnv = (extra: Record<string, string> = {}, cfg?: RustyBunsConfig): Record<string, string | undefined> =>
  withAccount(cfg, { ...readDevVars(), ...process.env, ...extra });

/** An edge stack logs in to Cloudflare through wrangler, with only the scopes it needs; {} leaves it to the shell or Alchemy's profile. */
async function wranglerLogin(cfg: RustyBunsConfig, env: Record<string, string | undefined>): Promise<Record<string, string>> {
  if (!cfg.targets.edge) return {};
  const w = wranglerCli();
  return (await cloudflareEnv(cfg, env, w && realWrangler(w), console.log, Boolean(process.stdin.isTTY && process.stdout.isTTY))) ?? {};
}

/**
 * The Cloudflare login for plan, deploy and destroy, before the build: none, or a token Cloudflare
 * refuses, stops here in one line (#1170). Skipped when varlock brings the token from 1Password,
 * or with RUSTYBUNS_NO_LOGIN_CHECK=1 (tests with a stub alchemy).
 */
async function cloudflareLogin(cfg: RustyBunsConfig, args: string[]): Promise<Record<string, string>> {
  const env = alchemyBaseEnv({}, cfg);
  const cf = await wranglerLogin(cfg, env);
  const varlocked = !!cfg.experimental?.wheel && existsSync(ENV_SCHEMA) && /\bCLOUDFLARE_API_(TOKEN|KEY)\b/.test(readFileSync(ENV_SCHEMA, "utf8"));
  // `--profile <name>` picks Alchemy's profile over ALCHEMY_PROFILE.
  const profile = flag(args, "profile");
  const problem = varlocked || env.RUSTYBUNS_NO_LOGIN_CHECK ? null
    : await cloudflareProblem({ ...env, ...cf, ...(profile ? { ALCHEMY_PROFILE: profile } : {}) }, realTokenCheck);
  if (problem) throw new Error(problem);
  return cf;
}

/**
 * Alchemy checks npm once a day and says to `pnpm add` a newer one, but `add deploy` pins it (DEPLOY_DEPS)
 * on purpose. A fresh check with no versions in its cache (.alchemy/version-check.json) keeps it quiet.
 */
function quietUpgradeNotice() {
  try {
    mkdirSync(".alchemy", { recursive: true });
    writeFileSync(join(".alchemy", "version-check.json"), JSON.stringify({ checkedAt: Date.now(), distTags: {} }));
  } catch { /* only a notice */ }
}

/** The alchemy command line and its env: Cloudflare login through wrangler (`cf` when already done), varlock for op secrets. */
async function alchemyCommand(args: string[], cfg?: RustyBunsConfig, extra: Record<string, string> = {}, cf?: Record<string, string>) {
  let cmd = [...alchemyCli(), ...args];
  const env = alchemyBaseEnv(extra, cfg);
  if (cfg?.targets.edge) {
    Object.assign(env, cf ?? await wranglerLogin(cfg, env));
    cloudflareToken = env.CLOUDFLARE_API_TOKEN;
  }
  if (cfg?.experimental?.wheel && existsSync(ENV_SCHEMA)) cmd = underVarlock(cfg, cmd, env);
  quietUpgradeNotice();
  return { cmd, env };
}

/**
 * Type check the generated stack before Alchemy sees it, so a bad config fails
 * here (in well under a second with bun check) instead of halfway into a plan.
 */
async function checkStack(prof: Profiler, want: CheckerName | "auto") {
  await Bun.write(STACK_TSCONFIG, stackTsconfig());
  const c = pickChecker(want, STACK_TSCONFIG);
  if (!c) { prof.steps.push({ name: "typecheck stack", ms: 0, note: `skipped: no checker (Bun >= ${BUN_CHECK_MIN}, tsc-rs or typescript)` }); return; }
  const r = await prof.step("typecheck stack", () => runCheck(c, STACK_TSCONFIG), c.name);
  if (!r.ok) {
    console.error(compactDiagnostics(r.output));
    await prof.finish();
    // Not the config's fault: Alchemy and Effect aren't installed yet.
    if (/Cannot find module '(alchemy|effect)[/']/.test(r.output)) throw new Error(`Alchemy and Effect aren't installed here. Run \`${infer().execCmd("rustybuns add deploy")}\`, then plan again.`);
    throw new Error(`the generated stack does not type check (${c.name}). Fix rustybuns.config.ts, or pass --no-check to skip.`);
  }
}

/**
 * GUARDRAIL (#363): worktrees share one Alchemy state, so a deploy from a stale
 * branch undoes whatever main added since. A live deploy (targets.edge.adopt)
 * from a HEAD behind origin/main is refused without --force; any deploy that
 * deletes a data-holding resource is refused without --allow-delete. `plan`
 * prints the same findings as warnings.
 */
function guardDeploy(sub: string, cfg: RustyBunsConfig, stage: string, waive: { force: boolean; allowDelete: boolean }) {
  const problems: string[] = [];
  const behind = cfg.targets.edge?.adopt && !waive.force ? commitsBehindMain(process.cwd()) : null;
  if (behind) problems.push(`HEAD is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main, and this is a live site (targets.edge.adopt): ` +
    `deploying would roll back what main shipped since. Rebase on origin/main first, or pass --force.`);
  const stray = waive.force ? null : strayState(process.cwd(), cfg.name, stage);
  if (stray) problems.push(`stage ${stage}'s Alchemy state is under the app name "${stray}", not "${cfg.name}": deploying would make every resource again. ` +
    `Move .alchemy/state/${stray} to .alchemy/state/${cfg.name} first, or pass --force.`);
  const deletes = waive.allowDelete ? [] : statefulDeletes(process.cwd(), cfg, stage, readFileSync(".rustybuns/alchemy.run.ts", "utf8"));
  if (deletes.length) problems.push(`this deploy would delete ${deletes.join(", ")}, and the data in ${deletes.length === 1 ? "it" : "them"}. ` +
    `If ${deletes.length === 1 ? "it was" : "they were"} added on a branch this one lacks, rebase first; to delete on purpose, pass --allow-delete.`);
  if (!problems.length) return;
  if (sub === "plan") { console.log(problems.map((p) => "warning: " + p).join("\n") + "\n"); return; }
  throw new DeployRefused({ message: problems.join("\n") });
}

/** Edge is on when asked for, or when nothing else is (as in gen/alchemy.ts). */
const edgeOn = (c: RustyBunsConfig) => !!c.targets.edge || !c.targets.box;

/**
 * Run the Worker's build command in the app, with the env the stack's Build gets, minus the deploy's logins.
 * sandbox: HOME is .rustybuns/home, empty but for what the build leaves there, with the package caches kept (#1128).
 */
const buildWorker = (build: string, sandbox: boolean) => Effect.gen(function* () {
  // a monorepo app's unbuilt workspace packages first (glue/workspace-build.ts)
  const command = [...workspacePrebuild(process.cwd()), build].join(" && ");
  console.log(`building the worker${sandbox ? " (empty HOME)" : ""}: ${command}`);
  let env = buildEnv({ ...readDevVars(), ...process.env });
  if (sandbox) {
    const home = join(process.cwd(), ".rustybuns/home");
    mkdirSync(home, { recursive: true });
    env = emptyHome(env, home);
  }
  const code = yield* spawnScoped(["sh", "-c", command], { stdio: ["inherit", "inherit", "inherit"], env });
  if (code !== 0) return yield* Effect.fail(new Error(`the worker build failed (exit ${code}): ${command}`));
});

/** Time an Effect as one profile step, as Profiler.step does a Promise. */
const timed = <A, E, R>(prof: Profiler, name: string, e: Effect.Effect<A, E, R>) => Effect.suspend(() => {
  const t = performance.now();
  return e.pipe(Effect.ensuring(Effect.sync(() => prof.steps.push({ name, ms: performance.now() - t }))));
});

/**
 * plan, deploy, destroy and dev, as one scope: the state lock and every child (the worker
 * build, alchemy) belong to it, so a signal or a failure stops the children and then frees
 * the lock, in that order (lifecycle.ts).
 */
const alchemy = (sub: string, rawArgs: string[]) => runScoped(Effect.gen(function* () {
  const stage = alchemyStage(rawArgs);
  const cfg = yield* step(() => loadConfig(stage));
  const servers = desktopServers(cfg.targets.desktop);
  const entries = servers.map((s) => s.entry).join(", ");
  // A Worker can't run a node:http server with files on disk: that's a port by hand, not a config line.
  const serverNote = servers.length ? ` Its own server (desktop.server, ${entries}) runs beside the desktop and box hosts only: a Worker can't run a Node server without porting it. Add targets.box to host it on a server.` : "";
  if (!cfg.worker && !cfg.targets.box) throw new Error(`desktop-only app: no edge or box stack to plan or deploy.${serverNote}`);
  const profiled = sub === "plan" || sub === "deploy";
  if (servers.length && cfg.worker && profiled) console.warn(`[server] the edge doesn't run desktop.server (${entries}): on the web ${servers.flatMap((s) => s.paths).join(", ")} reach the Worker, not that server.\n`);
  if (profiled) { checkBox(cfg); checkSpend(cfg); console.log(costReport(cfg) + "\n"); }
  const { on: check, checker, rest: flagged } = checkFlags(rawArgs, profiled);
  // Ours, not Alchemy's: they waive the guards below.
  const force = flagged.includes("--force"), allowDelete = flagged.includes("--allow-delete");
  const { on: sandbox, args } = wantsSandbox(flagged.filter((a) => a !== "--force" && a !== "--allow-delete"));
  const prof = new Profiler(sub);
  yield* step(() => prof.step("generate", () => generate({ adopt: false, stage })));
  let lockBase: string | null = null;
  if (cfg.state === "project") unlinkSharedState(process.cwd());
  else {
    const base = linkSharedState(process.cwd());
    if (base) { yield* Effect.acquireRelease(Effect.sync(() => lockState(base, sub)), (release) => Effect.sync(release)); lockBase = base; }
  }
  const note = profiled ? adoptNote(process.cwd(), cfg, stage) : null;
  if (note) console.log(note + "\n");
  if (profiled) guardDeploy(sub, cfg, stage, { force, allowDelete });
  if (check) yield* step(() => checkStack(prof, checker));
  const hash = yield* step(stackHash);
  const stampFile = ".rustybuns/planned";
  if (sub === "deploy" && !args.includes("--yes")) {
    // GUARDRAIL: deploy creates real resources. Require a plan for THIS exact
    // config first, so nobody provisions a stack they have not looked at.
    const planned = (yield* step(() => Bun.file(stampFile).exists())) ? (yield* step(() => Bun.file(stampFile).text())).trim() : null;
    if (planned !== hash) throw new DeployRefused({ message: planned
      ? "config changed since the last plan. Run `rustybuns plan` again, or pass --yes to skip."
      : "no plan on record for this config. Run `rustybuns plan` first (creates nothing), or pass --yes to skip." });
  }
  // Cloudflare's login before any build, so a missing or refused one costs a second, not a build (#1170).
  const cf = sub !== "dev" && edgeOn(cfg) ? yield* step(() => cloudflareLogin(cfg, args)) : undefined;
  // Hetzner.Service and Railway.Service hash the box directory at plan time, so it has to exist first.
  if (profiled && cfg.targets.box) {
    console.log(`built ${yield* step(() => prof.step("build box", () => buildBox(cfg)))}`);
  }
  // The Worker hashes (and uploads) its bundle from disk at plan time, before the
  // stack's Build runs, so build it first or it ships the previous build (#362).
  // dev builds first too: the stack's Build would run it inside alchemy, with the Cloudflare token (#1121).
  const built = (profiled || sub === "dev") && edgeOn(cfg) && !!cfg.worker?.build;
  if (built) yield* timed(prof, "build worker", buildWorker(cfg.worker!.build!, sandbox));
  // Name each map's module and give it app-relative sources, as wrangler does (#799).
  if (built && cfg.worker!.sourceMaps && cfg.worker!.builtMain) {
    const maps = tidySourceMaps(process.cwd(), cfg.worker!.builtMain);
    if (maps.length) console.log(`source maps ready to upload: ${maps.join(", ")}`);
  }
  // The stack's Build then only records dist, not rebuild it while the assets upload (#424).
  const buildEnv: Record<string, string> = built ? { RUSTYBUNS_BUILT: "1" } : {};
  // The lock names alchemy's pid too, so a SIGKILLed rustybuns doesn't free the state while it runs.
  const run = (a: string[]) => alchemyProcess(a, cfg, buildEnv, (pid) => lockBase && noteChild(lockBase, pid), cf);
  if (sub === "plan") {
    const code = yield* timed(prof, "alchemy plan", run(["plan", "--config", ".rustybuns/alchemy.run.ts", ...args]));
    yield* step(() => prof.finish());
    if (code !== 0) throw new AlchemyFailed({ sub, exitCode: code });
    yield* step(() => Bun.write(stampFile, hash));
    return;
  }
  // --yes satisfies our plan check above AND is forwarded to alchemy's own prompt.
  const code = yield* timed(prof, `alchemy ${sub}`, run([sub, "--config", ".rustybuns/alchemy.run.ts", ...args]));
  if (profiled) yield* step(() => prof.finish());
  if (code !== 0) throw new AlchemyFailed({ sub, exitCode: code });
  if (sub === "deploy" && edgeOn(cfg) && cfg.worker?.redactQueryStrings) yield* step(() => redactAfterDeploy(cfg, stage));
  if (sub === "deploy" && cfg.targets.box) console.log(cfg.targets.box.provider === "railway"
    ? "\nthe box bills by usage from now on (less while asleep); `rustybuns destroy` stops it."
    : "\nthe box bills hourly from now on; `rustybuns destroy` stops it.");
}));

/** worker.redactQueryStrings: the upload just reset it, so set it again (src/redact.ts). A miss warns; the deploy itself went out. */
async function redactAfterDeploy(cfg: RustyBunsConfig, stage: string) {
  const manual = "Deploy again with CLOUDFLARE_API_TOKEN set, or PATCH the Worker's script-settings with observability.redact_query_string: true.";
  const w = deployedWorker(process.cwd(), cfg.name, stage);
  if (!w || !cloudflareToken) {
    console.warn(`\nwarning: worker.redactQueryStrings: ${w ? "no Cloudflare API token (Alchemy used its own profile)" : `no Worker in the Alchemy state for stage ${stage}`}, so Workers Logs may keep query strings. ${manual}`);
    return;
  }
  try {
    const r = await redactQueryStrings({ ...w, token: cloudflareToken });
    console.log(r === "off" ? `\n${w.workerName} has no Workers Logs settings, so there are no query strings to redact.`
      : `\nWorkers Logs for ${w.workerName} keep URLs without their query strings${r === "already" ? " (already on)" : ""}.`);
  } catch (e) {
    console.warn(`\nwarning: worker.redactQueryStrings: ${(e as Error).message}. ${manual}`);
  }
}


/**
 * The deployed box `rustybuns <cmd>` talks to: its URL (--url, else the Alchemy state) and, when
 * `withSecret`, RB_PROF_SECRET. An op secret runs the command again under varlock, which fetches it.
 * `say` takes the notes, so --json keeps stdout to the JSON.
 */
async function boxTarget(cmd: string, args: string[], withSecret: boolean, say: (l: string) => void) {
  const cfg = await loadConfig();
  if (!cfg.targets.box) throw new Error(`rustybuns ${cmd} reads a box, and this config has no targets.box`);
  let secret: string | undefined;
  if (withSecret) {
    const env: Record<string, string | undefined> = { ...readDevVars(), ...process.env };
    const b = cfg.bindings?.[PROF_SECRET];
    if (!env[PROF_SECRET] && b?.type === "secret" && b.op && cfg.experimental?.wheel && existsSync(ENV_SCHEMA) && !env.RB_PROF_VARLOCK) {
      const p = Bun.spawn(underVarlock(cfg, [process.execPath, fileURLToPath(import.meta.url), cmd, ...args], env),
        { stdio: ["inherit", "inherit", "inherit"], env: { ...env, RB_PROF_VARLOCK: "1" } });
      process.exit(await p.exited);
    }
    secret = env[PROF_SECRET];
    const problem = secretProblem(cfg, secret);
    if (problem) throw new Error(problem);
  }
  const stage = alchemyStage(args);
  const url = flag(args, "url") ?? boxUrl(process.cwd(), cfg, stage);
  if (!url) throw new Error(`no box URL in the Alchemy state for stage ${stage}. Deploy first, or pass --url.`);
  if (withSecret && url.startsWith("http://")) say(`note: ${url} is plain HTTP, so the secret crosses the network unencrypted. Rotate it if that matters.`);
  return { cfg, url, secret: secret ?? "" };
}

/** `rustybuns prof`: sample the deployed box's CPU, save the .cpuprofile here and print its hottest frames. */
async function prof(args: string[]) {
  const json = args.includes("--json"), say = json ? console.error : console.log;
  const seconds = intFlag(args, "seconds", 1, 60, 10), top = intFlag(args, "top", 1, 1000, 10);
  const { cfg, url, secret } = await boxTarget("prof", args, true, say);
  say(`sampling ${url} for ${seconds}s...`);
  const file = await fetchProfile({ url, secret, seconds, outDir: join(".rustybuns", "prof"), name: cfg.name });
  const summary = summarizeProfile(JSON.parse(readFileSync(file, "utf8")), top);
  if (json) return console.log(JSON.stringify({ url, file, seconds, summary }, null, 2));
  console.log(`saved ${file}\n\n${formatProfileSummary(summary)}\n\nfor the flame graph, open it in Chrome DevTools > Performance (Load profile), or drop it on https://www.speedscope.app`);
}

/** `rustybuns mem`: the deployed box's memory, and how fast it's growing. */
async function memCommand(args: string[]) {
  const json = args.includes("--json");
  const { url } = await boxTarget("mem", args, false, console.error);
  const m = await fetchMem({ url });
  console.log(json ? JSON.stringify({ url, ...m }, null, 2) : `${url}: ${formatMemStats(m)}${m.boots ? `, ${m.boots} boot${m.boots === 1 ? "" : "s"}` : ""}`);
}

/** `rustybuns history`: the box's runs (one per boot) with their memory slope, profiles and ceiling restarts. */
async function historyCommand(args: string[]) {
  const json = args.includes("--json");
  const { url, secret } = await boxTarget("history", args, true, json ? console.error : console.log);
  const runs = await fetchHistory({ url, secret });
  const max = intFlag(args, "runs", 1, 1000, 5);
  console.log(json ? JSON.stringify({ url, runs: runs.slice(0, max) }, null, 2) : formatHistory(runs, max));
}

/** `rustybuns triage`: your coding agent, started on what went wrong with the facts of this project (triage.ts). */
async function triageCommand(args: string[]) {
  let cfg: RustyBunsConfig | null | { error: string } = null;
  if (await Bun.file("rustybuns.config.ts").exists()) {
    try { cfg = await loadConfig(); } catch (err) { cfg = { error: (err as Error).message }; }
  }
  const env: Record<string, string | undefined> = { ...readDevVars(), ...process.env };
  const context = await rustybunsContext({ cwd: process.cwd(), version: VERSION, cfg, stage: alchemyStage(args), env });
  const playbook = readFileSync(new URL("./triage/PLAYBOOK.md", import.meta.url), "utf8");
  process.exitCode = await triage({
    product: "RustyBuns", command: "rustybuns triage", dir: join(process.cwd(), ".rustybuns", "triage"), context, playbook,
    argv: args.filter((a, i) => !(a === "--stage" || a.startsWith("--stage=") || args[i - 1] === "--stage")),
  });
}

const COMMANDS = ["init", "copy-site", "jekyll", "generate", "adopt", "deploy", "destroy", "plan", "login", "dev", "prof", "mem", "history", "triage", "add", "run", "boundary", "build", "eject", "version"];
const isVersion = cmd === "--version" || cmd === "-v" || cmd === "version";
if (!isVersion && !checkDisabled()) {
  const advice = await checkVersion(VERSION);
  if (advice) console.error(`${advice}\n`);
}

try {
  switch (cmd) {
    case "init": await init(); break;   // --spa forces the desktop-only path
    case "copy-site": {
      const [from, to] = rest;
      if (!from || !to) throw new UsageError({ message: "usage: rustybuns copy-site <from> <to>" });
      copySite(from, to); break;
    }
    case "jekyll": jekyll(rest); break;
    case "generate": await generate({ adopt: false }); break;
    case "adopt": await generate({ adopt: true }); break;
    case "deploy": await alchemy("deploy", rest); break;
    case "destroy": await alchemy("destroy", rest); break;
    case "plan": await alchemy("plan", rest); break;
    case "login": {
      // Connect a provider account to an Alchemy profile (~/.alchemy, shared by every app).
      const [name, ...flags] = rest;
      const provider = PROVIDERS[(name ?? "").toLowerCase()];
      if (!provider) throw new Error(`usage: rustybuns login ${Object.keys(PROVIDERS).join("|")} [--profile <name>]`);
      const code = await runAlchemy(["profile", "edit", "--add", provider, ...flags]);
      if (code !== 0) process.exit(code);
      break;
    }
    case "dev": await alchemy("dev", rest); break;
    case "prof": await prof(rest); break;
    case "mem": await memCommand(rest); break;
    case "history": await historyCommand(rest); break;
    case "triage": await triageCommand(rest); break;
    case "add": {
      if (rest[0] === "deploy") { await addDeploy(rest.includes("--dry-run")); break; }
      if (rest[0] !== "desktop") throw new Error("usage: rustybuns add desktop [--entry <file>#<Component>] | add deploy [--dry-run]");
      await addDesktop(rest.slice(1)); break;
    }
    case "run": {
      if (rest[0] !== "desktop") throw new Error("usage: rustybuns run desktop [--watch] [--sandbox]");
      const { on: sandbox, args: hostArgs } = wantsSandbox(rest.slice(1).filter((a) => a !== "--watch"));
      if (rest.includes("--watch")) {
        const cfg = await loadConfig();
        await watchDesktop(cfg, () => buildDesktop(cfg, { noCompile: true }), hostArgs, sandbox);
      }
      if (!(await Bun.file(".rustybuns/dev/desktop.js").exists())) await buildDesktop(await loadConfig(), { noCompile: true });
      const p = Bun.spawn(hostCommand(".rustybuns/dev/desktop.js", hostArgs, { sandbox }), { stdio: ["inherit", "inherit", "inherit"], env: hostEnv(process.env) });
      process.exit(await p.exited);
    }
    case "boundary": { const { modules, excluded } = await boundary(); console.log(report(modules, excluded)); break; }
    case "build": {
      const [what, ...flags] = rest;
      const t = flags.indexOf("--target");
      if (what === "box") { console.log(`built ${await buildBox(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined })}`); break; }
      if (what !== "desktop") throw new Error("usage: rustybuns build desktop [--dev] [--check] [--checker bun|tsc-rs|tsc] [--target darwin-arm64] [--outfile dist/app-darwin-arm64] [--sign] [--notarize <profile>] | build box [--target linux-x64]");
      const { on: check, checker } = checkFlags(flags, false);
      const o = flags.indexOf("--outfile");
      const out = await buildDesktop(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined, outfile: o >= 0 ? flags[o + 1] : undefined, noCompile: flags.includes("--dev"), check: check ? checker : undefined, profile: true });
      console.log(`built ${out}`);
      const n = flags.indexOf("--notarize");
      if (flags.includes("--sign") || n >= 0) {
        const cfg = await loadConfig();
        const zips = await signDarwin(out.split("\n"), { identifier: process.env.RB_SIGN_ID ?? `dev.rustybuns.${cfg.name}`, notarize: n >= 0 ? flags[n + 1] : undefined });
        if (zips.length) console.log(`notarized ${zips.join(", ")}`);
      }
      break;
    }
    case "eject": {
      await generate({ adopt: false });
      await $`cp .rustybuns/alchemy.run.ts ./alchemy.run.ts`;
      console.log("copied alchemy.run.ts to project root. Delete rustybuns.config.ts when ready; you own the stack now.");
      break;
    }
    case "--version": case "-v": case "version": {
      console.log(VERSION);
      // Always checks, even in CI: asking for the version is asking whether it is a good one.
      const advice = await checkVersion(VERSION, { force: true });
      if (advice) console.log(advice);
      break;
    }
    default:
      if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") {
        const near = closest(cmd, COMMANDS);
        throw new UsageError({ message: `unknown command ${JSON.stringify(cmd)}${near ? `; did you mean \`rustybuns ${near}\`?` : ""} (\`rustybuns help\` lists them)` });
      }
      console.log(`rustybuns ${VERSION}
Box and ship the web app you already have. A dev dependency, never in prod.

  init [--spa] [--force]     read package.json / vite.config / tsconfig / wrangler.*,
                             write rustybuns.config.ts + .rustybuns/alchemy.run.ts + wrangler.jsonc
                             (no wrangler, or --spa: desktop-only config + desktop/host.ts)
                             refuses to overwrite an existing config unless --force
                             a static site (index.html, Jekyll, Hugo, MkDocs) with no app:
                             its build output, on the desktop and as static files on Workers
  copy-site <from> <to>      a hand-written site's files into <to>, leaving out dotfiles and
                             Rusty Buns' own (the build init writes for plain HTML)
  jekyll <args>              jekyll <args> on Ruby 3+ (bundle exec with a Gemfile), else in a
                             ruby:3.3 Docker container (the build init writes for Jekyll)
  init --port-vite           Create React App / Vue CLI: port to Vite first, then init;
                             custom webpack: list what to port
  add desktop [--entry F#C]  scaffold packages/desktop (index.html, main.tsx, world.ts) and
                             vite.desktop.config.ts; keeps files that already exist
  add deploy [--dry-run]     install the pinned alchemy + effect set (and pnpm/npm overrides)
  boundary                   classify src/: client / action / server / leak, regenerate stubs + proxies
  generate                   regenerate .rustybuns/ from the config (safe to re-run)
  adopt [--force]            accept the generated wrangler.jsonc over a hand-written one
                             (refuses if that would drop bindings/triggers/routes it cannot represent)

  build desktop [--dev]      --dev: vite build + bundle the host, no compile  ->  run desktop
             [--target T]    T = darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | windows-x64
                             (default: targets in the config; "all" cross-compiles TS-only builds)
             [--check]       type check the app (its tsconfig) before the vite build
             [--sign]        macOS: sign the darwin binaries with your keychain's Developer ID
                             (RB_SIGN_IDENTITY picks one), so Gatekeeper doesn't block them
             [--notarize P]  sign, then notarize a .zip of each with Apple, using the profile
                             from \`xcrun notarytool store-credentials P\`
  run desktop                start the dev host (bun .rustybuns/dev/desktop.js)
            [--watch]        rebuild (--dev) on save and restart the host; a failed build
                             keeps the old one up, and the window stays (reload it)
            [--sandbox]      macOS: run it under Seatbelt, kept out of ~/.ssh, ~/.aws, gh,
                             wrangler, keychains and the project's .env (or RB_SANDBOX=1).
                             Always: no .env load, no auto-install, no credential env vars
  build box [--target T]     the same host for the box: Hetzner gets a linux binary + node
                             launcher in .rustybuns/box/, Railway a Bun bundle + Dockerfile
                             in .rustybuns/railway/ (plan and deploy run this for you)

  login <provider>           connect cloudflare, hetzner or railway to your Alchemy profile
                             (~/.alchemy: browser login or a pasted token; every app shares it)
  plan                       alchemy plan: shows what would be created, creates nothing
                             (targets.edge -> Cloudflare, targets.box -> Hetzner or Railway, or both)
                             Cloudflare: wrangler's login, asked for only the scopes the bindings
                             need, when wrangler is installed; the Alchemy profile otherwise
                             type checks the generated stack first (--no-check skips)
  deploy [--yes]             alchemy deploy; refuses unless plan ran for this exact config
         [--force]           a live site (targets.edge.adopt) also refuses a HEAD behind
                             origin/main, or state left under the app's old name, unless --force
         [--allow-delete]    and any deploy refuses to delete (or rename, which replaces) a D1,
                             R2, KV, queue, container, volume or Durable Object class unless
                             --allow-delete
                             plan and deploy list the stack's billable resources first, and
                             refuse a large Hetzner server without box.allowLargeServer (COSTS.md)
  destroy                    alchemy destroy: removes everything the stack created
                             (--stage <name> passes through to all three)
  dev                        alchemy dev: workerd + local simulators for the edge column
                             plan, deploy and dev build the Worker without the deploy's logins;
         [--sandbox]         with an empty HOME too, package caches kept (or RB_SANDBOX=1)
  prof [--seconds N]         sample the deployed box's CPU for N seconds (default 10, at most 60),
       [--url U] [--json]    save a .cpuprofile in .rustybuns/prof/ (a flame graph in DevTools or
                             speedscope) and print its hottest functions (--json: as JSON);
                             needs a RB_PROF_SECRET secret binding (boxOnly: true)
  mem [--url U] [--json]     the deployed box's memory: RSS, heap, peak and the MB/h slope
  history [--runs N] [--json]
                             the box's runs, one per boot or deploy, newest first: memory slope,
                             profiles and ceiling restarts side by side (needs RB_PROF_SECRET)
  triage [--agent claude|codex] [--model M] [--print]
                             something wrong? start your coding agent on it, with this project's
                             facts (versions, config, the box and its memory) in .rustybuns/triage/
                             and a playbook: it asks what went wrong, digs in, and drafts the issue
  --checker bun|tsc-rs|tsc   pick the type checker (default: bun check on Bun >= 1.4.3 or its canary, else
                             tsc-rs, else tsc; tsc-rs first when tsconfig has the Effect plugin)
                             build desktop, plan and deploy print a per-step timing table and
                             save it to .rustybuns/profile/, with deltas against the last run
  eject                      copy alchemy.run.ts to the root; you own the stack from then on
  version                    print the version, and whether it is a known-bad release or out of date
                             (every command checks once a day and warns on a known-bad release)

  Env:  RB_NO_BROWSER=1      do not open a browser; print the token URL instead
        RB_BUN=<path>        a Bun with \`bun check\` to type check with (e.g. a canary)
        RUSTYBUNS_NO_UPDATE_CHECK=1  skip the daily version check (CI skips it too)
        RUSTYBUNS_STOP_GRACE_MS=<ms>  how long a stopped plan/deploy waits for Alchemy to exit (default 10000)
  Docs: README.md · GETTING_STARTED.md`);
  }
} catch (e) {
  const { text, code } = renderError(e);
  console.error(text);
  process.exit(code);
}
