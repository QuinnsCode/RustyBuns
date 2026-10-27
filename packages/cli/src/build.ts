// rustybuns build desktop
//   1. run the app build (vite build)               -> dist/worker, dist/client
//   2. write .rustybuns/desktop.ts                   -> the Bun entry: shell + adapters + launcher
//   3. bun build --compile the entry, embedding dist  -> one executable
// Targets: current OS by default. Cross-OS is a CI matrix, not one machine.

import { needDocker } from "./containers.ts";
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { existsSync, statSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, normalize, relative, resolve } from "node:path";
import { hyperdriveUrlEnv, desktopServers, type Binding, type DesktopOs, type RustyBunsConfig } from "./config.ts";
import { basename } from "node:path";
import { stageAssets } from "./stage-assets.ts";
import { Profiler } from "./profile.ts";
import { addonLookups, addonProblems, addonsManifest, copyTrees, serverAddons, type TargetLookup } from "./addons.ts";
import { BUN_CHECK_MIN, compactDiagnostics, pickChecker, runCheck, type CheckerName } from "./typecheck.ts";

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
      // Absolute, so a relative one ("./data", from the cwd) still lands when desktop.server's
      // child runs with its cwd in it (#1269).
      : `resolve(${JSON.stringify(desktopDataDir)}.replace(/^~/, homedir()))`,
    // A dev host takes RB_TOKEN from `run desktop --watch`, so a restart keeps the window logged in.
    token: box ? "undefined" : `((typeof RB_DEV === "boolean" && RB_DEV || edgeLike()) && process.env.RB_TOKEN) || mintToken()`,
    listen: box ? `, hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000)` : `, hostname: listen.hostname, port: listen.port`,
    launch: box ? "" : `// <data>/desktop.json (0600, gone on exit) is how local tools find this run without RB_NO_BROWSER.
writeDesktopFile(dataDir, shell.url, token);
await openBrowser({ url: shell.url, token, code: shell.launchCode(), window: ${JSON.stringify(c.targets.desktop?.window ?? "app")} });\n`,
  };
}

// At launch the host checks the RustyBuns it was built with (RB_RUSTYBUNS)
// against advisories.json, once a day, without holding up the start.
const LAUNCH_CHECK = `launchCheck(typeof RB_RUSTYBUNS === "string" ? RB_RUSTYBUNS : undefined, { dev: typeof RB_DEV === "boolean" && RB_DEV });\n`;

// With targets.desktop.advisories it also checks the app's own version against
// the app's file. That notice is for the app's users, so it shows in release
// builds too; the spa host keeps it for /__rb/info as `update`.
function appCheck(c: RustyBunsConfig, keep: boolean): string {
  const url = c.targets.desktop?.advisories;
  if (!url) return "";
  return `appLaunchCheck(${JSON.stringify(c.name)}, typeof RB_VERSION === "string" ? RB_VERSION : undefined, ${JSON.stringify(url)})${keep ? ".then((n) => { appUpdate = n; })" : ""};\n`;
}
const appImport = (c: RustyBunsConfig) => c.targets.desktop?.advisories ? ", appLaunchCheck" : "";

/** Where desktop.server's bundles sit beside the host: the dev bundle's dir, the binary's $bunfs root. */
export const APP_SERVER_DIR = "app-server";
/** The bundle of desktop.server's `i`th server, in APP_SERVER_DIR. */
export const appServerFile = (i: number) => `server-${i}.js`;

