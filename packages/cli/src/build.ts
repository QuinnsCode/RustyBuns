// rustybuns build desktop
//   1. run the app build (vite build)               -> dist/worker, dist/client
//   2. write .rustybuns/desktop.ts                   -> the Bun entry: shell + adapters + launcher
//   3. bun build --compile the entry, embedding dist  -> one executable
// Targets: current OS by default. Cross-OS is a CI matrix, not one machine.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import type { DesktopOs, RustyBunsConfig } from "./config.ts";
import { basename } from "node:path";
import { Profiler } from "./profile.ts";
import { BUN_CHECK_MIN, pickChecker, runCheck, type CheckerName } from "./typecheck.ts";

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

/**
 * Where the generated host runs.
 * "desktop": 127.0.0.1, launch token, opens a browser, data in ~/.<name>.
 * "box": 0.0.0.0:$PORT, no token, /health, data in $DATA_DIR. Same app code.
 */
export type HostKind = "desktop" | "box";

/** Data dir expression, server port/hostname and the launch tail for each host kind. */
function hostParts(c: RustyBunsConfig, host: HostKind, desktopDataDir: string) {
  const box = host === "box";
  return {
    box,
    dataDir: box
      ? `process.env.DATA_DIR ?? ${JSON.stringify(`/var/lib/${c.name}`)}`
      : `${JSON.stringify(desktopDataDir)}.replace(/^~/, homedir())`,
    token: box ? "undefined" : "mintToken()",
    listen: box ? `, hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000)` : `, hostname: listen.hostname, port: listen.port`,
    launch: box ? "" : `await openBrowser({ url: shell.url, token, window: ${JSON.stringify(c.targets.desktop?.window ?? "app")} });\n`,
  };
}

const ALL_OS: DesktopOs[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];

