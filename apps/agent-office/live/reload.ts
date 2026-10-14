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

export interface ReloadState { boot: string; page: string; stale: boolean; workers: boolean; canRestart: boolean }

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

/** `pub` is dist/public, `srv` the server bundles, `bin` the dir holding bin/rb-triage.js; `restart` is what a restart does (SIGTERM, in the office). */
export function officeReload(pub: string, srv: string, bin: string, canRestart: boolean, restart: () => void) {
  const page = fingerprint(path.join(pub, "assets"));
  const skin = fingerprint(path.join(pub, "druids"), ["druids.js"]);
  const server = fingerprint(srv);
  const mcp = fingerprint(bin);
  const boot = `${Date.now().toString(36)}-${process.pid}`;
  const started = server(), mcpStarted = mcp();
  return {
    state: (): ReloadState => ({ boot, page: Bun.hash(page() + skin()).toString(36), stale: server() !== started, workers: mcp() !== mcpStarted, canRestart }),
    restart: () => (canRestart ? (setTimeout(restart, 200), true) : false),
  };
}