const ALL_OS: DesktopOs[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64", "windows-arm64"];

/** spa mode: your Vite SPA + your world class. No worker, no RSC, no shims. */
/** A host's memory watch: RSS and heap every 5 minutes with the growth rate, served at /__rb/mem. */
function hostMemWatch(c: RustyBunsConfig, box: boolean): string {
  return `// RSS and heap every 5 minutes, with the growth rate; /__rb/mem serves them.
// Over the ceiling (RB_MEM_MAX_MB${box ? ", else box.memMaxMb" : ""}) it writes a heap snapshot
// to <data>/heap and exits 1, so ${box ? "the box restarts before it runs out" : "a leak stops before it takes the machine down"}.
${box && c.targets.box?.persona ? `// Background work (crons, queue batches) shares the ${c.targets.box.persona} budget; RB_PERSONA overrides.
process.env.RB_PERSONA ||= ${JSON.stringify(c.targets.box.persona)};
` : ""}${c.targets.desktop?.warm ? `// The host's scheduler keeps ${c.targets.desktop.warm} finished worker(s) loaded (desktop.warm); RB_WARM overrides.
process.env.RB_WARM ||= ${JSON.stringify(String(c.targets.desktop.warm))};
` : ""}${box ? `// It takes 5 seconds of CPU profile into <data>/prof first.
// <data>/history.jsonl keeps the samples, profile summaries and ceiling restarts
// across restarts and deploys: GET /__rb/history, behind RB_PROF_SECRET, reads it.
const hist = history({ file: join(dataDir, "history.jsonl") });
hist.boot([typeof RB_VERSION === "string" ? RB_VERSION : "", process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? ""].filter(Boolean).join(" ") || undefined);
const mem = memWatch({ maxMb: Number(process.env.RB_MEM_MAX_MB) || ${c.targets.box?.memMaxMb ?? 0}, snapshotDir: join(dataDir, "heap"),
  onSample: (s) => hist.mem(s),
  beforeRestart: async (s) => {
    hist.ceiling(s);
    const { file, json } = await cpuProfile({ dir: join(dataDir, "prof"), ms: 5000, name: "ceiling" });
    hist.profile(basename(file), summarizeProfile(JSON.parse(json)), "ceiling");
  } });` : `const mem = memWatch({ maxMb: Number(process.env.RB_MEM_MAX_MB) || 0, snapshotDir: join(dataDir, "heap") });`}
mem.tick();
${box ? `// POST /__rb/prof?s=10 with Authorization: Bearer $RB_PROF_SECRET samples the CPU
// and answers with a .cpuprofile (also kept in <data>/prof). No secret, no route.
const prof = profRoute({ secret: process.env.RB_PROF_SECRET, dir: join(dataDir, "prof"), history: hist });
` : ""}${webmcpOn(c, box) ? `// targets.box.webmcp: every page gets a script that hands an agent in the browser
// mem_stats, take_cpu_profile and mem_history over WebMCP. It's served here.
const webmcp = webMcpRoute();
` : ""}`;
}

/** targets.box.webmcp, on a box host only. */
const webmcpOn = (c: RustyBunsConfig, box: boolean) => box && c.targets.box?.webmcp === true;

/** Where the build copies PGlite's WASM and data, beside the entry, so the binary embeds them. */
export const PGLITE_STAGE = ".rustybuns/pglite";
const PGLITE_FILES = ["pglite.wasm", "initdb.wasm", "pglite.data"];

/** Hyperdrive bindings whose offline twin is PGlite (`local: "pglite"`). */
function pgliteTwins(c: RustyBunsConfig) {
  return Object.entries(c.bindings ?? {}).flatMap(([n, b]) => b.type === "hyperdrive" && b.local === "pglite" ? [[n, b] as const] : []);
}

/** The entry's PGlite imports: the twin and its files, embedded by the compile (`type: "file"`). */
function pgliteImports(c: RustyBunsConfig): string {
  if (!pgliteTwins(c).length) return "";
  return `import { pgliteHyperdrive } from "@rustybuns/shell-bun/pglite";
${PGLITE_FILES.map((f, i) => `import pglite${i} from "./pglite/${f}" with { type: "file" };`).join("\n")}
// Compiled: $bunfs paths. A dev bundle: paths beside it.
const pgliteFiles = { wasm: resolve(import.meta.dir, pglite0), initdb: resolve(import.meta.dir, pglite1), data: resolve(import.meta.dir, pglite2) };
`;
}

/** env.NAME for a hyperdrive binding off the edge: the origin's URL, or with `local: "pglite"`
 *  and the URL unset, PGlite in the data dir. `dir` resolves an embedded project dir. */
function hyperdriveBinding(name: string, b: Extract<Binding, { type: "hyperdrive" }>, dir: (rel: string) => string): string {
  const url = `process.env[${JSON.stringify(hyperdriveUrlEnv(name, b))}]`;
  const viaUrl = `local.hyperdrive(${url}, ${JSON.stringify(name)})`;
  if (b.local !== "pglite") return viaUrl;
  const migrations = b.migrationsDir ? `, migrations: ${dir(b.migrationsDir)}` : "";
  return `${url} ? ${viaUrl} : await pgliteHyperdrive(join(dataDir, "pglite", ${JSON.stringify(name)}), ${JSON.stringify(name)}, { ...pgliteFiles${migrations} })`;
}

/** Copy PGlite's files from the app's node_modules into PGLITE_STAGE. */
async function stagePglite(cwd = process.cwd()) {
  let dist: string;
  try { dist = dirname(Bun.resolveSync("@electric-sql/pglite", cwd)); }
  catch { throw new Error(`a hyperdrive binding has local: "pglite", so the app needs @electric-sql/pglite and @electric-sql/pglite-socket: add them to its dependencies`); }
  await mkdir(PGLITE_STAGE, { recursive: true });
  for (const f of PGLITE_FILES) await Bun.write(join(PGLITE_STAGE, f), Bun.file(join(dist, f)));
}

/** tsyringe (passkey/webauthn addons, via @peculiar/x509) throws at load unless reflect-metadata
 *  ran first. On the edge the Worker's own entry imports it; the spa host loads the app's actions
 *  itself, so it imports it first when the app's tree has it (#910). The bare name when the app
 *  resolves it, else the copy beside the package that needs it (pnpm/isolated installs). */
export function reflectMetadataImport(cwd = process.cwd()): string {
  const from = (dir: string) => { try { return Bun.resolveSync("reflect-metadata", dir); } catch { return null; } };
  if (from(cwd)) return `import "reflect-metadata";\n`;
  for (const pkg of ["tsyringe", "@peculiar/x509"]) {
    let dir: string;
    try { dir = dirname(Bun.resolveSync(`${pkg}/package.json`, cwd)); } catch { continue; }
    const hit = from(dir);
    if (hit) return `import ${JSON.stringify(hit)};\n`;
  }
  return "";
}

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
  const pgs = Object.entries(bindings).flatMap(([n, b]) => b.type === "hyperdrive" ? [[n, b] as const] : []);
  // Desktop has no secrets; a box reads them from its env file.
  const secrets = h.box ? Object.entries(bindings).filter(([, b]) => b.type === "secret").map(([n]) => n) : [];
  const mounts = d.mounts ?? {};
  const g = d.guests ?? {};
  const guestVersion = g.version === false ? "undefined" : g.version ? JSON.stringify(g.version) : `(typeof RB_VERSION === "string" ? RB_VERSION : undefined)`;
  return `// GENERATED ${host} host (spa mode). Serves the SPA, runs the world in-process
// as a Durable Object with sqlite storage, vouches the local identity at ${worldPath}.
// Guests (other machines) reach ${worldPath} alone, with ?join=<passphrase>&uid=&name=&v=.
// Replaces desktop_host.ts + desktop_gen_embed.ts.
${reflectMetadataImport()}import { serve, openBrowser, writeDesktopFile, mintToken, localBindings, stdoutReporter, applyD1Migrations, launchCheck, memWatch${h.box ? ", cpuProfile, profRoute, history, summarizeProfile" : ""}${webmcpOn(c, h.box) ? ", webMcpRoute, WEBMCP_TAG" : ""}${appImport(c)}${d.server ? ", appServer" : ""}, type GuestState } from "@rustybuns/shell-bun";
${hasWorld ? `import World from ${JSON.stringify("../" + (d.world || "packages/desktop/world.ts"))};` : "// no world (desktop.world: false)"}
${d.host ? `import host from ${JSON.stringify("../" + d.host)};` : "const host: any = null;"}
import { homedir, networkInterfaces } from "node:os";
import { mkdirSync, existsSync${h.box ? ", statSync, readFileSync, writeFileSync" : ""} } from "node:fs";
import { basename, join, isAbsolute, resolve } from "node:path";
${pgliteImports(c)}
declare const RB_VERSION: string, RB_RUSTYBUNS: string, RB_DEV: boolean;
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
` : ""}${hostMemWatch(c, h.box)}
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
${pgs.map(([n, b]) => `  ${n}: ${hyperdriveBinding(n, b, (m) => `resolveDir(${JSON.stringify(m)})`)},`).join("\n")}
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
let appUpdate: string | null = null; // the app's own advisory, if any: see appLaunchCheck
const guests: GuestState = {
  join: flag("join") ?? process.env.RB_JOIN ?? ${g.join ? JSON.stringify(g.join) : "undefined"},
  max: ${g.max ?? 8},
  version: ${guestVersion},
  connected: () => guestCount,
};
// A passphrase is the only lock on a world bound off loopback: at launch, as at
// POST /__rb/host, it takes at least JOIN_MIN characters there, or the host won't start.
const JOIN_MIN = 12, LOOPBACK = /^(127\\.|localhost$|::1$|\\[::1\\]$)/;
if (guests.join !== undefined && guests.join.length < JOIN_MIN && !LOOPBACK.test(listen.hostname)) {
  console.error(\`[rustybuns] guests on \${listen.hostname} need a join passphrase of at least \${JOIN_MIN} characters (--join, RB_JOIN or desktop.guests.join); this one has \${guests.join.length}. Use a longer one, or listen on 127.0.0.1.\`);
  process.exit(1);
}
const token = ${h.token};
const shell = serve<Record<string, unknown>>({ assets: clientDir, mounts, token, reporter: stdoutReporter, headers: ${JSON.stringify(d.headers ?? {})}${webmcpOn(c, h.box) ? ", head: WEBMCP_TAG" : ""}${h.listen},
  public: ${JSON.stringify(d.publicPaths ?? [])},
  guest: { paths: [${JSON.stringify(worldPath)}], passphrase: () => guests.join } });
const hostCtx = { env, dataDir, identity, reporter: stdoutReporter, shell, guests };
${d.server ? `// desktop.server: the app's own servers, bundled beside this host, each run as its child. They
// answer the paths the Vite dev server's proxy sent them, WebSocket upgrades too.
const appSrvs = await Promise.all([
${desktopServers(d).map((s, i) => `  appServer({ file: join(import.meta.dir, ${JSON.stringify(APP_SERVER_DIR)}, ${JSON.stringify(appServerFile(i))}), name: ${JSON.stringify(s.entry)}, paths: ${JSON.stringify(s.paths)}, dataDir${s.port ? `, port: ${s.port}` : ""}${s.env ? `, env: ${JSON.stringify(s.env)}` : ""} }),
`).join("")}]);
` : ""}
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
const madeUpJoin = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (n) => "abcdefghjkmnpqrstuvwxyz23456789"[n % 31]).join("").replace(/(.{5})(?!$)/g, "$1-");
${h.box ? `
// A box is public and plays like the edge: no local player, so every socket
// is a guest with its own identity, ?uid=&name= when the client sends them
// (trust on first use, as on the LAN), else a fresh id for this connection.
// ?room=CODE picks that room's world, as the edge Worker routes it; no room is
// the one shared world. The world itself says when a room is full. The page
// comes from this box, so no version check.
const ROOM = /^[A-Za-z0-9_-]{1,32}$/, MAX_ROOMS = 200;
// Open sockets per named room. A room leaves when its last socket closes, so
// the cap counts rooms in use, not every name ever tried since boot.
const rooms = new Map<string, number>();
function boxRoom(url: URL): string | null {
  const room = url.searchParams.get("room");
  if (room === null) return "local";
  if (!ROOM.test(room)) return null;
  if (!rooms.has("room:" + room) && rooms.size >= MAX_ROOMS) return null;
  return "room:" + room;
}
function roomSockets(room: string, d: 1 | -1) {
  if (room === "local") return;
  const n = (rooms.get(room) ?? 0) + d;
  if (n > 0) rooms.set(room, n); else rooms.delete(room);
}
// Railway's proxy sets X-Real-IP. One address gets WS_PER_MIN upgrades a
// minute, then 429 until its minute is up. No header (no proxy), no gate.
const WS_PER_MIN = 30;
const wsHits = new Map<string, { at: number; n: number }>();
function wsAllowed(ip: string | null, now: number): boolean {
  if (!ip) return true;
  let hit = wsHits.get(ip);
  if (!hit || now - hit.at >= 60_000) {
    wsHits.delete(ip);                             // re-insert: the map's order is oldest window first
    wsHits.set(ip, hit = { at: now, n: 0 });
    if (wsHits.size > 10_000) wsHits.delete(wsHits.keys().next().value!);
  }
  return ++hit.n <= WS_PER_MIN;
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
${h.box ? `    if (url.pathname === "/health") return new Response("ok", { headers: { "X-RB-Data": dataMount, "X-RB-Boots": String(boots) } });\n    if (url.pathname === "/__rb/mem") return Response.json({ ...mem.stats(), boots });\n    const profiled = await prof(req);\n    if (profiled) return profiled;\n${webmcpOn(c, true) ? `    const script = webmcp(req);\n    if (script) return script;\n` : ""}` : `    if (url.pathname === "/__rb/mem" && !guest) return Response.json(mem.stats());\n`}    if (WORLD && url.pathname === ${JSON.stringify(worldPath)}) {
${h.box ? `      if (!wsAllowed(req.headers.get("X-Real-IP"), Date.now())) return reject(429, "too_many", { detail: "at most " + WS_PER_MIN + " connections a minute from one address" });
` : ""}      const h = new Headers(req.headers);
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
      roomSockets(room, 1);                       // held while the world answers, so racing upgrades cannot overfill
      let res: Response;
      try { res = await WORLD.get(WORLD.idFromName(room)).fetch(new Request(req.url, { headers: h })); }
      catch (err) { roomSockets(room, -1); throw err; }
` : `      const res = await WORLD.get(WORLD.idFromName("local")).fetch(new Request(req.url, { headers: h }));
`}      const sock = (res as any).webSocket;
      if (guest && res.status === 101 && sock) {
        guestCount++;
        const prev = sock.onClose;
        sock.onClose = (code: number, reason: string, clean: boolean) => { guestCount--;${h.box ? " roomSockets(room, -1);" : ""} prev?.(code, reason, clean); };
      }${h.box ? ` else roomSockets(room, -1);` : ""}
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
        guests: { open: guests.join !== undefined, connected: guestCount, max: guests.max, version: guests.version ?? null }, update: appUpdate });
    }
${h.box ? `    // Hosting controls are the desktop owner's; on a public box anyone could call them.
    if (url.pathname === "/__rb/host") return reject(404, "not_on_box");
` : ""}    if (url.pathname === "/__rb/host" && req.method === "POST") {
      // Host-page control: { listen?: { hostname, port }, join?: string | true | null, max?: number, version?: string | null }.
      // "Host a world" = { listen: { hostname: "0.0.0.0" }, join: "a long passphrase" }; "Stop hosting" = { join: null, listen: { hostname: "127.0.0.1" } }.
      // join: true makes up a passphrase, returned once as guests.join. Off loopback a passphrase is the only lock
      // on the world, so it takes at least JOIN_MIN characters there, or the request changes nothing.
      // The body is the client's: every field is unknown until checked, and a non-object body just has none.
      const b = await req.json().catch(() => null) as { listen?: { hostname?: unknown; port?: unknown }; join?: unknown; max?: unknown; version?: unknown } | null;
      const made = b?.join === true ? madeUpJoin() : undefined;
      const join = b?.join === undefined ? guests.join : made ?? (typeof b.join === "string" && b.join.length > 0 ? b.join : undefined);
      const bindTo = typeof b?.listen?.hostname === "string" ? b.listen.hostname : shell.hostname;
      if (join !== undefined && join.length < JOIN_MIN && !LOOPBACK.test(bindTo))
        return reject(400, "weak_passphrase", { detail: "guests off this machine need a passphrase of at least " + JOIN_MIN + " characters, or send join: true for one", min: JOIN_MIN });
      guests.join = join;
      if (typeof b?.max === "number" && b.max >= 0) guests.max = b.max;
      if (b?.version !== undefined) guests.version = typeof b.version === "string" ? b.version : undefined;
      const l = b?.listen;
      if (l) shell.rebind({ hostname: typeof l.hostname === "string" ? l.hostname : undefined, port: typeof l.port === "number" && Number.isInteger(l.port) ? l.port : undefined });
      return Response.json({ listen: { hostname: shell.hostname, port: shell.port }, guests: { open: guests.join !== undefined, connected: guestCount, max: guests.max, version: guests.version ?? null, ...(made ? { join: made } : {}) } });
    }
${h.box ? `    // Actions run as the desktop's one host identity. A box has no token, so
    // anyone on the internet would be that user: actions stay off there.
    if (url.pathname === "/__rb/action") return reject(404, "not_on_box");
` : ""}    if (url.pathname === "/__rb/action" && req.method === "POST") {
      // "use server" runs here, for real, against sqlite. Same code as the edge.
      const { module, fn, args } = (await req.json().catch(() => null) ?? {}) as { module?: unknown; fn?: unknown; args?: unknown };
      if (typeof module !== "string" || typeof fn !== "string" || !Array.isArray(args)) return reject(400, "bad_action");
      // Own keys only: "constructor" or "__proto__" must not walk the prototype to a callable.
      const f = Object.hasOwn(actions, module) && Object.hasOwn(actions[module], fn) ? actions[module][fn] : undefined;
      if (!f) return new Response(\`no action \${module}#\${fn}\`, { status: 404 });
      try { return Response.json((await f(...args)) ?? null); }
      catch (err) { stdoutReporter.escaped("action", err, { module, fn }); return new Response(String((err as Error).message ?? err), { status: 500 }); }
    }
    if (host) {
      // App-owned routes. null = not mine, fall through.
      const res = await host.fetch(req, hostCtx);
      if (res) return res;
    }
${d.server ? `    for (const srv of appSrvs) {
      const res = await srv.fetch(req);
      if (res) return res;
    }
` : ""}    // A static site's own 404.html, the nearest one, as the web build serves with notFoundHandling "404-page".
    return shell.notFound(url);
  },
}, env);

console.log(\`[${c.name} \${typeof RB_VERSION === "string" ? RB_VERSION : "dev"}] serving \${shell.url}\`);
${LAUNCH_CHECK}${appCheck(c, true)}${h.launch}`;
}


/** rwsdk's "use client"/"use server" lookup tables are virtual modules its Vite plugin writes. A
 *  host bundle that reaches rwsdk/client (through a shared module) has no such plugin, and renders
 *  no client components or server functions by id, so each table is empty here. */
export const RWSDK_LOOKUPS = /^virtual:use-(client|server)-lookup\.js$/;
export const rwsdkLookupStub = (spec: string) =>
  spec.includes("client") ? "export const useClientLookup = {};" : "export const useServerLookup = {};";

/** import(`x`) with no ${...} in it, as import("x"), so the bundler resolves it statically. */
export const plainDynamicImports = (js: string) => js.replace(/\bimport\(`([^`$\\]+)`\)/g, (_, spec: string) => `import(${JSON.stringify(spec)})`);

/** A .wasm file the built Worker imports, as workerd hands it over: a compiled WebAssembly.Module
 *  (Prisma's query engine instantiates it), not the file path Bun's default loader gives. The bytes
 *  ride in the bundle, so a compiled binary carries them (#909). */
export const wasmModuleSource = (bytes: Uint8Array) =>
  `export default new WebAssembly.Module(Buffer.from(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, "base64"));`;

/** desktop.workers: each module's absolute path -> its bundle's name in workers/ beside the host
 *  (src/rig/worker.ts -> src-rig-worker.js). Bun.build leaves `new URL("./w.ts", import.meta.url)`
 *  alone and doesn't emit the module, so each is bundled on its own. */
export function workerBundles(cwd: string, workers: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of workers) {
    const abs = resolve(cwd, w);
    if (!existsSync(abs)) throw new Error(`desktop.workers: ${w} doesn't exist`);
    const name = relative(cwd, abs).replace(/\.[cm]?[jt]sx?$/, "").replace(/[\\/]/g, "-") + ".js";
    if ([...out.values()].includes(name)) throw new Error(`desktop.workers: two modules bundle to workers/${name}`);
    out.set(abs, name);
  }
  return out;
}

const WORKER_URL = /new\s+URL\(\s*(["'`])(\.\.?\/[^"'`$\\]+)\1\s*,\s*import\.meta\.url\s*\)/g;
/** Host code's `new URL("./w.ts", import.meta.url)` for a desktop.workers module, pointed at its
 *  bundle beside the host (`./workers/<name>.js`: the dev bundle's dir, the binary's $bunfs root).
 *  `unlisted` gets each script it names that isn't listed, which the binary won't have. */
export function pointWorkerUrls(code: string, file: string, bundles: Map<string, string>, unlisted?: (path: string) => void): string {
  return code.replace(WORKER_URL, (m, _q, rel: string) => {
    const abs = resolve(dirname(file), rel);
    const name = bundles.get(abs);
    if (name) return `new URL(${JSON.stringify(`./workers/${name}`)}, import.meta.url)`;
    if (/\.[cm]?[jt]sx?$/.test(abs)) unlisted?.(abs);
    return m;
  });
}

/** The Worker the host imports: builtMain, unless the build says otherwise. @cloudflare/vite-plugin
 *  writes a wrangler.json beside its output whose main names the real file (worker.js vs index.js). */
export function builtEntry(c: RustyBunsConfig, cwd = process.cwd()): string | undefined {
  const built = c.worker!.builtMain;
  if (!built || existsSync(join(cwd, built))) return built ?? c.worker!.main;
  const fromWrangler = (dir: string) => {
    const w = join(cwd, dir, "wrangler.json");
    const main = existsSync(w) ? (JSON.parse(readFileSync(w, "utf8")) as { main?: string }).main : undefined;
    return main && existsSync(join(cwd, dir, main)) ? join(dir, main) : undefined;
  };
  // 1. beside the guess; 2. any environment folder under the build root: the plugin names it after the
  // Worker or its viteEnvironment (dist/server/ for TanStack Start's `cloudflare({ viteEnvironment: { name: "ssr" } })`)
  const top = built.split("/")[0]!;
  const envDirs = existsSync(join(cwd, top)) ? readdirSync(join(cwd, top), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(top, e.name)) : [];
  const hit = fromWrangler(dirname(built)) ?? envDirs.map(fromWrangler).find(Boolean);
  if (hit) return hit;
  // 3. the guessed folder holds one script: a custom server entry (tanstackStart({ server: { entry } }))
  const dir = join(cwd, dirname(built));
  const scripts = existsSync(dir) ? readdirSync(dir).filter((f) => /\.m?js$/.test(f)) : [];
  return scripts.length === 1 ? join(dirname(built), scripts[0]!) : built;
}

export function desktopEntry(c: RustyBunsConfig, host: HostKind = "desktop"): string {
  const h = hostParts(c, host, c.targets.desktop?.dataDir ?? `~/.${c.name}`);
  const bind: string[] = [];
  const dos: { name: string; className: string }[] = [];
  /** Workflows whose class is one of the Worker's exports, bound once it has loaded. */
  const workflows: { name: string; className: string }[] = [];
  const migrations: [string, string][] = [];
  const openPaths = c.worker?.desktopOpenPaths ?? [];
  const artifacts: string[] = [];
  /** [the queue binding's expression, its consumer's settings, the binding's name] */
  const consumers: [string, object, string][] = [];
  /** Bindings the host meters for /__rb/usage: name -> kind. */
  const meters: Record<string, string> = {};
  for (const [name, b] of Object.entries(c.bindings ?? {})) {
    switch (b.type) {
      case "d1":
        meters[name] = "d1";
        bind.push(`  ${name}: local.d1(${[b.databaseName, b.renamedFrom].filter(Boolean).map((n) => JSON.stringify(n)).join(", ")}),`);
        if (b.migrationsDir) migrations.push([name, b.migrationsDir]);
        break;
      case "kv": bind.push(`  ${name}: local.kv(${JSON.stringify(name)}),`); meters[name] = "kv"; break;
      case "var": bind.push(`  ${name}: ${JSON.stringify(b.value)},`); break;
      case "secret": bind.push(`  ${name}: process.env[${JSON.stringify(name)}] ?? "",`); break;
      case "r2": bind.push(`  ${name}: local.r2(${JSON.stringify(b.bucketName)}),`); meters[name] = "r2"; break;
      case "artifacts":
        bind.push(`  ${name}: local.artifacts(${JSON.stringify(b.namespace)}),`);
        artifacts.push(name);
        break;
      case "images": bind.push(`  ${name}: local.images(),`); break;
      case "queue": {
        const q = `local.queue(${[b.queueName, b.renamedFrom].filter(Boolean).map((n) => JSON.stringify(n)).join(", ")})`;
        // Consumer-only: no env binding, the consumer reads the queue itself.
        if (b.producer !== false) { bind.push(`  ${name}: ${q},`); meters[name] = "queue"; }
        const dlq = b.consumer ? c.bindings[b.consumer.deadLetterQueue ?? ""] : undefined;
        // maxWaitTimeMs is the edge's: here a send is delivered at once.
        if (b.consumer !== false) consumers.push([b.producer !== false ? `env.${name}` : q, { batchSize: b.consumer?.batchSize, maxRetries: b.consumer?.maxRetries, retryDelay: b.consumer?.retryDelay, priority: b.consumer?.priority,
          deadLetterQueue: dlq?.type === "queue" ? dlq.queueName : undefined }, name]);
        break;
      }
      // No mail off the edge: each send is an .eml file in the data dir.
      case "send_email": bind.push(`  ${name}: local.sendEmail(${[JSON.stringify(name), ...(b.allowedSenderAddresses ? [JSON.stringify(b.allowedSenderAddresses)] : [])].join(", ")}),`); break;
      case "ratelimit": bind.push(`  // ${name}: Workers Rate Limiting has no local twin; the app runs without it`); break;
      // No pool off the edge: the app gets the origin's URL in Hyperdrive's shape.
      case "hyperdrive": bind.push(`  ${name}: ${hyperdriveBinding(name, b, (m) => `assetDir(${JSON.stringify(m)})!`)},`); break;
      case "vectorize": bind.push(`  ${name}: local.vectorize(${JSON.stringify(b.indexName)}, ${JSON.stringify({ dimensions: b.dimensions, metric: b.metric })}),`); break;
      // No model off the edge: env.AI is there, and each call says it runs only on Cloudflare.
      case "ai": bind.push(`  ${name}: local.ai(${JSON.stringify(name)}),`); break;
      case "workflow":
        if (b.scriptName) bind.push(`  // ${name}: Workflow in another script (${b.scriptName}) has no local twin`);
        else { bind.push(`  ${name}: local.workflow(${JSON.stringify(name)}),`); workflows.push({ name, className: b.className }); }
        break;
      case "worker_loader": bind.push(`  ${name}: local.workerLoader(${JSON.stringify(name)}),`); break;
      case "analytics_engine": bind.push(`  ${name}: local.analyticsEngine(${JSON.stringify(b.dataset ?? name)}),`); break;
      case "container": bind.push(`  // ${name}: Cloudflare Container (${b.className}) has no local twin; the app runs without it`); break;
      case "durable_object":
        if (b.scriptName) bind.push(`  // ${name}: DO in another script (${b.scriptName}) has no local twin`);
        else dos.push({ name, className: b.className });
        break;
    }
  }
  const crons = c.worker!.crons ?? [];
  const entry = builtEntry(c);
  if (!entry) throw new Error("worker-mode desktop needs worker.main: an assets-only Worker has no code to run on the desktop. Use desktop mode \"spa\".");
  return `// GENERATED ${host} entry. The RWSDK worker runs here, outside Cloudflare,
// with sqlite standing in for D1/KV. Same fetch(), same env shape.
// First: workerd's globalThis.Cloudflare, read by nodejs_compat builds as they load.
import "@rustybuns/shell-bun/workerd-global";
import { serve, openBrowser, writeDesktopFile, mintToken, localBindings, stdoutReporter, applyD1Migrations, launchCheck, memWatch, within, metered, usageSnapshot, capped, edgeLimits, edgeLike, recycling, restartHost, watchEnvAtImport${h.box ? ", cpuProfile, profRoute, history, summarizeProfile" : ""}${webmcpOn(c, h.box) ? ", webMcpRoute, WEBMCP_TAG" : ""}${appImport(c)}${artifacts.length ? ", gitHttp" : ""}${crons.length ? ", schedule" : ""} } from "@rustybuns/shell-bun";
// Bun's own process: a Worker built with nodejs_compat (unenv) swaps globalThis.process for
// one whose cwd() is "/" and argv is empty, and that would move assets and flags (#741).
import process from "node:process";
import { homedir } from "node:os";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { basename, join, isAbsolute, resolve } from "node:path";
${pgliteImports(c)}
declare const RB_VERSION: string, RB_RUSTYBUNS: string, RB_DEV: boolean;
// Compiled: --asset embeds the dir at /$bunfs/root/<basename>. Dev: use the real path.
function assetDir(rel: string): string | undefined {
  if (!rel) return undefined;
  const embedded = join(import.meta.dir, basename(rel));
  return existsSync(embedded) ? embedded : join(process.cwd(), rel);
}

const dataDir = ${h.dataDir};
mkdirSync(dataDir, { recursive: true });
const local = localBindings(dataDir);
${hostMemWatch(c, h.box)}const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const [lh, lp] = (flag("listen") ?? process.env.RB_LISTEN ?? "").split(":");
const listen = { hostname: lh || ${JSON.stringify(c.targets.desktop?.listen?.hostname ?? "127.0.0.1")}, port: lp ? Number(lp) : ${c.targets.desktop?.listen?.port ?? 0} };

const env: Record<string, unknown> = {
${bind.join("\n")}
};
// What each binding does, counted per request, cron tick and queue batch: /__rb/usage serves it and
// <data>/usage.json keeps it, for \`rustybuns plan --usage\` to turn into a monthly bill.
for (const [n, k] of Object.entries(${JSON.stringify(meters)})) env[n] = metered(n, k as any, env[n]);
setInterval(() => { try { writeFileSync(join(dataDir, "usage.json"), JSON.stringify(usageSnapshot())); } catch {} }, 60_000).unref();
// D1 is sqlite: your wrangler migrations apply here unchanged, tracked in
// d1_migrations. Embedded via --asset so the binary carries its own schema.
${migrations.map(([n, m]) => `for (const f of await applyD1Migrations(env.${n} as any, assetDir(${JSON.stringify(m)})!)) console.log("[migrate] " + f);`).join("\n")}
// Lets import { env } from "cloudflare:workers" see the local bindings, before the Worker loads:
// workerd gives a module its env at import, and apps read it at the top level
// (export const repo = makeRepo(await getDb())).
globalThis.__RB_ENV = env;
// Durable Objects run in-process, and their classes are the Worker's exports, so the namespaces
// are made once it has loaded. Until then each binding is a stand-in that forwards to the real
// one, for an app that keeps it at the top level (createDb(env.DB_DO), as rwsdk/db apps do).
const doLater = (name: string) => {
  let real: any;
  const bind = (r: unknown) => { real = r; };
  return new Proxy({}, { get: (_, k) => {
    if (k === "__rbBind") return bind;
    if (typeof k === "symbol" || k === "then") return real?.[k];
    if (!real) throw new Error(\`\${name}: a Durable Object used before the Worker finished loading\`);
    const v = real[k];
    return typeof v === "function" ? v.bind(real) : v;
  } });
};
${dos.map((d) => `env.${d.name} = doLater(${JSON.stringify(d.name)});`).join("\n")}
// workerd logs a rejected waitUntil, cron or queue promise and keeps serving; Bun would exit.
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e));
const stopEnvWatch = edgeLike() ? watchEnvAtImport() : () => {};
const { default: worker, ${[...new Set([...dos, ...workflows].map((d) => d.className))].map((n) => `${n}, `).join("")}} = await import(${JSON.stringify("../" + entry)});
stopEnvWatch();
// into this same env, because a DO's constructor receives it (a DO can use DB, KV, other DOs)
${dos.map((d) => `(env.${d.name} as any).__rbBind(local.durableObject(${d.className} as any, env, ${JSON.stringify(d.name)}));`).join("\n")}${workflows.length ? `
// Workflows: create() before now queued its instance; bind() starts those and resumes any the last run left going.
${workflows.map((w) => `(env.${w.name} as any).bind(${w.className} as any, env);`).join("\n")}` : ""}

const token = ${h.token};
const shell = serve<typeof env>({
  assets: assetDir(${JSON.stringify(c.worker!.assets ?? "")}),
  runWorkerFirst: ${JSON.stringify(c.worker!.runWorkerFirst ?? [])},
  token,
  reporter: stdoutReporter${webmcpOn(c, h.box) ? ",\n  head: WEBMCP_TAG" : ""}${h.listen},${artifacts.length || openPaths.length ? `
  // Routes that bring their own auth skip the host cookie: Artifacts git remotes (a repo token) and desktopOpenPaths (an MCP client's OAuth).
  open: {${artifacts.length ? `
    "/__rb/git/": (req: Request) => gitHttp(req, [${artifacts.map((n) => `env.${n} as any`).join(", ")}]),` : ""}${openPaths.map((p) => `
    ${JSON.stringify(p)}: (req: Request) => within("request", () => capped(limits, () => (worker as any).fetch(req, env, { waitUntil(p: Promise<unknown>) { p.catch(() => {}); }, passThroughOnException() {} }))),`).join("")}
  },` : ""}
});
${artifacts.map((n) => `(env.${n} as any).remoteBase = shell.url;`).join("\n")}${c.worker!.assets ? `
// env.ASSETS, as the edge binds it: the Worker can fetch its own static files.
env.ASSETS ??= shell.assets;` : ""}
// The edge's memory and CPU limits, measured per request (RB_CPU_MS=10 tries the Free plan's).
const limits = edgeLimits(${c.worker!.cpuMs ?? "undefined"});
// RB_EDGE_LIKE: the edge starts new isolates, so after N requests this host restarts and module globals reset.
const recycle = <A extends unknown[]>(f: (...a: A) => Response | Promise<Response>) => recycling(edgeLike()?.recycleAfter ?? 0, () => restartHost(shell, token), f);
${h.box
  ? `shell.mount({ fetch: recycle(async (req: Request, e: any, ctx: any) => { const p = new URL(req.url).pathname; return p === "/health" ? new Response("ok") : p === "/__rb/mem" ? Response.json(mem.stats()) : p === "/__rb/usage" ? Response.json(usageSnapshot()) : (await prof(req)) ?? ${webmcpOn(c, true) ? "webmcp(req) ?? " : ""}within("request", () => capped(limits, () => (worker as any).fetch(req, e, ctx))); }) } as any, env);`
  : `shell.mount({ fetch: recycle((req: Request, e: any, ctx: any) => { const p = new URL(req.url).pathname; return p === "/__rb/mem" ? Response.json(mem.stats()) : p === "/__rb/usage" ? Response.json(usageSnapshot()) : within("request", () => capped(limits, () => (worker as any).fetch(req, e, ctx))); }) } as any, env);`}
console.log(\`[${c.name}] serving \${shell.url}\`);${crons.length ? `
// Cron Triggers: the edge runs scheduled() on these; here a minute timer does, each run a low job
// on the host's scheduler (RB_PERSONA sets its budget).
schedule(${JSON.stringify(crons)}, (controller) => within("cron " + controller.cron, () => (worker as any).scheduled?.(controller, env, { waitUntil() {}, passThroughOnException() {} }))${c.worker!.cronPriority ? `, { priority: ${JSON.stringify(c.worker!.cronPriority)} }` : ""});` : ""}${consumers.map(([n, s, name]) => `
// Queue consumer: the edge hands this queue's batches to queue(); here an in-process loop does, each
// batch a low job on the host's scheduler unless the consumer says otherwise.
(${n} as any).consume((batch: any) => within(${JSON.stringify("queue " + name)}, () => (worker as any).queue?.(batch, env, { waitUntil() {}, passThroughOnException() {} }), batch.messages.length), ${JSON.stringify(s)});`).join("")}
${LAUNCH_CHECK}${appCheck(c, false)}${h.launch}`;
}

import { sourceLayout } from "./glue/source.ts";
import { analyze } from "./glue/boundary.ts";
import { generateBoundaryFiles } from "./glue/desktop-scaffold.ts";
import { workspacePrebuild } from "./glue/workspace-build.ts";

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
  const ships = only?.length ? only : shippingCrates();
  for (const crate of await readdir("native/dist")) {
    if (!ships.includes(crate)) continue;
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
    console.error(compactDiagnostics(r.output));
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
  // init points the desktop at files only `add desktop` writes, and its hint to run that can
  // scroll away under a long boundary report. Say so here, not with vite's "config not found".
  if (mode === "spa") {
    const missing = [d.clientBuild?.match(/--config\s+(\S+)/)?.[1], d.world === false ? undefined : d.world || "packages/desktop/world.ts"]
      .filter((f): f is string => !!f && !existsSync(f));
    if (missing.length) throw new Error(`the desktop isn't scaffolded yet: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Run \`rustybuns add desktop\` first (it keeps files that already exist).`);
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
  const want = opts.target ?? d.targets;
  const targets: DesktopOs[] = want === "all" ? ALL_OS
    : typeof want === "string" ? [want as DesktopOs]
    : want ?? [hostTag];
  const unknown = targets.filter((t) => !ALL_OS.includes(t));
  if (unknown.length) throw new Error(`unknown desktop target ${unknown.join(", ")}: use all, or one of ${ALL_OS.join(", ")}`);

  // desktop.native: false keeps native/ out of the binary, and so does a crate's own
  // [package.metadata.rustybuns] desktop = false (a wasm-only crate, say).
  const hasRust = d.native !== false && await Bun.file("native/Cargo.toml").exists()
    && (!!d.native?.length || shippingCrates().length > 0);
  const only = d.native || undefined;
  // cdylibs do not cross-compile, but Linux ones build in Docker on any machine.
  // Elsewhere, refuse only when a crate would be embedded: named, or built in native/dist.
  const cross = hasRust ? targets.filter((t) => t !== hostTag) : [];
  const linuxCross = cross.filter((t) => t.startsWith("linux-"));
  const otherCross = desktopCrates(d.native).length ? cross.filter((t) => !t.startsWith("linux-")) : [];
  if (otherCross.length) {
    throw new Error(`native/ has Rust crates: cdylibs do not cross-compile. Build ${otherCross.join(", ")} on their own OS (CI matrix), or pass --target ${hostTag}.`);
  }
  if (linuxCross.length) needDocker(`native/ has Rust crates and ${linuxCross.join(", ")} is not this machine, so they build in a Linux container (or build on Linux).`);
  // After the glue (the app imports the generated stubs), before the client build:
  // a type error shouldn't cost a full UI build and a 100 MB compile first.
  if (opts.check) await checkApp(prof, opts.check);
  // The app's bins on PATH, nearest first as npm puts them, so a step like `prisma generate`
  // resolves when rustybuns was started some other way, and so does a vite hoisted to a
  // workspace root.
  const bins: string[] = [];
  for (let d = process.cwd(); ; d = dirname(d)) { bins.push(join(d, "node_modules", ".bin")); if (dirname(d) === d) break; }
  const bin = { ...process.env, PATH: [...bins, process.env.PATH ?? ""].join(process.platform === "win32" ? ";" : ":") };
  // A monorepo app's workspace packages that ship as source with a build step are built first.
  for (const pre of workspacePrebuild(process.cwd())) {
    console.log(`building a workspace dependency: ${pre}`);
    await step("workspace build", () => $`sh -c ${pre}`.env(bin));
  }
  if (build) await step("client build", () => $`sh -c ${build}`.env(bin));
  await mkdir(".rustybuns", { recursive: true });
  if (pgliteTwins(c).length) await stagePglite();
  await Bun.write(entry, mode === "spa" ? spaEntry(c, host) : desktopEntry(c, host));
  const assets = mode === "spa" ? (d.clientDir ?? "dist/desktop") : c.worker!.assets;

  const shimPath = Bun.resolveSync("@rustybuns/shell-bun/shims", process.cwd());
  const aliasEntries = Object.entries(src.aliases).sort((a, b) => b[0].length - a[0].length);
  const workers = workerBundles(process.cwd(), d.workers);
  const warned = new Set<string>();
  const unlisted = (p: string) => {
    if (warned.has(p) || !existsSync(p)) return;
    warned.add(p);
    console.warn(`[workers] host code starts ${relative(process.cwd(), p)} on a worker; list it in desktop.workers or the build won't ship it`);
  };
  const plugins = [{
    name: "rustybuns-shims",
    setup(b: any) {
      // Host side: the worker-runtime modules become the local runtime.
      b.onResolve({ filter: /^(cloudflare:workers|cloudflare:workflows|cloudflare:email|rwsdk\/worker)$/ }, () => ({ path: shimPath }));
      b.onResolve({ filter: RWSDK_LOOKUPS }, (args: { path: string }) => ({ path: args.path, namespace: "rwsdk-lookup" }));
      b.onLoad({ filter: /.*/, namespace: "rwsdk-lookup" }, (args: { path: string }) => ({ contents: rwsdkLookupStub(args.path), loader: "js" }));
      // A dependency's optional import that isn't installed (pg's pg-cloudflare and pg-native, only
      // loaded on those platforms) stays a runtime import instead of failing the bundle. The app's
      // own imports aren't covered: a missing one of those should still fail here.
      b.onResolve({ filter: /^[^./][^:]*$/ }, (args: { path: string; importer: string }) => {
        if (!args.importer.includes("/node_modules/")) return undefined;
        try { Bun.resolveSync(args.path, dirname(args.importer)); return undefined; }
        catch { return { path: args.path, external: true }; }
      });
      // Vite writes some dynamic imports with a template literal (import(`cloudflare:workers`)), which
      // the bundler leaves to runtime, past the line above. In the built Worker, a literal with no
      // ${...} is made a plain string so it resolves here like any other import.
      if (mode === "worker" && c.worker?.builtMain) {
        const dir = join(process.cwd(), dirname(c.worker.builtMain)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        b.onLoad({ filter: new RegExp(`^${dir}[\\\\/].*\\.m?js$`) }, async (args: { path: string }) => ({
          contents: plainDynamicImports(await Bun.file(args.path).text()), loader: "js",
        }));
        // Only the Worker build's own .wasm: the host entry imports PGlite's as files.
        b.onLoad({ filter: new RegExp(`^${dir}[\\\\/].*\\.wasm$`) }, async (args: { path: string }) => ({
          contents: wasmModuleSource(await Bun.file(args.path).bytes()), loader: "js",
        }));
      }
      // The app's own code: a worker module it names by URL points at that worker's bundle.
      b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args: { path: string }) => {
        if (args.path.includes("/node_modules/") || !args.path.startsWith(process.cwd())) return undefined;
        const code = await Bun.file(args.path).text();
        if (!code.includes("import.meta.url")) return undefined;
        const ext = args.path.match(/\.[cm]?([jt]sx?)$/)![1]!;
        return { contents: pointWorkerUrls(code, args.path, workers, unlisted), loader: ext as "js" | "jsx" | "ts" | "tsx" };
      });
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
  const rustybuns = (await Bun.file(new URL("../package.json", import.meta.url)).json()).version as string;
  const defineMap: Record<string, string> = {
    RB_VERSION: JSON.stringify(`${version}+${sha}`),
    // The RustyBuns this was built with, and whether it is a dev host: see launchCheck.
    RB_RUSTYBUNS: JSON.stringify(rustybuns),
    RB_DEV: JSON.stringify(!!opts.noCompile),
    // globalThis.Cloudflare.compatibilityFlags on a worker-mode host (shell-bun/workerd-global).
    RB_COMPAT_FLAGS: JSON.stringify((c.worker?.compatibilityFlags ?? []).join(",")),
  };
  for (const [k, v] of Object.entries(d.define ?? {})) defineMap[k] = JSON.stringify(v);
  const buildErrors = (r: any) => r.logs.map((l: any) => `${l.level ?? ""} ${l.message ?? l}${l.position ? ` (${l.position.file}:${l.position.line})` : ""}`).join("\n");
  // desktop.workers, each bundled into <dir>/workers/ next to the host's bundle.
  const bundleWorkers = (dir: string, sourcemap: string) => step("bundle workers", async () => {
    const out: string[] = [];
    for (const [src, name] of workers) {
      const r = await Bun.build({ entrypoints: [src], outdir: join(dir, "workers"), naming: name.replace(/\.js$/, ".[ext]"), target: "bun", define: defineMap, plugins, sourcemap, throw: false } as any);
      if (!r.success) throw new Error(`desktop.workers ${relative(process.cwd(), src)}:\n${buildErrors(r)}`);
      out.push(join(dir, "workers", name));
    }
    return out;
  });

  // desktop.server, each bundled with its imports into <dir>/app-server/server-<i>.js for the host to start.
  if (d.server && mode !== "spa") throw new Error("desktop.server runs beside the spa host; a worker-mode desktop runs the Worker, which has its own routes");
  // A native addon it requires by a static path, or finds through bindings, node-gyp-build or
  // sharp's loader (one file per target, fetched for the targets a prebuild-install package or sharp
  // didn't install), is carried beside its bundle, listed in a manifest the host copies out of the
  // binary with it (see addons.ts); one it can't carry, or that won't load on a target (`targets`,
  // unset for the dev host), stops the build here.
  const bundleServers = (dir: string, targets?: DesktopOs[]) => step("bundle server", async () => {
    rmSync(join(dir, APP_SERVER_DIR), { recursive: true, force: true });   // a server dropped from the list
    for (const [i, s] of desktopServers(d).entries()) {
      const src = resolve(s.entry);
      if (!existsSync(src)) throw new Error(`desktop.server.entry: ${s.entry} doesn't exist`);
      const outdir = join(dir, APP_SERVER_DIR), name = appServerFile(i);
      const perTarget: TargetLookup[] = [], tree = name.replace(/\.js$/, "-native");
      const r = await Bun.build({ entrypoints: [src], outdir, naming: { entry: name.replace(/\.js$/, ".[ext]"), asset: `${name.replace(/\.js$/, "")}-[name]-[hash].[ext]` }, target: "bun", metafile: true, plugins: [addonLookups(targets ?? [hostTag], perTarget, { tree })], throw: false } as any);
      if (!r.success) throw new Error(`desktop.server ${s.entry}:\n${buildErrors(r)}`);
      const addons = serverAddons(r as any, perTarget);
      const problem = addonProblems(s.entry, addons, outdir, targets ?? null);
      if (problem) throw new Error(problem);
      const carried = [...addons.carried, ...copyTrees(outdir, tree, perTarget)];
      if (carried.length) writeFileSync(join(outdir, addonsManifest(name)), JSON.stringify(carried));
    }
    return join(dir, APP_SERVER_DIR);
  });

  if (opts.noCompile) {
    // Dev host: same bundle pipeline as the binary, minus --compile. Nothing
    // embedded; assets and migrations are read from the working tree.
    const outdir = opts.outdir ?? ".rustybuns/dev";
    if (workers.size) await bundleWorkers(outdir, opts.outdir ? "none" : "linked");
    // The dev host runs here; a Railway box (host "box" without a compile) runs in its linux-x64 container.
    if (d.server) await bundleServers(outdir, host === "box" ? ["linux-x64"] : undefined);
    const r = await step("bundle dev host", () => Bun.build({ entrypoints: [entry], outdir, target: "bun", define: defineMap, plugins, sourcemap: opts.outdir ? "none" : "linked", throw: false } as any));
    await prof?.finish();
    if (!r.success) throw new Error(buildErrors(r));
    if (!opts.outdir) console.log(`dev host: rustybuns run desktop   (= bun .rustybuns/dev/desktop.js)`);
    return `${outdir}/${host}.js`;
  }


  const outs: string[] = [];
  // desktop.native names the crates to embed (all built crates when unset);
  // a named crate that was never built is an error, not a silent TS fallback.
  for (const t of linuxCross) await step(`native ${t} (docker)`, () => buildLinuxNative(t, only));
  // A box built on its own OS and arch (the hosted deploy container, for an x86 box) compiles
  // the crates native/dist lacks with the local cargo, rather than shipping the TS path.
  if (host === "box" && hasRust && targets.includes(hostTag) && Bun.which("cargo")) {
    const missing = (only ?? shippingCrates()).filter((c) => !existsSync(join("native", "dist", c, hostTag)));
    if (missing.length) await step(`native ${hostTag} (cargo)`, () => buildHostNative(hostTag, missing));
  }
  if (only?.length) nativeDirs(only);
  const nativeTags = hasRust ? await step("stage native", () => stageNative(targets, only)) : [];
  const { migrationDirs, mountDirs: projectMounts } = embeddedDirs(c);
  const mountDirs = [...projectMounts, ...(nativeTags.length ? [NATIVE_STAGE] : [])];
  // Embedded dirs are keyed by basename, so two mounts named the same collide.
  const names = [assets, ...migrationDirs, ...mountDirs, ...(d.server ? [APP_SERVER_DIR] : [])].filter(Boolean).map((p) => basename(p!));
  if (new Set(names).size !== names.length) throw new Error(`embedded directories must have distinct basenames: ${names.join(", ")}`);
  // Entrypoints beside .rustybuns/<host>.ts, so the binary has them at $bunfs/root/workers/.
  const workerFiles = workers.size ? await bundleWorkers(".rustybuns", "none") : [];
  // One server bundle per target, in .rustybuns/server/<target>/app-server, so a binary embeds only
  // its own target's addons and sharp tree, not every OS's libvips (#1268). All are bundled before
  // the first compile, so a target an addon won't load on stops the build up front.
  const serverDirs = new Map<DesktopOs, string>();
  if (d.server) for (const t of targets) serverDirs.set(t, await bundleServers(join(".rustybuns", "server", t), [t]));
  // The client build as the binary carries it: no source maps, nothing .assetsignore names, no earlier binaries.
  const embedAssets = assets && existsSync(assets) ? await step("stage assets", async () => {
    const dest = join(".rustybuns", "embed", basename(assets));
    const s = stageAssets(assets, dest, { keepMaps: d.sourceMaps, binaryPrefix: `${c.name}-` });
    const left = [s.maps && `${s.maps} source maps`, s.ignored && `${s.ignored} in .assetsignore`, s.binaries && `${s.binaries} earlier binaries`].filter(Boolean);
    if (left.length) console.log(`[assets] ${s.files} files; left out ${left.join(", ")}${s.maps ? " (desktop.sourceMaps: true keeps maps)" : ""}`);
    return dest;
  }) : assets;
  for (const t of targets) {
    const out = opts.outfile ?? `dist/${c.name}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
    const embed = [embedAssets, ...migrationDirs, ...mountDirs, serverDirs.get(t)].filter(Boolean) as string[];
    const r = await step(`compile ${t}`, () => Bun.build({
      entrypoints: [entry, ...workerFiles],
      outdir: dirname(out),          // Bun.build places compile.outfile under outdir
      compile: { target: `bun-${t}`, outfile: basename(out), ...(embed.length ? { assets: embed } : {}) },
      define: defineMap,
      plugins,
      throw: false,
    } as any));
    if (!r.success) throw new Error(buildErrors(r));
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
  // D1's, and a PGlite twin's (a hyperdrive with a URL set leaves its schema to its origin).
  const migrationDirs = Object.values(c.bindings ?? {}).filter((b) => (b.type === "d1" || (b.type === "hyperdrive" && b.local === "pglite")) && (b as any).migrationsDir).map((b) => (b as any).migrationsDir as string);
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

/**
 * Build native/crates for a Linux target in Docker, into native/dist/<crate>/<target>/,
 * where stageNative() picks them up. Debian bookworm's glibc (2.36) is older than
 * the servers' (Ubuntu 24.04: 2.39), so the .so loads there. The local rustc's
 * version, its own target dir, and a cached cargo registry volume.
 */
export async function buildLinuxNative(target: DesktopOs, only?: string[]): Promise<void> {
  const arch = target === "linux-arm64" ? "arm64" : "amd64";
  const crates = only?.length ? only : shippingCrates();
  if (!crates.length) return;
  const rust = localRust();
  const image = `rust:${rust ? rust + "-" : ""}slim-bookworm`;
  const targetDir = `native/target-${target}`;
  console.log(`[native] building ${crates.join(", ")} for ${target} in ${image} (docker, linux/${arch})`);
  const p = Bun.spawn(["docker", "run", "--rm", "--platform", `linux/${arch}`,
    "-v", `${process.cwd()}/native:/src/native`, "-v", "rustybuns-cargo-registry:/usr/local/cargo/registry", "-w", "/src", image,
    "cargo", "build", "--release", "--manifest-path", "native/Cargo.toml", "--target-dir", targetDir,
    ...crates.flatMap((c) => ["-p", c])], { stdio: ["inherit", "inherit", "inherit"] });
  if (await p.exited !== 0) throw new Error(`the Docker build of native/ for ${target} failed (see above)`);
  const { mkdir, copyFile } = await import("node:fs/promises");
  for (const c of crates) {
    const out = join("native", "dist", c, target);
    await mkdir(out, { recursive: true });
    await copyFile(join(targetDir, "release", `lib${c}.so`), join(out, `lib${c}.so`));
  }
}

/**
 * Build crates with this machine's cargo into native/dist/<crate>/<os-arch>/, as native/build.ts
 * does, for a box built on its own platform. Linux and macOS only: a box is never Windows.
 */
export async function buildHostNative(tag: DesktopOs, crates: string[]): Promise<void> {
  console.log(`[native] building ${crates.join(", ")} for ${tag} with cargo`);
  const p = Bun.spawn(["cargo", "build", "--release", "--manifest-path", "native/Cargo.toml", ...crates.flatMap((c) => ["-p", c])],
    { stdio: ["inherit", "inherit", "inherit"] });
  if (await p.exited !== 0) throw new Error(`cargo build of native/ for ${tag} failed (see above)`);
  const { mkdir, copyFile } = await import("node:fs/promises");
  const ext = tag.startsWith("darwin") ? "dylib" : "so";
  for (const c of crates) {
    const out = join("native", "dist", c, tag);
    await mkdir(out, { recursive: true });
    await copyFile(join("native", "target", "release", `lib${c}.${ext}`), join(out, `lib${c}.${ext}`));
  }
}

/**
 * The crates in native/crates that ship to desktop: all of them, except those whose
 * Cargo.toml says `[package.metadata.rustybuns] desktop = false` (wasm-only, say).
 * The Linux Docker build, the staging, the cross check and the box image use this
 * list when desktop.native doesn't name the crates.
 */
export function shippingCrates(): string[] {
  if (!existsSync("native/crates")) return [];
  return readdirSync("native/crates", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    .filter((name) => {
      const toml = join("native", "crates", name, "Cargo.toml");
      if (!existsSync(toml)) return true;
      const meta = (Bun.TOML.parse(readFileSync(toml, "utf8")) as any)?.package?.metadata?.rustybuns;
      return meta?.desktop !== false;
    });
}

/**
 * The crates a desktop binary would embed: desktop.native when it names some,
 * else every shipping crate already built into native/dist. None without
 * native/Cargo.toml, or with desktop.native: false.
 */
export function desktopCrates(native?: string[] | false): string[] {
  if (native === false || !existsSync("native/Cargo.toml")) return [];
  if (native?.length) return native;
  if (!existsSync("native/dist")) return [];
  const ships = shippingCrates();
  return readdirSync("native/dist", { withFileTypes: true }).filter((e) => e.isDirectory() && ships.includes(e.name)).map((e) => e.name);
}

/** native/dist/<crate> for each embedded crate; loadNative() finds them at /$bunfs/root/<crate>/<os-arch>/. */
export function nativeDirs(names: string[] = []): string[] {
  const missing = names.filter((n) => !existsSync(join("native", "dist", n)));
  if (missing.length) throw new Error(`native crate(s) not built: ${missing.join(", ")}. Run \`bun native/build.ts\` first.`);
  return names.map((n) => join("native", "dist", n));
}
