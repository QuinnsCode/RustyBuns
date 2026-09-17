// rustybuns build desktop
//   1. run the app build (vite build)               -> dist/worker, dist/client
//   2. write .rustybuns/desktop.ts                   -> the Bun entry: shell + adapters + launcher
//   3. bun build --compile the entry, embedding dist  -> one executable
// Targets: current OS by default. Cross-OS is a CI matrix, not one machine.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DesktopOs, RustyBunsConfig } from "./config.ts";
import { basename } from "node:path";

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
  return `// GENERATED desktop host (spa mode). Serves the SPA, runs the world in-process
// as a Durable Object with sqlite storage, vouches the local identity at ${worldPath}.
// Replaces desktop_host.ts + desktop_gen_embed.ts.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter, applyD1Migrations } from "@rustybuns/shell-bun";
import World from ${JSON.stringify("../" + (d.world ?? "packages/desktop/world.ts"))};
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

declare const RB_VERSION: string;
const dataDir = ${JSON.stringify(dataDir)}.replace(/^~/, homedir());
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);

// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: real path.
const embedded = join(import.meta.dir, ${JSON.stringify(basename(clientDir))});
const clientDir = existsSync(embedded) ? embedded : join(import.meta.dir, ${JSON.stringify("../" + clientDir)});

// What the world sees as env. KV and D1 are real sqlite; vars are baked;
// anything with no local twin (pipelines, R2) is a no-op reporter.
const env: Record<string, unknown> = {
${kvNames.map((n) => `  ${n}: local.kv(${JSON.stringify(n)}),`).join("\n")}
${d1s.map(([n, db]) => `  ${n}: local.d1(${JSON.stringify(db)}),`).join("\n")}
${vars.map(([n, v]) => `  ${n}: ${JSON.stringify(v)},`).join("\n")}
  LOG_PIPELINE: { send: async () => {} },
  LOG_COLDSTORE_PIPELINE: { send: async () => {} },
};
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.
${d1s.filter(([, , m]) => m).map(([n, , m]) => `for (const f of await applyD1Migrations(env.${n} as any, existsSync(join(import.meta.dir, ${JSON.stringify(basename(m!))})) ? join(import.meta.dir, ${JSON.stringify(basename(m!))}) : join(import.meta.dir, ${JSON.stringify("../" + m)}))) console.log("[migrate] " + f);`).join("\n")}
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
const shell = serve<Record<string, unknown>>({ assets: clientDir, token, reporter: stdoutReporter });

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

import { sourceLayout } from "./glue/source.ts";
import { analyze } from "./glue/boundary.ts";
import { generateBoundaryFiles } from "./glue/desktop-scaffold.ts";

export async function buildDesktop(c: RustyBunsConfig, opts: { target?: string; outfile?: string; noCompile?: boolean } = {}) {
  const d = c.targets.desktop ?? {};
  const src = sourceLayout(process.cwd(), c);
  {
    // Boundary glue is regenerated on every build: stubs, action proxies, host table.
    const { modules } = analyze({ srcDir: src.dir, aliases: src.aliases, ignore: src.ignore });
    await generateBoundaryFiles(process.cwd(), src.inf, modules);
  }
  const mode = d.mode ?? "spa";
  const build = mode === "spa" ? d.clientBuild : c.worker.build;
  if (build) await $`sh -c ${build}`;
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(".rustybuns/desktop.ts", mode === "spa" ? spaEntry(c) : desktopEntry(c));
  const assets = mode === "spa" ? (d.clientDir ?? "dist/desktop") : c.worker.assets;

  const version = (await Bun.file("package.json").json().catch(() => ({})))?.version ?? "0.0.0";
  const sha = (await $`git rev-parse --short HEAD`.quiet().nothrow().text()).trim() || "nogit";
  const defines = [`--define`, `RB_VERSION=${JSON.stringify(`${version}+${sha}`)}`];
  for (const [k, v] of Object.entries(d.define ?? {})) defines.push("--define", `${k}=${JSON.stringify(v)}`);

  if (opts.noCompile) {
    console.log(`dev host: bun .rustybuns/desktop.ts`);
    return ".rustybuns/desktop.ts";
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
  const migrationDirs = Object.values(c.bindings).filter((b) => b.type === "d1" && (b as any).migrationsDir).map((b) => (b as any).migrationsDir as string);
  const defineMap: Record<string, string> = {};
  for (let i = 0; i < defines.length; i += 2) { const [k, v] = defines[i + 1]!.split(/=(.*)/s); defineMap[k!] = v!; }
  const shimPath = Bun.resolveSync("@rustybuns/shell-bun/shims", process.cwd());
  const aliasEntries = Object.entries(src.aliases).sort((a, b) => b[0].length - a[0].length);
  for (const t of targets) {
    const out = opts.outfile ?? `dist/${c.name}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
    const r = await Bun.build({
      entrypoints: [".rustybuns/desktop.ts"],
      outdir: dirname(out),          // Bun.build places compile.outfile under outdir
      compile: { target: `bun-${t}`, outfile: basename(out), ...(assets || migrationDirs.length ? { assets: [assets, ...migrationDirs].filter(Boolean) } : {}) },
      define: defineMap,
      plugins: [{
        name: "rustybuns-shims",
        setup(b) {
          // Host side: the worker-runtime modules become the local runtime.
          b.onResolve({ filter: /^(cloudflare:workers|rwsdk\/worker)$/ }, () => ({ path: shimPath }));
          // The app's aliases ("@/x", "~/x", "#lib/x"), resolved the way tsconfig/vite do.
          b.onResolve({ filter: /^[@~#]/ }, (args) => {
            for (const [alias, dir] of aliasEntries) {
              if (args.path !== alias && !args.path.startsWith(alias + "/")) continue;
              const base = join(process.cwd(), dir, args.path.slice(alias.length + 1));
              for (const c of [base, base + ".ts", base + ".tsx", base + ".js", base + ".jsx", join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c)) return { path: c };
            }
            return undefined;
          });
        },
      }],
    } as any);
    if (!r.success) throw new Error(r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n"));
    outs.push(out);
  }
  return outs.join("\n");
}
