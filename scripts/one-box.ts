// Many small games on one box, measured (#4056). Builds each game's box host (the Bun bundle Railway runs, the same
// host code a Hetzner box compiles), starts them side by side on this machine, each on its own port and data dir,
// opens rooms of sockets on each, and prints what every game holds in memory idle and with players in. Then the
// cost: an awake Durable Object room billed on Cloudflare, against a share of one box.
//
//   bun scripts/one-box.ts                                       park-hide-seek and git-recon, 4 rooms x 4 sockets
//   bun scripts/one-box.ts hippo-tycoon two-fronts --rooms 8     any apps with a world (a game without one gets no sockets)
//   bun scripts/one-box.ts --no-build                            reuse each app's .rustybuns/railway/ from last time (here, not on the builder)
//   bun scripts/one-box.ts --box-ram 4 --box-price 4.5           the box's GB and monthly price, for games per box
//   bun run builder run . bun scripts/one-box.ts                 the same on the builder (the valve sends builds there)
//
// --rooms N (default 4) and --sockets N (default 4) per game, --hold <s> (default 20) with them open before sampling.
// Memory is the RSS of each host's whole process tree (ps), so a game that spawns a server counts it.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DO_GB, PRICES } from "../packages/cli/src/usage-estimate.ts";
import { help } from "./help.ts";

help(import.meta.path);

const ROOT = resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const flag = (name: string, dflt: number) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : Number(argv[i + 1]); };
const valued = new Set(["--rooms", "--sockets", "--hold", "--box-ram", "--box-price"]);
const apps = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));
if (!apps.length) apps.push("park-hide-seek", "git-recon");
const ROOMS = flag("rooms", 4), SOCKETS = flag("sockets", 4), HOLD_S = flag("hold", 20);
const BOX_GB = flag("box-ram", 0), BOX_PRICE = flag("box-price", 0);

/** Build one app's box bundle into its .rustybuns/railway/, as `rustybuns build box` does for a Railway box. */
async function build(app: string): Promise<void> {
  const code = `import c from "./rustybuns.config.ts";
import { buildRailway } from ${JSON.stringify(join(ROOT, "packages/cli/src/box.ts"))};
c.targets.box = { provider: "railway" };
await buildRailway(c);`;
  const p = Bun.spawn(["bun", "-e", code], { cwd: join(ROOT, "apps", app), stdout: "ignore", stderr: "pipe" });
  if (await p.exited) throw new Error(`${app}: box build failed\n${(await new Response(p.stderr).text()).slice(-1500)}`);
}

/** RSS in MB of a process and everything under it. */
async function treeRssMb(pid: number): Promise<number> {
  const out = await new Response(Bun.spawn(["ps", "-axo", "pid=,ppid=,rss="]).stdout).text();
  const rows = out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);
  const want = new Set([pid]);
  for (let grew = true; grew;) { grew = false; for (const [p, pp] of rows) if (want.has(pp) && !want.has(p)) { want.add(p); grew = true; } }
  return rows.filter(([p]) => want.has(p)).reduce((s, [, , kb]) => s + kb, 0) / 1024;
}

interface Host { app: string; port: number; proc: ReturnType<typeof Bun.spawn>; data: string; worldPath: string | null; sockets: WebSocket[]; opened: number }

async function start(app: string, port: number): Promise<Host> {
  const dir = join(ROOT, "apps", app, ".rustybuns/railway");
  if (!existsSync(join(dir, "box.js"))) throw new Error(`${app}: no ${dir}/box.js; run without --no-build`);
  const config = (await import(join(ROOT, "apps", app, "rustybuns.config.ts"))).default;
  const d = config.targets?.desktop ?? {};
  const worldPath = d.world ? (d.worldPath ?? "/ws") : null;
  const data = mkdtempSync(join(tmpdir(), `one-box-${app}-`));
  const proc = Bun.spawn(["bun", "box.js"], { cwd: dir, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: data, RB_NO_BROWSER: "1" }, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) throw new Error(`${app}: host exited ${proc.exitCode} before /health`);
    const ok = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
    if (ok) return { app, port, proc, data, worldPath, sockets: [], opened: 0 };
    await Bun.sleep(200);
  }
  throw new Error(`${app}: no /health on :${port} after 30 s`);
}

