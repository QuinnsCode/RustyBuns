// rustybuns build desktop
//   1. run the app build (vite build)               -> dist/worker, dist/client
//   2. write .rustybuns/desktop.ts                   -> the Bun entry: shell + adapters + launcher
//   3. bun build --compile the entry, embedding dist  -> one executable
// Targets: current OS by default. Cross-OS is a CI matrix, not one machine.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DesktopOs, RustyBunsConfig } from "./config.ts";
import { basename } from "node:path";

const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".jsx"];

/** Resolve like a bundler: exact file, file+ext, or a directory's index / package.json main. Never a bare directory. */
export function resolveFileOrDir(base: string): string | null {
  const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
  if (isFile(base)) return base;
  for (const e of EXTS) if (isFile(base + e)) return base + e;
  try {
    if (statSync(base).isDirectory()) {
      const pkg = join(base, "package.json");
      if (isFile(pkg)) {
        try {
          const j = JSON.parse(readFileSync(pkg, "utf8"));
          const main = typeof j.exports === "string" ? j.exports
            : j.exports?.["."]?.import ?? j.exports?.["."]?.default ?? j.exports?.["."] ?? j.module ?? j.main;
          if (typeof main === "string") { const m = resolveFileOrDir(join(base, main)); if (m) return m; }
        } catch {}
      }
      for (const e of EXTS) if (isFile(join(base, "index" + e))) return join(base, "index" + e);
      // Prisma 6 "prisma-client" generator emits client.ts; older ones index.js (handled above)
      if (isFile(join(base, "client.ts"))) return join(base, "client.ts");
    }
  } catch {}
  return null;
}

const ALL_OS: DesktopOs[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];

/** spa mode: your Vite SPA + your world class. No worker, no RSC, no shims. */
export function spaEntry(c: RustyBunsConfig): string {
  const d = c.targets.desktop ?? {};
  const dataDir = d.dataDir ?? `~/.${c.name}`;
  const worldPath = d.worldPath ?? "/ws";
  const clientDir = d.clientDir ?? "dist/desktop";
  const identity = {
    "X-User-Id": "local",
    "X-User-Name": "${process.env.USER ?? process.env.USERNAME ?? \"wanderer\"}",
    "X-World-Slug": "local",
    "X-World-Owner": "local",
    ...(d.identity ?? {}),
  };
  const kvNames = Object.entries(c.bindings).filter(([, b]) => b.type === "kv").map(([n]) => n);
  const d1s = Object.entries(c.bindings).filter(([, b]) => b.type === "d1").map(([n, b]) => [n, (b as any).databaseName as string, (b as any).migrationsDir as string | undefined] as const);
  const vars = Object.entries(c.bindings).filter(([, b]) => b.type === "var").map(([n, b]) => [n, (b as any).value as string]);
  const r2s = Object.entries(c.bindings).filter(([, b]) => b.type === "r2").map(([n, b]) => [n, (b as any).bucketName as string] as const);
  const mounts = d.mounts ?? {};
  return `// GENERATED desktop host (spa mode). Serves the SPA, runs the world in-process
// as a Durable Object with sqlite storage, vouches the local identity at ${worldPath}.
// Replaces desktop_host.ts + desktop_gen_embed.ts.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter, applyD1Migrations } from "@rustybuns/shell-bun";
import World from ${JSON.stringify("../" + (d.world ?? "packages/desktop/world.ts"))};
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join, isAbsolute } from "node:path";

declare const RB_VERSION: string;
const dataDir = ${JSON.stringify(dataDir)}.replace(/^~/, homedir());
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);

// Compiled: --asset embeds a dir at /$bunfs/root/<basename>. Dev: the working tree.
function resolveDir(rel: string): string {
  // A mount under ~ or an absolute path is the user's own directory: read it
  // where it lives, never embedded, so its contents can change after the build.
  if (rel.startsWith("~")) return rel.replace(/^~/, homedir());
  if (isAbsolute(rel)) return rel;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}
const clientDir = resolveDir(${JSON.stringify(clientDir)});
const mounts: Record<string, string> = {
${Object.entries(mounts).map(([route, dir]) => `  ${JSON.stringify(route)}: resolveDir(${JSON.stringify(dir)}),`).join("\n")}
};

// What the world sees as env. KV and D1 are real sqlite; vars are baked;
// anything with no local twin (pipelines, R2) is a no-op reporter.
const env: Record<string, unknown> = {
${kvNames.map((n) => `  ${n}: local.kv(${JSON.stringify(n)}),`).join("\n")}
${d1s.map(([n, db]) => `  ${n}: local.d1(${JSON.stringify(db)}),`).join("\n")}
${vars.map(([n, v]) => `  ${n}: ${JSON.stringify(v)},`).join("\n")}
${r2s.map(([n, bucket]) => { const dir = d.r2?.[n]; return `  ${n}: local.r2(${JSON.stringify(bucket)}${dir ? `, resolveDir(${JSON.stringify(dir)})` : ""}),`; }).join("\n")}
  LOG_PIPELINE: { send: async () => {} },
  LOG_COLDSTORE_PIPELINE: { send: async () => {} },
};
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.
${d1s.filter(([, , m]) => m).map(([n, , m]) => `for (const f of await applyD1Migrations(env.${n} as any, existsSync(join(import.meta.dir, ${JSON.stringify(basename(m!))})) ? join(import.meta.dir, ${JSON.stringify(basename(m!))}) : join(process.cwd(), ${JSON.stringify(m)}))) console.log("[migrate] " + f);`).join("\n")}
const WORLD = local.durableObject(World as any, env, "WORLD", { codec: ${JSON.stringify((c.targets.desktop as any)?.storageCodec ?? "json")} });
const identity: Record<string, string> = {
${Object.entries(identity).map(([k, v]) => `  ${JSON.stringify(k)}: \`${v}\`,`).join("\n")}
};
// Actions and db modules imported through the cloudflare:workers / rwsdk/worker
// shims read these. Set before the action table is touched.
globalThis.__RB_ENV = env;
globalThis.__RB_IDENTITY = identity;
const { actions } = await import("./actions.ts");

