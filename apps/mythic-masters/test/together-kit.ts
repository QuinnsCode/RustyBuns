// What the two-page journeys share (#3663): a room (scripts/party.ts standing in for the edge, or workerd itself with
// MM_EDGE=workerd), the dev server, one Chrome, and the moves a test drives a page with. The journey is three files
// (together, together-contract, together-lair) so CI can run them in different lanes (#5492): each starts fresh.
// CI's runner draws the open world in software at a frame a second, so there the pages play with `?draw=0` (nothing drawn,
// everything else the same) and the frame-time checks are left to a machine with a GPU (every dev machine and agent).
import { freePort, launchChrome, load, openTab, startVite, type Tab } from "../../../scripts/chrome.ts";
import { serveEdge } from "../scripts/edge.ts";
import { serveParty } from "../scripts/party.ts";

export const CI = !!process.env.CI;
export type Page = Tab;
export type Look = { frameMs: number; online: { status: string; friends: { lead: string; name: string }[] }; hour: number };

/** Ask `get` until `ok` says yes, or fail after `ms`. */
export const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000) => {
  const end = Date.now() + ms;
  for (let v = await get(); !ok(v); v = await get()) { if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(300); }
};
/** A few short hops (a walk the room believes), then the page's view of the room. */
export const walk = (steps: number) => `(async () => { const w = mythicMasters.world, s = w.state(); for (let i = 0; i < ${steps}; i++) { w.teleport(s.x + 3 + i * 0.4, s.z - 6); await new Promise((r) => setTimeout(r, 200)); } return w.online(); })()`;
/** Two seconds of frames: how long one takes, who the page sees, and its hour. */
export const look = `(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); const w = mythicMasters.world; return { frameMs: 2000 / n, online: w.online(), hour: w.state().day.hour }; })()`;
export const settle = "await new Promise((r) => setTimeout(r, 600));";
/** Lands by the campfire 386 m from region 1's first board, as fast travel does (a jump the room vouches for), 10 m off
 *  so it does not rest us there and stop the walk. */
export const board = "mythicMasters.world.teleport(19083, 2025); await new Promise((r) => setTimeout(r, 400));";

/** Walk to `short` metres from (x, z) at 7.5 m a second (a run is 5; the room believes up to 8), a pose every half
 *  second, in legs of at most 30 s (a page answers an eval within a minute). */
export const stride = async (t: Page, x: number, z: number, short: number) => {
  for (let left = Infinity; left > short + 1;) left = await t.eval<number>(`(async () => { const w = mythicMasters.world, s = w.state(); const dx = ${x} - s.x, dz = ${z} - s.z, d = Math.hypot(dx, dz), n = Math.min(60, Math.ceil((d - ${short}) / 3.75));
    for (let i = 1; i <= n; i++) { w.teleport(s.x + (dx * i * 3.75) / d, s.z + (dz * i * 3.75) / d); await new Promise((r) => setTimeout(r, 500)); }
    const e = w.state(); return Math.hypot(${x} - e.x, ${z} - e.z); })()`);
};

/** A room, the dev server and Chrome, for `run`; all stopped after, however it ends. `open(lead)` opens the world in
 *  the room TOGETHER, leading with `lead`; `drop()` stops the room and `up()` brings a new one up on the same port. */
export async function together(run: (t: { open: (lead: string) => Promise<Page>; url: () => string; drop: () => Promise<unknown>; up: () => Promise<void> }) => Promise<void>) {
  const port = await freePort();
  const edge = async (): Promise<{ url: string; stop: () => unknown }> => process.env.MM_EDGE === "workerd" ? serveEdge(port) : serveParty(port);
  let party = await edge();
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const open = async (lead: string) => { const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true); await load(chrome.cdp, t, `${vite.url}/?world=1&a=${lead}&room=TOGETHER${CI ? "&draw=0&quality=low" : ""}`, 4000); return t; };
    await run({ open, url: () => party.url, drop: async () => party.stop(), up: async () => { party = await edge(); } });
  } finally {
    chrome.stop(); vite.stop(); await party.stop();
  }
}

/** Noise on the pages that isn't the dev server's missing favicon or the signed-out account check. */
export const noise = (...pages: Page[]) => pages.flatMap((p) => p.noise).filter((n) => !/favicon|api\/me|401/.test(n));
