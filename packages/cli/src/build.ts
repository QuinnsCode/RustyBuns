// rustybuns build desktop
//   1. run the app build (vite build)               -> dist/worker, dist/client
//   2. write .rustybuns/desktop.ts                   -> the Bun entry: shell + adapters + launcher
//   3. bun build --compile the entry, embedding dist  -> one executable
// Targets: current OS by default. Cross-OS is a CI matrix, not one machine.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import type { RustyBunsConfig } from "./config.ts";

export function desktopEntry(c: RustyBunsConfig): string {
  const dataDir = c.targets.desktop?.dataDir ?? `~/.${c.name}`;
  const bind: string[] = [];
  const dos: { name: string; className: string }[] = [];
  for (const [name, b] of Object.entries(c.bindings)) {
    switch (b.type) {
      case "d1": bind.push(`  ${name}: local.d1(${JSON.stringify(b.databaseName)}),`); break;
      case "kv": bind.push(`  ${name}: local.kv(${JSON.stringify(name)}),`); break;
      case "var": bind.push(`  ${name}: ${JSON.stringify(b.value)},`); break;
      case "secret": bind.push(`  ${name}: process.env[${JSON.stringify(name)}] ?? "",`); break;
      case "r2": bind.push(`  // ${name}: R2 -> directory adapter (slice 2)`); break;
      case "durable_object":
        if (b.scriptName) bind.push(`  // ${name}: DO in another script (${b.scriptName}) has no local twin`);
        else dos.push({ name, className: b.className });
        break;
    }
  }
  return `// GENERATED desktop entry. The RWSDK worker runs here, on the user's machine,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter } from "@rustybuns/shell-bun";
import worker, { ${dos.map((d) => d.className).join(", ")} } from ${JSON.stringify("../" + (c.worker.builtMain ?? c.worker.main))};
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(import.meta.dir, rel);
}

const dataDir = ${JSON.stringify(dataDir)}.replace(/^~/, homedir());
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);

const env: Record<string, unknown> = {
${bind.join("\n")}
};
// Durable Objects run in-process. Bound after env exists because a DO's
// constructor receives this same env (a DO can use DB, KV, other DOs).
${dos.map((d) => `env.${d.name} = local.durableObject(${d.className} as any, env, ${JSON.stringify(d.name)});`).join("\n")}

const token = mintToken();
const shell = serve<typeof env>({
  assets: assetDir(${JSON.stringify(c.worker.assets ? "../" + c.worker.assets : "")}),
  runWorkerFirst: ${JSON.stringify(c.worker.runWorkerFirst ?? [])},
  token,
  reporter: stdoutReporter,
});
shell.mount(worker as any, env);
console.log(\`[${c.name}] serving \${shell.url}\`);
await openBrowser({ url: shell.url, token, window: ${JSON.stringify(c.targets.desktop?.window ?? "app")} });
`;
}

export async function buildDesktop(c: RustyBunsConfig, opts: { target?: string; outfile?: string } = {}) {
  if (c.worker.build) await $`sh -c ${c.worker.build}`;
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/desktop.ts", desktopEntry(c));
  const out = opts.outfile ?? `dist/${c.name}${process.platform === "win32" ? ".exe" : ""}`;
  const args = [
    "build", "--compile", ".rustybuns/desktop.ts", "--outfile", out,
    ...(c.worker.assets ? ["--asset", c.worker.assets] : []),
    ...(opts.target ? ["--target", opts.target] : []),
  ];
  await $`bun ${args}`;
  return out;
}
