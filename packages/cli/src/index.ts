#!/usr/bin/env bun
// rustybuns: init | generate | deploy | dev | build desktop | eject

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { parseWrangler, wranglerToConfig } from "./wrangler.ts";
import { generateAlchemy } from "./gen/alchemy.ts";
import { generateWrangler } from "./gen/wrangler.ts";
import { buildDesktop } from "./build.ts";
import type { RustyBunsConfig } from "./config.ts";

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

async function init() {
  const src = (await Bun.file("wrangler.jsonc").exists()) ? "wrangler.jsonc"
    : (await Bun.file("wrangler.json").exists()) ? "wrangler.json"
    : (await Bun.file("wrangler.toml").exists()) ? "wrangler.toml" : null;
  if (!src) throw new Error("no wrangler.jsonc/json found. Init inside an RWSDK (or any Workers) app.");
  if (src.endsWith(".toml")) throw new Error("wrangler.toml: convert to wrangler.jsonc first (wrangler supports both).");
  const cfg = wranglerToConfig(parseWrangler(await Bun.file(src).text()));
  const body = `import { defineConfig } from "@rustybuns/cli/config";\n\nexport default defineConfig(${JSON.stringify(cfg, null, 2)});\n`;
  await Bun.write("rustybuns.config.ts", body);
  console.log(`wrote rustybuns.config.ts from ${src}`);
  await generate({ adopt: false });
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

async function alchemy(sub: string, args: string[]) {
  await generate({ adopt: false });
  await $`bunx alchemy ${sub} --config .rustybuns/alchemy.run.ts ${args}`;
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
    case "build": {
      const [what, ...flags] = rest;
      if (what !== "desktop") throw new Error("usage: rustybuns build desktop [--target bun-darwin-arm64]");
      const t = flags.indexOf("--target");
      const out = await buildDesktop(await loadConfig(), { target: t >= 0 ? flags[t + 1] : undefined });
      console.log(`built ${out}`);
      break;
    }
    case "eject": {
      await generate({ adopt: false });
      await $`cp .rustybuns/alchemy.run.ts ./alchemy.run.ts`;
      console.log("copied alchemy.run.ts to project root. Delete rustybuns.config.ts when ready; you own the stack now.");
      break;
    }
    default:
      console.log(`rustybuns <init|generate|adopt|plan|deploy|destroy|dev|build desktop|eject>`);
  }
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
