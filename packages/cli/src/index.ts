#!/usr/bin/env bun
// rustybuns: init | generate | deploy | dev | build desktop | eject

import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseWrangler, parseWranglerToml, wranglerToConfig, droppedWranglerKeys } from "./wrangler.ts";
import { generateAlchemy } from "./gen/alchemy.ts";
import { generateWrangler } from "./gen/wrangler.ts";
import { buildDesktop } from "./build.ts";
import { buildBox } from "./box.ts";
import type { RustyBunsConfig } from "./config.ts";
import { infer, readPackageJson } from "./glue/infer.ts";
import { sourceLayout } from "./glue/source.ts";
import { analyze, report } from "./glue/boundary.ts";
import { generateBoundaryFiles, scaffoldDesktopPackage } from "./glue/desktop-scaffold.ts";
import { installCommand, applyOverrides, workspaceRoot, DEPLOY_DEPS } from "./glue/deploy-deps.ts";
import { Profiler } from "./profile.ts";
import { checkSpend, costReport } from "./costs.ts";
import { ENV_SCHEMA, generateEnvSchema, schemaNeeds } from "./wheel.ts";
import { BUN_CHECK_MIN, STACK_TSCONFIG, checkFlags, pickChecker, runCheck, stackTsconfig, type CheckerName } from "./typecheck.ts";

const [cmd, ...rest] = process.argv.slice(2);