const token = mintToken();
const shell = serve<Record<string, unknown>>({ assets: clientDir, mounts, token, reporter: stdoutReporter });

// The host IS the middleware: one local player, vouched at the upgrade,
// exactly the headers the CF shell reads.
shell.mount({
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === ${JSON.stringify(worldPath)}) {
      const h = new Headers(req.headers);
      for (const [k, v] of Object.entries(identity)) h.set(k, v);
      return WORLD.get(WORLD.idFromName("local")).fetch(new Request(req.url, { headers: h }));
    }
    if (url.pathname === "/__rb/info") {
      return Response.json({ app: ${JSON.stringify(c.name)}, version: typeof RB_VERSION === "string" ? RB_VERSION : "dev", bun: Bun.version,
        platform: \`\${process.platform}-\${process.arch}\`, dataDir, user: identity["X-User-Id"], actions: Object.keys(actions).length,
        bindings: Object.keys(env), caps: { sab: true, ffi: true, fs: true } });
    }
    if (url.pathname === "/__rb/action" && req.method === "POST") {
      // "use server" runs here, for real, against sqlite. Same code as the edge.
      const { module, fn, args } = await req.json() as { module: string; fn: string; args: unknown[] };
      const f = actions[module]?.[fn];
      if (!f) return new Response(\`no action \${module}#\${fn}\`, { status: 404 });
      try { return Response.json((await f(...args)) ?? null); }
      catch (err) { stdoutReporter.escaped("action", err, { module, fn }); return new Response(String((err as Error).message ?? err), { status: 500 }); }
    }
    return new Response("not found", { status: 404 });
  },
}, env);

console.log(\`[${c.name} \${typeof RB_VERSION === "string" ? RB_VERSION : "dev"}] serving \${shell.url}\`);
await openBrowser({ url: shell.url, token, window: ${JSON.stringify(d.window ?? "app")} });
`;
}


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
import { basename, join, isAbsolute } from "node:path";

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

import { sourceLayout } from "./glue/source.ts";
import { analyze } from "./glue/boundary.ts";
import { generateBoundaryFiles } from "./glue/desktop-scaffold.ts";

// Rust cdylibs from native/dist/<crate>/<os>-<arch>/ ride inside the binary at
// /$bunfs/root/native/<crate>/<os>-<arch>/, where @rustybuns/native looks.
// Only the platforms being built are staged, so each binary carries its own lib.
export const NATIVE_STAGE = ".rustybuns/native";
async function stageNative(targets: DesktopOs[]): Promise<string[]> {
  const { rm, cp, readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  await rm(NATIVE_STAGE, { recursive: true, force: true });
  if (!existsSync("native/dist")) {
    console.warn("[native] native/Cargo.toml exists but native/dist is empty: the binary will take the TS path. Build the cdylib first.");
    return [];
  }
  const staged: string[] = [];
  for (const crate of await readdir("native/dist")) {
    for (const t of targets) {
      const nodeTag = t.replace(/^windows-/, "win32-");   // DesktopOs -> process.platform-arch
      const src = join("native/dist", crate, nodeTag);
      if (!existsSync(src)) { console.warn(`[native] ${crate}: no build for ${nodeTag}; that binary takes the TS path.`); continue; }
      await cp(src, join(NATIVE_STAGE, crate, nodeTag), { recursive: true });
      staged.push(`${crate}/${nodeTag}`);
    }
  }
  if (staged.length) console.log(`[native] embedding ${staged.join(", ")}`);
  return staged;
}

export async function buildDesktop(c: RustyBunsConfig, opts: { target?: string; outfile?: string; noCompile?: boolean } = {}) {
  const d = c.targets.desktop ?? {};
  const src = sourceLayout(process.cwd(), c);
  {
    // Boundary glue is regenerated on every build: stubs, action proxies, host table.
    const { modules } = analyze({ srcDir: src.dir, aliases: src.aliases, ignore: src.ignore });
    await generateBoundaryFiles(process.cwd(), src.inf, modules, { actions: d.actions });
  }
  const mode = d.mode ?? "spa";
  const build = mode === "spa" ? d.clientBuild : c.worker.build;
  if (build) await $`sh -c ${build}`;
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/desktop.ts", mode === "spa" ? spaEntry(c) : desktopEntry(c));
  const assets = mode === "spa" ? (d.clientDir ?? "dist/desktop") : c.worker.assets;

  const shimPath = Bun.resolveSync("@rustybuns/shell-bun/shims", process.cwd());
  const aliasEntries = Object.entries(src.aliases).sort((a, b) => b[0].length - a[0].length);
  const plugins = [{
    name: "rustybuns-shims",
    setup(b: any) {
      // Host side: the worker-runtime modules become the local runtime.
      b.onResolve({ filter: /^(cloudflare:workers|rwsdk\/worker)$/ }, () => ({ path: shimPath }));
      // The app's aliases ("@/x", "~/x", "#lib/x"), resolved the way tsconfig/vite do.
      b.onResolve({ filter: /^[@~#]/ }, (args: { path: string }) => {
        for (const [alias, dir] of aliasEntries) {
          if (args.path !== alias && !args.path.startsWith(alias + "/")) continue;
          const base = join(process.cwd(), dir, args.path.slice(alias.length + 1));
          const hit = resolveFileOrDir(base);
          if (hit) return { path: hit };
        }
        return undefined;
      });
    },
  }];
  const version = (await Bun.file("package.json").json().catch(() => ({})))?.version ?? "0.0.0";
  const sha = (await $`git rev-parse --short HEAD`.quiet().nothrow().text()).trim() || "nogit";
  const defineMap: Record<string, string> = { RB_VERSION: JSON.stringify(`${version}+${sha}`) };
  for (const [k, v] of Object.entries(d.define ?? {})) defineMap[k] = JSON.stringify(v);

  if (opts.noCompile) {
    // Dev host: same bundle pipeline as the binary, minus --compile. Nothing
    // embedded; assets and migrations are read from the working tree.
    const r = await Bun.build({ entrypoints: [".rustybuns/desktop.ts"], outdir: ".rustybuns/dev", target: "bun", define: defineMap, plugins, sourcemap: "linked", throw: false } as any);
    if (!r.success) throw new Error(r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n"));
    console.log(`dev host: rustybuns run desktop   (= bun .rustybuns/dev/desktop.js)`);
    return ".rustybuns/dev/desktop.js";
  }

  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}` as DesktopOs;
  const targets: DesktopOs[] = opts.target ? [opts.target as DesktopOs]
    : d.targets === "all" ? ALL_OS
    : d.targets ?? [hostTag];

  const hasRust = await Bun.file("native/Cargo.toml").exists();
  if (hasRust && targets.some((t) => t !== hostTag)) {
    throw new Error(`native/ has Rust crates: cdylibs do not cross-compile. Build ${targets.filter((t) => t !== hostTag).join(", ")} on their own OS (CI matrix), or pass --target ${hostTag}.`);
  }

  const outs: string[] = [];
  const nativeTags = hasRust ? await stageNative(targets) : [];
  const migrationDirs = Object.values(c.bindings).filter((b) => b.type === "d1" && (b as any).migrationsDir).map((b) => (b as any).migrationsDir as string);
  // External mounts (~ or absolute) stay on disk; only project dirs are embedded.
  const external = (dir: string) => dir.startsWith("~") || dir.startsWith("/");
  const mountDirs = [...Object.values(d.mounts ?? {}).filter((dir) => !external(dir)), ...(nativeTags.length ? [NATIVE_STAGE] : [])];
  // Embedded dirs are keyed by basename, so two mounts named the same collide.
  const names = [assets, ...migrationDirs, ...mountDirs].filter(Boolean).map((p) => basename(p!));
  if (new Set(names).size !== names.length) throw new Error(`embedded directories must have distinct basenames: ${names.join(", ")}`);
  for (const t of targets) {
    const out = opts.outfile ?? `dist/${c.name}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
    const r = await Bun.build({
      entrypoints: [".rustybuns/desktop.ts"],
      outdir: dirname(out),          // Bun.build places compile.outfile under outdir
      compile: { target: `bun-${t}`, outfile: basename(out), ...(assets || migrationDirs.length || mountDirs.length ? { assets: [assets, ...migrationDirs, ...mountDirs].filter(Boolean) } : {}) },
      define: defineMap,
      plugins,
      throw: false,
    } as any);
    if (!r.success) throw new Error(r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n"));
    outs.push(out);
  }
  return outs.join("\n");
}