/** spa mode: your Vite SPA + your world class. No worker, no RSC, no shims. */
export function spaEntry(c: RustyBunsConfig, host: HostKind = "desktop"): string {
  const d = c.targets.desktop ?? {};
  const h = hostParts(c, host, d.dataDir ?? `~/.${c.name}`);
  const worldPath = d.worldPath ?? "/ws";
  const clientDir = d.clientDir ?? "dist/desktop";
  const identity = {
    "X-User-Id": "local",
    "X-User-Name": "${process.env.USER ?? process.env.USERNAME ?? \"wanderer\"}",
    "X-World-Slug": "local",
    "X-World-Owner": "local",
    ...(d.identity ?? {}),
  };
  const bindings = c.bindings ?? {};
  const hasWorld = d.world !== false;
  const kvNames = Object.entries(bindings).filter(([, b]) => b.type === "kv").map(([n]) => n);
  const d1s = Object.entries(bindings).filter(([, b]) => b.type === "d1").map(([n, b]) => [n, (b as any).databaseName as string, (b as any).migrationsDir as string | undefined] as const);
  const vars = Object.entries(bindings).filter(([, b]) => b.type === "var").map(([n, b]) => [n, (b as any).value as string]);
  const r2s = Object.entries(bindings).filter(([, b]) => b.type === "r2").map(([n, b]) => [n, (b as any).bucketName as string] as const);
  // Desktop has no secrets; a box reads them from its env file.
  const secrets = h.box ? Object.entries(bindings).filter(([, b]) => b.type === "secret").map(([n]) => n) : [];
  const mounts = d.mounts ?? {};
  const g = d.guests ?? {};
  const guestVersion = g.version === false ? "undefined" : g.version ? JSON.stringify(g.version) : `(typeof RB_VERSION === "string" ? RB_VERSION : undefined)`;
  return `// GENERATED ${host} host (spa mode). Serves the SPA, runs the world in-process
// as a Durable Object with sqlite storage, vouches the local identity at ${worldPath}.
// Guests (other machines) reach ${worldPath} alone, with ?join=<passphrase>&uid=&name=&v=.
// Replaces desktop_host.ts + desktop_gen_embed.ts.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter, applyD1Migrations, type GuestState } from "@rustybuns/shell-bun";
${hasWorld ? `import World from ${JSON.stringify("../" + (d.world || "packages/desktop/world.ts"))};` : "// no world (desktop.world: false)"}
${d.host ? `import host from ${JSON.stringify("../" + d.host)};` : "const host: any = null;"}
import { homedir, networkInterfaces } from "node:os";
import { mkdirSync, existsSync${h.box ? ", statSync, readFileSync, writeFileSync" : ""} } from "node:fs";
import { basename, join, isAbsolute } from "node:path";

declare const RB_VERSION: string;
// What a guest on the LAN would type: this machine's non-loopback IPv4 addresses.
const lanAddresses = (): string[] => Object.values(networkInterfaces()).flatMap((l) => l ?? [])
  .filter((i) => (i.family === "IPv4" || (i.family as unknown) === 4) && !i.internal).map((i) => i.address);
const dataDir = ${h.dataDir};
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);
${h.box ? `// "volume" when the data dir is its own filesystem (an attached Volume), else
// "container": data that a redeploy throws away. /health says which.
const dataMount = statSync(dataDir).dev !== statSync("/").dev ? "volume" : "container";
// Starts of this box against this data dir. It only grows across a redeploy
// when the data survived it; /health says it too.
const bootFile = join(dataDir, ".rb-boots");
const boots = (existsSync(bootFile) ? Number(readFileSync(bootFile, "utf8")) || 0 : 0) + 1;
writeFileSync(bootFile, String(boots));
console.log("[data] " + dataDir + " on the " + dataMount + ", start " + boots);
` : ""}
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
${secrets.map((n) => `  ${n}: process.env[${JSON.stringify(n)}] ?? "",`).join("\n")}
  LOG_PIPELINE: { send: async () => {} },
  LOG_COLDSTORE_PIPELINE: { send: async () => {} },
};
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.
${d1s.filter(([, , m]) => m).map(([n, , m]) => `for (const f of await applyD1Migrations(env.${n} as any, existsSync(join(import.meta.dir, ${JSON.stringify(basename(m!))})) ? join(import.meta.dir, ${JSON.stringify(basename(m!))}) : join(process.cwd(), ${JSON.stringify(m)}))) console.log("[migrate] " + f);`).join("\n")}
${hasWorld ? `const WORLD = local.durableObject(World as any, env, "WORLD", { codec: ${JSON.stringify((c.targets.desktop as any)?.storageCodec ?? "json")} });` : "const WORLD: any = null;"}
const identity: Record<string, string> = {
${Object.entries(identity).map(([k, v]) => `  ${JSON.stringify(k)}: \`${v}\`,`).join("\n")}
};
// Actions and db modules imported through the cloudflare:workers / rwsdk/worker
// shims read these. Set before the action table is touched.
globalThis.__RB_ENV = env;
globalThis.__RB_IDENTITY = identity;
const { actions } = await import("./actions.ts");

// Launch overrides: --listen host:port / RB_LISTEN, --join pass / RB_JOIN.
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const [lh, lp] = (flag("listen") ?? process.env.RB_LISTEN ?? "").split(":");
const listen = { hostname: lh || ${JSON.stringify(d.listen?.hostname ?? "127.0.0.1")}, port: lp ? Number(lp) : ${d.listen?.port ?? 0} };
let guestCount = 0;
const guests: GuestState = {
  join: flag("join") ?? process.env.RB_JOIN ?? ${g.join ? JSON.stringify(g.join) : "undefined"},
  max: ${g.max ?? 8},
  version: ${guestVersion},
  connected: () => guestCount,
};
const token = ${h.token};
const shell = serve<Record<string, unknown>>({ assets: clientDir, mounts, token, reporter: stdoutReporter, headers: ${JSON.stringify(d.headers ?? {})}${h.listen},
  guest: { paths: [${JSON.stringify(worldPath)}], passphrase: () => guests.join } });
const hostCtx = { env, dataDir, identity, reporter: stdoutReporter, shell, guests };