/** Open SOCKETS sockets in each of ROOMS rooms; counts the ones that opened. */
async function fill(h: Host): Promise<void> {
  if (!h.worldPath) return;
  const opens: Promise<void>[] = [];
  for (let r = 0; r < ROOMS; r++) for (let s = 0; s < SOCKETS; s++) {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}${h.worldPath}?room=onebox${r}&name=p${s}`);
    h.sockets.push(ws);
    opens.push(new Promise((ok) => { ws.onopen = () => { h.opened++; ok(); }; ws.onerror = () => ok(); ws.onclose = () => ok(); }));
  }
  await Promise.race([Promise.all(opens), Bun.sleep(10_000)]);
}

const mb = (n: number) => `${n.toFixed(0)} MB`;
const hosts: Host[] = [];
try {
  for (const app of apps) if (!argv.includes("--no-build")) { console.log(`building ${app} ...`); await build(app); }
  // One at a time, as a box would: each host's start-up doesn't skew the other's idle number.
  for (const [i, app] of apps.entries()) hosts.push(await start(app, 4600 + i));
  await Bun.sleep(3000);
  const idle = await Promise.all(hosts.map((h) => treeRssMb(h.proc.pid)));
  await Promise.all(hosts.map(fill));
  await Bun.sleep(HOLD_S * 1000);
  const busy = await Promise.all(hosts.map((h) => treeRssMb(h.proc.pid)));

  console.log(`\n${hosts.length} games on one host (${process.platform}-${process.arch}, Bun ${Bun.version}), ${ROOMS} rooms x ${SOCKETS} sockets each, held ${HOLD_S} s\n`);
  console.log("game                 idle      players in   sockets   per room");
  hosts.forEach((h, i) => {
    const per = h.worldPath && h.opened ? mb((busy[i]! - idle[i]!) / ROOMS) : "-";
    console.log(`${h.app.padEnd(20)} ${mb(idle[i]!).padEnd(9)} ${mb(busy[i]!).padEnd(12)} ${`${h.opened}/${h.worldPath ? ROOMS * SOCKETS : 0}`.padEnd(9)} ${per}`);
  });
  const total = busy.reduce((a, b) => a + b, 0), avg = total / hosts.length;
  console.log(`${"all".padEnd(20)} ${mb(idle.reduce((a, b) => a + b, 0)).padEnd(9)} ${mb(total)}`);

  // Cloudflare bills an awake Durable Object for the 128 MB it is given, whatever it holds.
  const gbS = PRICES.gbS!, roomHourUsd = DO_GB * 3600 * gbS.perMillion / 1e6;
  const includedRoomHours = gbS.included / (DO_GB * 3600);
  console.log(`\nCloudflare: an awake room is ${DO_GB * 1000} MB of DO duration, $${roomHourUsd.toFixed(4)} an hour past the`);
  console.log(`  ${Math.round(includedRoomHours)} room-hours Workers Paid ($5/month) includes; a room open around the clock is $${(roomHourUsd * 720).toFixed(2)} a month.`);
  console.log(`Box: the same rooms cost only their RAM; a game here averages ${mb(avg)} with ${ROOMS} rooms in.`);
  if (BOX_GB > 0) {
    const fit = Math.floor((BOX_GB * 1024 * 0.8) / avg);   // leave a fifth for the OS, the launcher and spikes
    console.log(`  A ${BOX_GB} GB box holds about ${fit} games like these${BOX_PRICE > 0 ? `, ${(BOX_PRICE / Math.max(fit, 1)).toFixed(2)} a game a month at ${BOX_PRICE} a month` : ""}.`);
  }
} finally {
  for (const h of hosts) { for (const ws of h.sockets) ws.close(); h.proc.kill(); rmSync(h.data, { recursive: true, force: true }); }
}
