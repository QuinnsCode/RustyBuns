// The edge for walking together under workerd itself (#3706): `wrangler dev` runs src/edge/worker.ts and its Region
// Durable Objects with the real hibernation API, the ping auto-response, real upgrades and a real fetch to eqosys's
// JWKS. scripts/party.ts is the quick Bun stand-in with a meter on every room (the cost model's); this is the one that
// shows what only the runtime can, such as a Worker module the runtime refuses to start. Nothing here deploys.
//
//   bun scripts/edge.ts           serves /ws on :8790 with guests let in; `bun run dev` proxies the page's /ws here
//
// The page is served by vite (or not at all), so the assets directory only has to exist.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort } from "../../../scripts/chrome.ts";

const APP = new URL("..", import.meta.url).pathname;

/** The wrangler this app pins (package.json), or undefined before `bun install`. */
export const wranglerPath = () => Bun.which("wrangler", { PATH: join(APP, "node_modules", ".bin") }) ?? undefined;

export interface EdgeOpts {
  /** `false` is the live door: every join needs an eqosys token. */
  guests?: boolean;
  /** The eqosys whose JWKS the Worker checks tokens against (a test's own). */
  eqosys?: string;
  /** How long a seat may go without a ping before the room closes it (the Region's DEAD_MS, 90 s live). */
  deadMs?: number;
}

export interface Edge {
  url: string;
  /** What wrangler and the Worker have printed so far (the Region logs `region up with N seats` each time it is built). */
  log: () => string;
  stop: () => Promise<void>;
}

/** Start `wrangler dev` on `port` (a free one by default) and resolve once it is ready to take sockets. */
export async function serveEdge(port = 0, o: EdgeOpts = {}): Promise<Edge> {
  const bin = wranglerPath();
  if (!bin) throw new Error("no wrangler: run bun install");
  port ||= await freePort();
  mkdirSync(join(APP, "dist", "ui"), { recursive: true });
  const state = mkdtempSync(join(tmpdir(), "mm-edge-"));
  const vars: Record<string, string> = { LOG_WAKES: "1" };
  if (o.guests !== false) vars.GUESTS = "1";
  if (o.eqosys) vars.EQOSYS_URL = o.eqosys;
  if (o.deadMs) vars.DEAD_MS = String(o.deadMs);
  const args = ["dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", state, "--show-interactive-dev-session=false"];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const proc = Bun.spawn([bin, ...args], { cwd: APP, stdout: "pipe", stderr: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" } });
  let out = "";
  const read = async (s: ReadableStream<Uint8Array>) => { const r = s.getReader(), d = new TextDecoder(); for (let c = await r.read(); !c.done; c = await r.read()) out += d.decode(c.value, { stream: true }); };
  void read(proc.stdout); void read(proc.stderr);
  const stop = async () => { proc.kill(); await proc.exited; rmSync(state, { recursive: true, force: true }); };
  const end = Date.now() + 60_000;
  while (!/Ready on http/.test(out)) {
    if (proc.exitCode !== null || Date.now() > end || /ERROR/.test(out)) { await stop(); throw new Error(`wrangler dev didn't start:\n${out.slice(-2000)}`); }
    await Bun.sleep(100);
  }
  return { url: `ws://127.0.0.1:${port}`, log: () => out, stop };
}

if (import.meta.main) {
  const e = await serveEdge(Number(process.argv[2]) || 8790);
  console.log(`walking together under workerd: ${e.url}/ws (open the world with ?room=TEST1 in two tabs of \`bun run dev\`)`);
  process.on("SIGINT", () => void e.stop().then(() => process.exit(0)));
}
