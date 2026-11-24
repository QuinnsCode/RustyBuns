// Is what this office is running still what's on disk? The rebuild (office:mama, office:update --watch) rewrites
// the page scripts and the server bundles under ./office while the office keeps serving the old ones.
//   page    changes when a page script or the skin does: open pages refresh (reload/index.ts)
//   stale   true once the server bundles on disk differ from the ones this process started with: it has to restart
//   workers true once bin/rb-triage.js (the workers' MCP server, a separate process per Claude session) differs from
//           the one at start: the office is fine, the workers have to reconnect to get the new tools
// Served at /__rb/reload (triage/server.ts). A restart is a SIGTERM, which upstream treats as a restart that keeps
// the workers; only something that starts the office again (office:mama) makes that a restart, not a stop.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReloadState } from "./replies.ts";

const SCRIPT = /^(rb-(?!chunk-|reload-)[a-z]+)-\w+\.js$/;

/** A hash of every file in `dir` whose name starts with `rb-` (or is in `extra`), by name and content; re-read only when its size or mtime moves. */
export function fingerprint(dir: string, extra: string[] = []) {
  const seen = new Map<string, { key: string; hash: string }>();
  return () => {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("rb-") || extra.includes(f)).sort() : [];
    return files.map((f) => {
      const file = path.join(dir, f), st = statSync(file), key = `${st.size}:${st.mtimeMs}`;
      let c = seen.get(f);
      if (c?.key !== key) seen.set(f, c = { key, hash: Bun.hash(readFileSync(file)).toString(36) });
      return `${f}:${c.hash}`;
    }).join(",");
  };
}

/** How long one look at the folders answers every page's poll (each open page asks every 2.5 s; #5762). */
export const RELOAD_TTL_MS = 2000;

/** `pub` is dist/public, `srv` the server bundles, `bin` the dir holding bin/rb-triage.js; `restart` is what a restart does (SIGTERM, in the office). */
export function officeReload(pub: string, srv: string, bin: string, canRestart: boolean, restart: () => void, ttl = RELOAD_TTL_MS) {
  const assets = path.join(pub, "assets");
  const page = fingerprint(assets);
  const skin = fingerprint(path.join(pub, "druids"), ["druids.js"]);
  const server = fingerprint(srv);
  const mcp = fingerprint(bin);
  const boot = `${Date.now().toString(36)}-${process.pid}`;
  const started = server(), mcpStarted = mcp();
  const look = (): ReloadState => {
    const p = page(), k = skin();
    // names are hashed, so the file name stands for a script's content; everything else under assets/rb- is fixed
    const files = p.split(",").filter(Boolean), swap: Record<string, string> = {};
    for (const f of files) { const name = f.slice(0, f.lastIndexOf(":")), m = SCRIPT.exec(name); if (m) swap[m[1]!] = name; }
    const fixed = Bun.hash(files.filter((f) => !SCRIPT.test(f.slice(0, f.lastIndexOf(":")))).join(",") + k).toString(36);
    return { boot, page: Bun.hash(p + k).toString(36), swap, fixed, stale: server() !== started, workers: mcp() !== mcpStarted, canRestart };
  };
  let last: { at: number; state: ReloadState } | undefined;
  return {
    state: (): ReloadState => {
      const now = Date.now();
      if (!last || now - last.at >= ttl) last = { at: now, state: look() };
      return last.state;
    },
    restart: () => (canRestart ? (setTimeout(restart, 200), true) : false),
  };
}