// A guest's identity rides on its upgrade: trust on first use, shaped like
// the host's, never the host's own id. The id is a stable per-player token
// the client generates once and keeps.
const UID = /^[A-Za-z0-9_-]{1,64}$/, NAME = /^[^\\p{C}]{1,32}$/u;
function guestIdentity(url: URL): Record<string, string> | string {
  const uid = url.searchParams.get("uid") ?? "", name = url.searchParams.get("name") ?? uid;
  if (!UID.test(uid)) return "bad uid: 1-64 of [A-Za-z0-9_-]";
  if (uid === identity["X-User-Id"]) return "uid is the host's";
  if (!NAME.test(name)) return "bad name: 1-32 printable characters";
  return { ...identity, "X-User-Id": uid, "X-User-Name": name };
}
const reject = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });
${h.box ? `
// A box is public and plays like the edge: no local player, so every socket
// is a guest with its own identity, ?uid=&name= when the client sends them
// (trust on first use, as on the LAN), else a fresh id for this connection.
// ?room=CODE picks that room's world, as the edge Worker routes it; no room is
// the one shared world. The world itself says when a room is full. The page
// comes from this box, so no version check.
const ROOM = /^[A-Za-z0-9_-]{1,32}$/, MAX_ROOMS = 200;
const rooms = new Set<string>();
function boxRoom(url: URL): string | null {
  const room = url.searchParams.get("room");
  if (room === null) return "local";
  if (!ROOM.test(room)) return null;
  if (!rooms.has(room)) { if (rooms.size >= MAX_ROOMS) return null; rooms.add(room); }
  return "room:" + room;
}
function boxIdentity(url: URL): Record<string, string> | string {
  const uid = url.searchParams.get("uid");
  if (uid !== null) return guestIdentity(url);
  const name = url.searchParams.get("name") ?? "";
  if (name && !NAME.test(name)) return "bad name: 1-32 printable characters";
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return { ...identity, "X-User-Id": id, "X-User-Name": name || \`\${identity["X-User-Name"]}-\${id.slice(0, 4)}\` };
}
` : ""}
// The host IS the middleware: the local player vouched at the upgrade,
// exactly the headers the CF shell reads; guests vouched from their query.
shell.mount({
  async fetch(req) {
    const url = new URL(req.url);
    const guest = ${h.box ? "true" : `req.headers.get("x-rb-principal") === "guest"`};
${h.box ? `    if (url.pathname === "/health") return new Response("ok", { headers: { "X-RB-Data": dataMount, "X-RB-Boots": String(boots) } });\n` : ""}    if (WORLD && url.pathname === ${JSON.stringify(worldPath)}) {
      const h = new Headers(req.headers);
      let who = identity;
      if (guest) {
${h.box ? `        const id = boxIdentity(url);` : `        if (guests.version !== undefined && url.searchParams.get("v") !== guests.version) return reject(409, "version_mismatch", { expected: guests.version, got: url.searchParams.get("v") });
        if (guestCount >= guests.max) return reject(503, "full", { max: guests.max });
        const id = guestIdentity(url);`}
        if (typeof id === "string") return reject(400, "bad_identity", { detail: id });
        who = id;
      }
      for (const [k, v] of Object.entries(who)) h.set(k, v);
      h.set("X-RB-Principal", guest ? "guest" : "host");
${h.box ? `      const room = boxRoom(url);
      if (room === null) return reject(400, "bad_room", { detail: "1-32 of [A-Za-z0-9_-], and at most " + MAX_ROOMS + " rooms" });
` : ""}      const res = await WORLD.get(WORLD.idFromName(${h.box ? "room" : `"local"`})).fetch(new Request(req.url, { headers: h }));
      const sock = (res as any).webSocket;
      if (guest && res.status === 101 && sock) {
        guestCount++;
        const prev = sock.onClose;
        sock.onClose = (code: number, reason: string, clean: boolean) => { guestCount--; prev?.(code, reason, clean); };
      }
      return res;
    }
${h.box ? `    // Pages read /__rb/info to tell the desktop from the web. A box is the web:
    // no answer here, so they take their online path, the same as on the edge.
    if (url.pathname === "/__rb/info") return reject(404, "not_on_box");
` : ""}    if (url.pathname === "/__rb/info") {
      return Response.json({ app: ${JSON.stringify(c.name)}, version: typeof RB_VERSION === "string" ? RB_VERSION : "dev", bun: Bun.version,
        platform: \`\${process.platform}-\${process.arch}\`, dataDir, user: identity["X-User-Id"], actions: Object.keys(actions).length,
        bindings: Object.keys(env), host: !!host, caps: { sab: true, ffi: true, fs: true },
        listen: { hostname: shell.hostname, port: shell.port }, lan: lanAddresses(), sockets: shell.comms.sockets().length,
        guests: { open: guests.join !== undefined, connected: guestCount, max: guests.max, version: guests.version ?? null } });
    }
${h.box ? `    // Hosting controls are the desktop owner's; on a public box anyone could call them.
    if (url.pathname === "/__rb/host") return reject(404, "not_on_box");
` : ""}    if (url.pathname === "/__rb/host" && req.method === "POST") {
      // Host-page control: { listen?: { hostname, port }, join?: string | null, max?: number, version?: string | null }.
      // "Host a world" = { listen: { hostname: "0.0.0.0" }, join: "pass" }; "Stop hosting" = { join: null, listen: { hostname: "127.0.0.1" } }.
      const b = await req.json() as { listen?: { hostname?: string; port?: number }; join?: string | null; max?: number; version?: string | null };
      if ("join" in b) guests.join = typeof b.join === "string" && b.join.length > 0 ? b.join : undefined;
      if (typeof b.max === "number" && b.max >= 0) guests.max = b.max;
      if ("version" in b) guests.version = b.version ?? undefined;
      if (b.listen) shell.rebind(b.listen);
      return Response.json({ listen: { hostname: shell.hostname, port: shell.port }, guests: { open: guests.join !== undefined, connected: guestCount, max: guests.max, version: guests.version ?? null } });
    }
    if (url.pathname === "/__rb/action" && req.method === "POST") {
      // "use server" runs here, for real, against sqlite. Same code as the edge.
      const { module, fn, args } = await req.json() as { module: string; fn: string; args: unknown[] };
      const f = actions[module]?.[fn];
      if (!f) return new Response(\`no action \${module}#\${fn}\`, { status: 404 });
      try { return Response.json((await f(...args)) ?? null); }
      catch (err) { stdoutReporter.escaped("action", err, { module, fn }); return new Response(String((err as Error).message ?? err), { status: 500 }); }
    }
    if (host) {
      // App-owned routes. null = not mine, fall through.
      const res = await host.fetch(req, hostCtx);
      if (res) return res;
    }
    return new Response("not found", { status: 404 });
  },
}, env);

console.log(\`[${c.name} \${typeof RB_VERSION === "string" ? RB_VERSION : "dev"}] serving \${shell.url}\`);
${h.launch}`;
}


export function desktopEntry(c: RustyBunsConfig, host: HostKind = "desktop"): string {
  const h = hostParts(c, host, c.targets.desktop?.dataDir ?? `~/.${c.name}`);
  const bind: string[] = [];
  const dos: { name: string; className: string }[] = [];
  for (const [name, b] of Object.entries(c.bindings ?? {})) {
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
  return `// GENERATED ${host} entry. The RWSDK worker runs here, outside Cloudflare,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
import { serve, openBrowser, mintToken, localBindings, stdoutReporter } from "@rustybuns/shell-bun";
import worker, { ${dos.map((d) => d.className).join(", ")} } from ${JSON.stringify("../" + (c.worker!.builtMain ?? c.worker!.main))};
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join, isAbsolute } from "node:path";

// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}

const dataDir = ${h.dataDir};
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const [lh, lp] = (flag("listen") ?? process.env.RB_LISTEN ?? "").split(":");
const listen = { hostname: lh || ${JSON.stringify(c.targets.desktop?.listen?.hostname ?? "127.0.0.1")}, port: lp ? Number(lp) : ${c.targets.desktop?.listen?.port ?? 0} };

const env: Record<string, unknown> = {
${bind.join("\n")}
};
// Durable Objects run in-process. Bound after env exists because a DO's
// constructor receives this same env (a DO can use DB, KV, other DOs).
${dos.map((d) => `env.${d.name} = local.durableObject(${d.className} as any, env, ${JSON.stringify(d.name)});`).join("\n")}
// Lets import { env } from "cloudflare:workers" see the local bindings.
globalThis.__RB_ENV = env;

const token = ${h.token};
const shell = serve<typeof env>({
  assets: assetDir(${JSON.stringify(c.worker!.assets ?? "")}),
  runWorkerFirst: ${JSON.stringify(c.worker!.runWorkerFirst ?? [])},
  token,
  reporter: stdoutReporter${h.listen},
});
${h.box
  ? `shell.mount({ fetch: (req: Request, e: any, ctx: any) => new URL(req.url).pathname === "/health" ? new Response("ok") : (worker as any).fetch(req, e, ctx) } as any, env);`
  : `shell.mount(worker as any, env);`}
console.log(\`[${c.name}] serving \${shell.url}\`);
${h.launch}`;
}

import { sourceLayout } from "./glue/source.ts";
import { analyze } from "./glue/boundary.ts";
import { generateBoundaryFiles } from "./glue/desktop-scaffold.ts";

// Rust cdylibs from native/dist/<crate>/<os>-<arch>/ ride inside the binary at
// /$bunfs/root/native/<crate>/<os>-<arch>/, where @rustybuns/native looks.
// Only the platforms being built are staged, so each binary carries its own lib.
export const NATIVE_STAGE = ".rustybuns/native";
async function stageNative(targets: DesktopOs[], only?: string[]): Promise<string[]> {
  const { rm, cp, readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  await rm(NATIVE_STAGE, { recursive: true, force: true });
  if (!existsSync("native/dist")) {
    console.warn("[native] native/Cargo.toml exists but native/dist is empty: the binary will take the TS path. Build the cdylib first.");
    return [];
  }
  const staged: string[] = [];
  for (const crate of await readdir("native/dist")) {
    if (only?.length && !only.includes(crate)) continue;
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

export interface BuildOpts {
  target?: string; outfile?: string; noCompile?: boolean; host?: HostKind;
  /** noCompile: where the bundle goes. @default ".rustybuns/dev" */
  outdir?: string;
  /** Type check the app before the client build, with this checker ("auto" picks the fastest). */
  check?: CheckerName | "auto";
  /** Time each step, print the table and save it under .rustybuns/profile/. */
  profile?: boolean;
}

/** Type check the app's own tsconfig. Throws with the checker's output on errors. */
async function checkApp(prof: Profiler | undefined, want: CheckerName | "auto") {
  const tsconfig = existsSync("tsconfig.json") ? "tsconfig.json" : null;
  const c = pickChecker(want, tsconfig);
  if (!c) {
    console.warn(`[check] skipped: no type checker (Bun >= ${BUN_CHECK_MIN}, tsc-rs or typescript${tsconfig ? "" : ", and no tsconfig.json"})`);
    prof?.steps.push({ name: "typecheck app", ms: 0, note: "skipped" });
    return;
  }
  const r = prof ? await prof.step("typecheck app", () => runCheck(c, tsconfig), c.name) : await runCheck(c, tsconfig);
  if (!r.ok) {
    console.error(r.output);
    if (prof) await prof.finish();
    throw new Error(`type errors (${c.name}); nothing was built. Drop --check to build anyway.`);
  }
}

export async function buildDesktop(c: RustyBunsConfig, opts: BuildOpts = {}) {
  const prof = opts.profile ? new Profiler(opts.noCompile ? "build desktop --dev" : "build desktop") : undefined;
  const step = <T>(name: string, fn: () => T | Promise<T>) => prof ? prof.step(name, fn) : Promise.resolve(fn());
  const host = opts.host ?? "desktop";
  const entry = `.rustybuns/${host}.ts`;
  const d = c.targets.desktop ?? {};
  const mode = d.mode ?? "spa";
  const clientDir = d.clientDir ?? "dist/desktop";
  if (mode === "spa" && !opts.noCompile && normalize(clientDir).replace(/\/$/, "") === "dist" && !opts.outfile) {
    throw new Error(`the client build is in dist/, which is also where binaries go (and vite empties it on every build). Build the UI into dist/ui: clientBuild "vite build --outDir dist/ui", clientDir "dist/ui".`);
  }
  const src = sourceLayout(process.cwd(), c);
  await step("boundary glue", async () => {
    // Boundary glue is regenerated on every build: stubs, action proxies, host table.
    const { modules } = analyze({ srcDir: src.dir, aliases: src.aliases, ignore: src.ignore });
    await generateBoundaryFiles(process.cwd(), src.inf, modules, { actions: d.actions });
  });
  if (mode === "worker" && !c.worker) throw new Error("desktop.mode \"worker\" needs a worker section; desktop-only apps use mode \"spa\"");
  const build = mode === "spa" ? d.clientBuild : c.worker!.build;
  // Before the client build: a target mistake shouldn't cost a full UI build first.
  const hostTag = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}` as DesktopOs;
  const targets: DesktopOs[] = opts.target ? [opts.target as DesktopOs]
    : d.targets === "all" ? ALL_OS
    : d.targets ?? [hostTag];

  const hasRust = await Bun.file("native/Cargo.toml").exists();
  // cdylibs do not cross-compile, but Linux ones build in Docker on any machine.
  const cross = hasRust ? targets.filter((t) => t !== hostTag) : [];
  const linuxCross = cross.filter((t) => t.startsWith("linux-"));
  const otherCross = cross.filter((t) => !t.startsWith("linux-"));
  if (otherCross.length) {
    throw new Error(`native/ has Rust crates: cdylibs do not cross-compile. Build ${otherCross.join(", ")} on their own OS (CI matrix), or pass --target ${hostTag}.`);
  }
  if (linuxCross.length && !dockerUp()) {
    throw new Error(`native/ has Rust crates and ${linuxCross.join(", ")} is not this machine: start Docker (they build in a Linux container), or build on Linux.`);
  }
  // After the glue (the app imports the generated stubs), before the client build:
  // a type error shouldn't cost a full UI build and a 100 MB compile first.
  if (opts.check) await checkApp(prof, opts.check);
  if (build) await step("client build", () => $`sh -c ${build}`);
  await mkdir(".rustybuns", { recursive: true });
  await Bun.write(entry, mode === "spa" ? spaEntry(c, host) : desktopEntry(c, host));
  const assets = mode === "spa" ? (d.clientDir ?? "dist/desktop") : c.worker!.assets;

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
    const outdir = opts.outdir ?? ".rustybuns/dev";
    const r = await step("bundle dev host", () => Bun.build({ entrypoints: [entry], outdir, target: "bun", define: defineMap, plugins, sourcemap: opts.outdir ? "none" : "linked", throw: false } as any));
    await prof?.finish();
    if (!r.success) throw new Error(r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n"));
    if (!opts.outdir) console.log(`dev host: rustybuns run desktop   (= bun .rustybuns/dev/desktop.js)`);
    return `${outdir}/${host}.js`;
  }


  const outs: string[] = [];
  // desktop.native names the crates to embed (all built crates when unset);
  // a named crate that was never built is an error, not a silent TS fallback.
  for (const t of linuxCross) await step(`native ${t} (docker)`, () => buildLinuxNative(t, d.native));
  if (d.native?.length) nativeDirs(d.native);
  const nativeTags = hasRust ? await step("stage native", () => stageNative(targets, d.native)) : [];
  const { migrationDirs, mountDirs: projectMounts } = embeddedDirs(c);
  const mountDirs = [...projectMounts, ...(nativeTags.length ? [NATIVE_STAGE] : [])];
  // Embedded dirs are keyed by basename, so two mounts named the same collide.
  const names = [assets, ...migrationDirs, ...mountDirs].filter(Boolean).map((p) => basename(p!));
  if (new Set(names).size !== names.length) throw new Error(`embedded directories must have distinct basenames: ${names.join(", ")}`);
  for (const t of targets) {
    const out = opts.outfile ?? `dist/${c.name}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
    const r = await step(`compile ${t}`, () => Bun.build({
      entrypoints: [entry],
      outdir: dirname(out),          // Bun.build places compile.outfile under outdir
      compile: { target: `bun-${t}`, outfile: basename(out), ...(assets || migrationDirs.length || mountDirs.length ? { assets: [assets, ...migrationDirs, ...mountDirs].filter(Boolean) } : {}) },
      define: defineMap,
      plugins,
      throw: false,
    } as any));
    if (!r.success) throw new Error(r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n"));
    outs.push(out);
  }
  await prof?.finish();
  return outs.join("\n");
}

/**
 * The project directories a build carries with it: the client build, D1
 * migrations and project-relative mounts. The host finds each one next to
 * itself by basename (resolveDir), embedded or copied.
 */
export function embeddedDirs(c: RustyBunsConfig) {
  const d = c.targets.desktop ?? {};
  const assets = (d.mode ?? "spa") === "spa" ? (d.clientDir ?? "dist/desktop") : c.worker?.assets;
  const migrationDirs = Object.values(c.bindings ?? {}).filter((b) => b.type === "d1" && (b as any).migrationsDir).map((b) => (b as any).migrationsDir as string);
  // External mounts (~ or absolute) stay on disk; only project dirs are embedded.
  const external = (dir: string) => dir.startsWith("~") || dir.startsWith("/");
  const mountDirs = Object.values(d.mounts ?? {}).filter((dir) => !external(dir));
  return { assets, migrationDirs, mountDirs };
}

/** The local rustc's version (`1.96.0`), so a container builds with the same Rust; undefined without one. */
export function localRust(): string | undefined {
  const r = Bun.spawnSync(["rustc", "--version"], { stdout: "pipe", stderr: "ignore" });
  return /rustc (\d+\.\d+\.\d+)/.exec(r.stdout.toString())?.[1];
}

const dockerUp = () => Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

/**
 * Build native/crates for a Linux target in Docker, into native/dist/<crate>/<target>/,
 * where stageNative() picks them up. Debian bookworm's glibc (2.36) is older than
 * the servers' (Ubuntu 24.04: 2.39), so the .so loads there. The local rustc's
 * version, its own target dir, and a cached cargo registry volume.
 */
export async function buildLinuxNative(target: DesktopOs, only?: string[]): Promise<void> {
  const arch = target === "linux-arm64" ? "arm64" : "amd64";
  const crates = (await import("node:fs")).readdirSync("native/crates", { withFileTypes: true })
    .filter((e) => e.isDirectory() && (!only?.length || only.includes(e.name))).map((e) => e.name);
  const rust = localRust();
  const image = `rust:${rust ? rust + "-" : ""}slim-bookworm`;
  const targetDir = `native/target-${target}`;
  console.log(`[native] building ${crates.join(", ")} for ${target} in ${image} (docker, linux/${arch})`);
  const p = Bun.spawn(["docker", "run", "--rm", "--platform", `linux/${arch}`,
    "-v", `${process.cwd()}/native:/src/native`, "-v", "rustybuns-cargo-registry:/usr/local/cargo/registry", "-w", "/src", image,
    "cargo", "build", "--release", "--manifest-path", "native/Cargo.toml", "--target-dir", targetDir], { stdio: ["inherit", "inherit", "inherit"] });
  if (await p.exited !== 0) throw new Error(`the Docker build of native/ for ${target} failed (see above)`);
  const { mkdir, copyFile } = await import("node:fs/promises");
  for (const c of crates) {
    const out = join("native", "dist", c, target);
    await mkdir(out, { recursive: true });
    await copyFile(join(targetDir, "release", `lib${c}.so`), join(out, `lib${c}.so`));
  }
}

/** native/dist/<crate> for each embedded crate; loadNative() finds them at /$bunfs/root/<crate>/<os-arch>/. */
export function nativeDirs(names: string[] = []): string[] {
  const missing = names.filter((n) => !existsSync(join("native", "dist", n)));
  if (missing.length) throw new Error(`native crate(s) not built: ${missing.join(", ")}. Run \`bun native/build.ts\` first.`);
  return names.map((n) => join("native", "dist", n));
}