async function loadConfig(): Promise<RustyBunsConfig> {
  const f = Bun.file("rustybuns.config.ts");
  if (!(await f.exists())) throw new Error("no rustybuns.config.ts; run `rustybuns init` first");
  return (await import(`${process.cwd()}/rustybuns.config.ts`)).default as RustyBunsConfig;
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
  const inf = infer();
  const spa = rest.includes("--spa");
  const src = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find((f) => existsSync(f)) ?? null;
  // Refuse before printing or writing anything.
  if (!inf.hasPackageJson) throw new Error("no package.json here. Run `rustybuns init` from your app's directory.");
  if (existsSync("rustybuns.config.ts") && !force) throw new Error("rustybuns.config.ts already exists; init would overwrite it. Edit it directly, or pass --force to regenerate from scratch.");
  if (inf.isWorkspaceRoot && !src && !inf.vite.configPath && inf.framework === "unknown")
    throw new Error("this looks like a monorepo root (workspaces, no app here). cd into the package you want to ship and run init there.");
  if (inf.framework === "unknown" && !src && !force)
    throw new Error("no vite or rwsdk dependency in package.json, so this does not look like a web app Rusty Buns can box. Pass --force to write a config anyway.");
  console.log(`rustybuns ${(await Bun.file(new URL("../package.json", import.meta.url)).json()).version}`);
  console.log(`detected: ${inf.framework} app "${inf.name}" (${inf.pm}${inf.hasReact ? ", react" : ""}${inf.hasThree ? ", three" : ""}${inf.hasPrisma ? ", prisma" : ""}${inf.hasBetterAuth ? ", better-auth" : ""})`);
  console.log(`source:   ${inf.srcDir}/ (${inf.srcDirSource}${Object.keys(inf.aliases).length ? `, aliases ${Object.entries(inf.aliases).map(([a, d]) => `${a}->${d}`).join(" ")}` : ""})`);
  if (inf.srcDirSource === "guess") {
    console.log(inf.srcDir === "."
      ? `          no src/, app/, lib/, client/ or web/ found, so the whole project root is treated as source.\n          set source: { dir, aliases } in rustybuns.config.ts before running add desktop`
      : `          not sure about that; set source: { dir, aliases } in rustybuns.config.ts if it's wrong`);
  }
  if (!src || spa) {
    if (src && spa) console.log(`ignoring ${src} (--spa): desktop-only config. Remove the flag to carry its bindings over.`);
    await initSpa(inf); return;
  }
  const wsrc = await Bun.file(src).text();
  const w = src.endsWith(".toml") ? parseWranglerToml(wsrc) : parseWrangler(wsrc);
  const dropped = droppedWranglerKeys(w);
  if (dropped.length) console.log(`not carried over: ${dropped.join(", ")}\n          (bindings, triggers, routes and env.* are not in rustybuns.config.ts yet; keep them in ${src} and do NOT run \`rustybuns adopt\`)`);
  const cfg = wranglerToConfig(w, inf.scripts);
  if (!existsSync(cfg.worker!.main)) console.log(`warning:  worker entry "${cfg.worker!.main}" ${w.main ? "(wrangler main)" : "(wrangler has no main; assumed)"} does not exist`);
  { const { inferWorkerBuild } = await import("./glue/build-script.ts"); const b = inferWorkerBuild(inf.scripts); console.log(`build:    ${b.build}  (${b.from === "default" ? "no build/release/deploy script found; using the default" : `from "${b.from}" script`})`); }
  // D1: wrangler's own default migrations dir is ./migrations when migrations_dir is unset.
  for (const b of Object.values(cfg.bindings)) {
    if (b.type === "d1" && !b.migrationsDir && existsSync("migrations")) b.migrationsDir = "migrations";
  }
  // Built worker entry: rwsdk 1.x emits dist/worker/index.js, 0.x emitted dist/worker/worker.js.
  {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const rw = String({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }["rwsdk"] ?? "");
    const major = Number(rw.replace(/^[^0-9]*/, "").split(".")[0]);
    if (major >= 1) cfg.worker!.builtMain = "dist/worker/index.js";
  }
  // Secrets: names only, from .dev.vars. Values are read from .dev.vars at deploy time.
  const secrets = Object.keys(readDevVars()).filter((k) => !cfg.bindings[k]);
  for (const k of secrets) cfg.bindings[k] = { type: "secret" };
  if (secrets.length) console.log(`secrets:  ${secrets.join(" ")}  (names from .dev.vars)`);
  // Desktop client build: always the vite.desktop.config.ts that `add desktop` generates.
  // Never the app's own scripts: they can point at files Rusty Buns doesn't own.
  const d = cfg.targets.desktop!;
  d.clientBuild = `${inf.execCmd("vite")} build --config vite.desktop.config.ts`;
  const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  d.targets = [host as any];
  console.log(`desktop:  building for ${host} only; add other targets in rustybuns.config.ts`);
  cfg.source = { dir: inf.srcDir, aliases: inf.aliases };
  const body = `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`;
  await Bun.write("rustybuns.config.ts", body);
  console.log(`wrote rustybuns.config.ts from ${src}`);
  {
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
  await generate({ adopt: false });
  const { modules } = await boundary();
  console.log(report(modules));
  console.log(`\nnext: rustybuns add desktop [--entry ./src/app/App.tsx#App]`);
}

/**
 * No wrangler: a plain Vite SPA. The desktop target is the whole story:
 * your `vite build` output, served by the Bun host, plus an optional host
 * module for the backend routes the app needs (files, native, exports).
 */
async function initSpa(inf: ReturnType<typeof infer>) {
  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const cfg = {
    name: inf.name.replace(/^@[^/]+\//, ""),
    source: { dir: inf.srcDir, aliases: inf.aliases },
    bindings: {},
    targets: {
      desktop: {
        mode: "spa",
        // dist/ holds the binaries; the UI gets its own folder inside it.
        clientBuild: `${inf.execCmd("vite")} build --outDir dist/ui --emptyOutDir`,
        clientDir: "dist/ui",
        world: false,
        host: "desktop/host.ts",
        targets: [hostTag],
      },
    },
  };
  await Bun.write("rustybuns.config.ts", `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`);
  console.log("wrote rustybuns.config.ts (desktop-only: no wrangler found)");
  if (!(await Bun.file("desktop/host.ts").exists())) {
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
  console.log(`\nnext: ${inf.execCmd("rustybuns build desktop --dev")} && ${inf.execCmd("rustybuns run desktop")}`);
}

/** Keys in a hand-written wrangler file that the generated one cannot reproduce. */
function wranglerLosses(): string[] {
  const f = ["wrangler.jsonc", "wrangler.json"].find((x) => existsSync(x));
  if (!f) return [];
  try { return droppedWranglerKeys(parseWrangler(readFileSync(f, "utf8"))); } catch { return []; }
}

async function generate(opts: { adopt: boolean }) {
  const cfg = await loadConfig();
  if (!cfg.worker && !cfg.targets.box) { console.log("desktop-only config: nothing to generate for the edge"); return; }
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/alchemy.run.ts", generateAlchemy(cfg));
  console.log("wrote .rustybuns/alchemy.run.ts");
  await writeEnvSchema(cfg);
  if (!cfg.worker) return;   // box-only: no wrangler.jsonc
  if (opts.adopt && !rest.includes("--force")) {
    const lost = wranglerLosses();
    if (lost.length) throw new Error(`adopt would delete from wrangler.jsonc: ${lost.join(", ")}. Move those into the config first, or pass --force.`);
  }
  const r = await writeIfChanged("wrangler.jsonc", generateWrangler(cfg), opts);
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

/** varlock from the project, the workspace root, or PATH. */
function varlockCli(): string {
  const root = workspaceRoot(process.cwd());
  const found = [join("node_modules", ".bin", "varlock"), root && join(root, "node_modules", ".bin", "varlock")]
    .find((p) => p && existsSync(p)) || Bun.which("varlock");
  if (!found) throw new Error("experimental.wheel: op secrets are fetched by varlock, which isn't installed. `bun add -d varlock`, or `brew install dmno-dev/tap/varlock`.");
  return found;
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
  return [varlockCli(), "run", "--path", ENV_SCHEMA, "--", ...cmd];
}

/** Run the project-local alchemy with the terminal attached, so its prompts work. */
async function runAlchemy(args: string[], cfg?: RustyBunsConfig): Promise<number> {
  let cmd = [...alchemyCli(), ...args];
  // Secret values come from .dev.vars; anything already exported in the shell wins.
  const env: Record<string, string | undefined> = { ...readDevVars(), ...process.env };
  if (cfg?.experimental?.wheel && existsSync(ENV_SCHEMA)) cmd = underVarlock(cfg, cmd, env);
  const p = Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"], env });
  return await p.exited;
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
    console.error(r.output);
    await prof.finish();
    throw new Error(`the generated stack does not type check (${c.name}). Fix rustybuns.config.ts, or pass --no-check to skip.`);
  }
}

async function alchemy(sub: string, rawArgs: string[]) {
  const cfg = await loadConfig();
  if (!cfg.worker && !cfg.targets.box) throw new Error("desktop-only app: no edge or box stack to plan or deploy");
  const profiled = sub === "plan" || sub === "deploy";
  if (profiled) { checkSpend(cfg); console.log(costReport(cfg) + "\n"); }
  const { on: check, checker, rest: args } = checkFlags(rawArgs, profiled);
  const prof = new Profiler(sub);
  await prof.step("generate", () => generate({ adopt: false }));
  // Hetzner.Service and Railway.Service hash the box directory at plan time, so it has to exist first.
  if (profiled && cfg.targets.box) {
    console.log(`built ${await prof.step("build box", () => buildBox(cfg))}`);
  }
  if (check) await checkStack(prof, checker);
  const hash = await stackHash();
  const stampFile = ".rustybuns/planned";
  if (sub === "plan") {
    const code = await prof.step("alchemy plan", () => runAlchemy(["plan", "--config", ".rustybuns/alchemy.run.ts", ...args], cfg));
    await prof.finish();
    if (code !== 0) process.exit(code);
    await Bun.write(stampFile, hash);
    return;
  }
  if (sub === "deploy" && !args.includes("--yes")) {
    // GUARDRAIL: deploy creates real resources. Require a plan for THIS exact
    // config first, so nobody provisions a stack they have not looked at.
    const planned = (await Bun.file(stampFile).exists()) ? (await Bun.file(stampFile).text()).trim() : null;
    if (planned !== hash) {
      console.error(planned
        ? "config changed since the last plan. Run `rustybuns plan` again, or pass --yes to skip."
        : "no plan on record for this config. Run `rustybuns plan` first (creates nothing), or pass --yes to skip.");
      process.exit(2);
    }
  }
  // --yes satisfies our plan check above AND is forwarded to alchemy's own prompt.
  const code = await prof.step(`alchemy ${sub}`, () => runAlchemy([sub, "--config", ".rustybuns/alchemy.run.ts", ...args], cfg));
  if (profiled) await prof.finish();
  if (code !== 0) process.exit(code);
  if (sub === "deploy" && cfg.targets.box) console.log(cfg.targets.box.provider === "railway"
    ? "\nthe box bills by usage from now on (less while asleep); `rustybuns destroy` stops it."
    : "\nthe box bills hourly from now on; `rustybuns destroy` stops it.");
}

try {
  switch (cmd) {
    case "init": await init(); break;   // --spa forces the desktop-only path
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
    case "add": {
      if (rest[0] === "deploy") { await addDeploy(rest.includes("--dry-run")); break; }
      if (rest[0] !== "desktop") throw new Error("usage: rustybuns add desktop [--entry <file>#<Component>] | add deploy [--dry-run]");
      await addDesktop(rest.slice(1)); break;
    }
    case "run": {
      if (rest[0] !== "desktop") throw new Error("usage: rustybuns run desktop");
      if (!(await Bun.file(".rustybuns/dev/desktop.js").exists())) await buildDesktop(await loadConfig(), { noCompile: true });
      const p = Bun.spawn(["bun", ".rustybuns/dev/desktop.js", ...rest.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
      process.exit(await p.exited);
    }
    case "boundary": { const { modules, excluded } = await boundary(); console.log(report(modules, excluded)); break; }
    case "build": {
      const [what, ...flags] = rest;
      const t = flags.indexOf("--target");
      if (what === "box") { console.log(`built ${await buildBox(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined })}`); break; }
      if (what !== "desktop") throw new Error("usage: rustybuns build desktop [--dev] [--check] [--checker bun|tsc-rs|tsc] [--target darwin-arm64] | build box [--target linux-x64]");
      const { on: check, checker } = checkFlags(flags, false);
      const out = await buildDesktop(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined, noCompile: flags.includes("--dev"), check: check ? checker : undefined, profile: true });
      console.log(`built ${out}`);
      break;
    }
    case "eject": {
      await generate({ adopt: false });
      await $`cp .rustybuns/alchemy.run.ts ./alchemy.run.ts`;
      console.log("copied alchemy.run.ts to project root. Delete rustybuns.config.ts when ready; you own the stack now.");
      break;
    }
    case "--version": case "-v": case "version": {
      console.log((await Bun.file(new URL("../package.json", import.meta.url)).json()).version); break;
    }
    default:
      console.log(`rustybuns ${(await Bun.file(new URL("../package.json", import.meta.url)).json()).version}
Box and ship the web app you already have. A dev dependency, never in prod.

  init [--spa] [--force]     read package.json / vite.config / tsconfig / wrangler.*,
                             write rustybuns.config.ts + .rustybuns/alchemy.run.ts + wrangler.jsonc
                             (no wrangler, or --spa: desktop-only config + desktop/host.ts)
                             refuses to overwrite an existing config unless --force
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
  run desktop                start the dev host (bun .rustybuns/dev/desktop.js)
  build box [--target T]     the same host for the box: Hetzner gets a linux binary + node
                             launcher in .rustybuns/box/, Railway a Bun bundle + Dockerfile
                             in .rustybuns/railway/ (plan and deploy run this for you)

  login <provider>           connect cloudflare, hetzner or railway to your Alchemy profile
                             (~/.alchemy: browser login or a pasted token; every app shares it)
  plan                       alchemy plan: shows what would be created, creates nothing
                             (targets.edge -> Cloudflare, targets.box -> Hetzner or Railway, or both)
                             type checks the generated stack first (--no-check skips)
  deploy [--yes]             alchemy deploy; refuses unless plan ran for this exact config
                             plan and deploy list the stack's billable resources first, and
                             refuse a large Hetzner server without box.allowLargeServer (COSTS.md)
  destroy                    alchemy destroy: removes everything the stack created
                             (--stage <name> passes through to all three)
  dev                        alchemy dev: workerd + local simulators for the edge column
  --checker bun|tsc-rs|tsc   pick the type checker (default: bun check on Bun >= 1.4.3 or its canary, else
                             tsc-rs, else tsc; tsc-rs first when tsconfig has the Effect plugin)
                             build desktop, plan and deploy print a per-step timing table and
                             save it to .rustybuns/profile/, with deltas against the last run
  eject                      copy alchemy.run.ts to the root; you own the stack from then on

  Env:  RB_NO_BROWSER=1      do not open a browser; print the token URL instead
        RB_BUN=<path>        a Bun with \`bun check\` to type check with (e.g. a canary)
  Docs: README.md · GETTING_STARTED.md`);
  }
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
