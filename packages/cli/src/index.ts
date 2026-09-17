#!/usr/bin/env bun
// rustybuns: init | generate | deploy | dev | build desktop | eject

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { parseWrangler, wranglerToConfig } from "./wrangler.ts";
import { generateAlchemy } from "./gen/alchemy.ts";
import { generateWrangler } from "./gen/wrangler.ts";
import { buildDesktop } from "./build.ts";
import type { RustyBunsConfig } from "./config.ts";
import { infer } from "./glue/infer.ts";
import { sourceLayout } from "./glue/source.ts";
import { analyze, report } from "./glue/boundary.ts";
import { generateBoundaryFiles, scaffoldDesktopPackage } from "./glue/desktop-scaffold.ts";
import { installCommand, applyOverrides, DEPLOY_DEPS } from "./glue/deploy-deps.ts";

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
  const pkgPath = "package.json";
  const pkg = await Bun.file(pkgPath).json();
  const { changed } = applyOverrides(pkg, inf.pm);
  const cmd = installCommand(inf.pm, await Bun.file("pnpm-workspace.yaml").exists());
  console.log(`pinned deploy deps: ${Object.entries(DEPLOY_DEPS).map(([n, v]) => `${n}@${v}`).join(", ")}`);
  if (dryRun) { console.log(`would write ${inf.pm === "pnpm" ? "pnpm.overrides" : "overrides"} to package.json and run:\n  ${cmd}`); return; }
  if (changed) { await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); console.log("wrote overrides to package.json"); }
  console.log(`$ ${cmd}`);
  await $`sh -c ${cmd}`;
  console.log(`\nnext: set a throwaway "name" in rustybuns.config.ts, then ${inf.execCmd("rustybuns plan")}`);
}

async function init() {
  const inf = infer();
  console.log(`detected: ${inf.framework} app "${inf.name}" (${inf.pm}${inf.hasReact ? ", react" : ""}${inf.hasThree ? ", three" : ""}${inf.hasPrisma ? ", prisma" : ""}${inf.hasBetterAuth ? ", better-auth" : ""})`);
  console.log(`source:   ${inf.srcDir}/ (${inf.srcDirSource}${Object.keys(inf.aliases).length ? `, aliases ${Object.entries(inf.aliases).map(([a, d]) => `${a}->${d}`).join(" ")}` : ""})`);
  if (inf.srcDirSource === "guess") console.log(`          not sure about that; set source: { dir, aliases } in rustybuns.config.ts if it's wrong`);
  const src = (await Bun.file("wrangler.jsonc").exists()) ? "wrangler.jsonc"
    : (await Bun.file("wrangler.json").exists()) ? "wrangler.json"
    : (await Bun.file("wrangler.toml").exists()) ? "wrangler.toml" : null;
  if (!src) throw new Error("no wrangler.jsonc/json found. Init inside an RWSDK (or any Workers) app.");
  if (src.endsWith(".toml")) throw new Error("wrangler.toml: convert to wrangler.jsonc first (wrangler supports both).");
  const cfg = wranglerToConfig(parseWrangler(await Bun.file(src).text()));
  // Fill desktop defaults from what the repo already has.
  const d = cfg.targets.desktop!;
  d.clientBuild = `${inf.execCmd("vite")} build --config vite.desktop.config.ts`;
  if (inf.scripts["desktop:client"]) d.clientBuild = inf.runCmd("desktop:client") + (inf.scripts["desktop:sync"] ? ` && ${inf.runCmd("desktop:sync")}` : "");
  const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  d.targets = [host as any];
  cfg.source = { dir: inf.srcDir, aliases: inf.aliases };
  cfg.source = { dir: inf.srcDir, aliases: inf.aliases };
  const body = `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`;
  await Bun.write("rustybuns.config.ts", body);
  console.log(`wrote rustybuns.config.ts from ${src}`);
  await generate({ adopt: false });
  const { modules } = await boundary();
  console.log(report(modules));
  console.log(`\nnext: rustybuns add desktop [--entry ./src/app/App.tsx#App]`);
}

async function generate(opts: { adopt: boolean }) {
  const cfg = await loadConfig();
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/alchemy.run.ts", generateAlchemy(cfg));
  console.log("wrote .rustybuns/alchemy.run.ts");
  const r = await writeIfChanged("wrangler.jsonc", generateWrangler(cfg), opts);
  if (r === "conflict") console.log("wrangler.jsonc is hand-written and differs; wrote wrangler.generated.jsonc. Diff it, then `rustybuns adopt`.");
  else console.log(`wrangler.jsonc ${r}`);
}

/** Hash of what would be deployed: the generated stack + the config. */
async function stackHash(): Promise<string> {
  const a = await Bun.file(".rustybuns/alchemy.run.ts").text();
  const c = await Bun.file("rustybuns.config.ts").text();
  return Bun.hash(a + "\n" + c).toString(16);
}

async function alchemy(sub: string, args: string[]) {
  await generate({ adopt: false });
  const hash = await stackHash();
  const stampFile = ".rustybuns/planned";
  if (sub === "plan") {
    await $`bunx alchemy plan --config .rustybuns/alchemy.run.ts ${args}`;
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
  await $`bunx alchemy ${sub} --config .rustybuns/alchemy.run.ts ${args.filter((a) => a !== "--yes")}`;
}

try {
  switch (cmd) {
    case "init": await init(); break;
    case "generate": await generate({ adopt: false }); break;
    case "adopt": await generate({ adopt: true }); break;
    case "deploy": await alchemy("deploy", rest); break;
    case "destroy": await alchemy("destroy", rest); break;
    case "plan": await alchemy("plan", rest); break;
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
      if (what !== "desktop") throw new Error("usage: rustybuns build desktop [--target bun-darwin-arm64]");
      const t = flags.indexOf("--target");
      const out = await buildDesktop(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined, noCompile: flags.includes("--dev") });
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

  init                       read package.json / vite.config / tsconfig / wrangler.*,
                             write rustybuns.config.ts + .rustybuns/alchemy.run.ts + wrangler.jsonc
  add desktop [--entry F#C]  scaffold packages/desktop (index.html, main.tsx, world.ts) and
                             vite.desktop.config.ts; keeps files that already exist
  add deploy [--dry-run]     install the pinned alchemy + effect set (and pnpm/npm overrides)
  boundary                   classify src/: client / action / server / leak, regenerate stubs + proxies
  generate                   regenerate .rustybuns/ from the config (safe to re-run)
  adopt                      accept the generated wrangler.jsonc over a hand-written one

  build desktop [--dev]      --dev: vite build + bundle the host, no compile  ->  run desktop
             [--target T]    T = darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | windows-x64
                             (default: targets in the config; "all" cross-compiles TS-only builds)
  run desktop                start the dev host (bun .rustybuns/dev/desktop.js)

  plan                       alchemy plan: shows what would be created, creates nothing
  deploy [--yes]             alchemy deploy; refuses unless plan ran for this exact config
  destroy                    alchemy destroy: removes everything the stack created
                             (--stage <name> passes through to all three)
  dev                        alchemy dev: workerd + local simulators for the edge column
  eject                      copy alchemy.run.ts to the root; you own the stack from then on

  Env:  RB_NO_BROWSER=1      do not open a browser; print the token URL instead
  Docs: README.md · GETTING_STARTED.md`);
  }
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
