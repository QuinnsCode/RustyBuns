// Ask a game what is going on, in text: `bun run probe <app> [path] [--js <expr>]` starts the app's dev server,
// opens it in headless Chrome at a size, waits for the first frames, runs an expression in the page and prints its
// value as JSON, with every uncaught error, console.error and failed request under it. Each game hangs a handle on
// `window` for this (HANDLES below: `mythicMasters.state()`, `twoFronts.state()`, `golf.state()`, ...), and the
// default expression is that game's state. One call where a session used to spend five (tabs, navigate, resize,
// a script, a screenshot) and about a thousand screenshots in 14 days where a number would have done.
//
//   bun run probe mythic-masters "/?a=hodag&b=squonk&skin=stadium"           the fight's state after 3 s
//   bun run probe two-fronts "/?battle=1&world=desert" --js "twoFronts.end('win')"
//   bun run probe alien-disc-golf "/?seed=42" --js "golf.aim(90, 0.8); golf.throw(); await new Promise(r => setTimeout(r, 4000)); golf.state()"
//   bun run probe skate-tech-park "/?level=el-capitan" --shot out.png        a picture, when eyes are needed
//   bun run probe --list                                                     every game's handle and what it does
//
// --size WxH (default 1280x720), --mobile (phone size, touch, 2x), --settle <ms> (default 3000) to wait before the
// expression, --url <http://...> to use a server already running instead of starting one, --shot <file.png>.
// The expression is the body of an async function: `await` works, and its last expression is the answer.
import { resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "./chrome.ts";

/** Each game's handle on `window`, the expression for its state, and the rest of what the handle does. */
export const HANDLES: Record<string, { state: string; does: string }> = {
  "mythic-masters": { state: "mythicMasters.state()", does: "start(a, b, skin?, watch?), hold([codes] | null), camera('lock' | 'side'), world.{enter, state, travel(n), teleport(x, z), beat, reset, trails}, journey.{state, begin([a, b, c]), bind, wear(frac), journal(open), clearTo(n, k)}, gallery(n), director.{state, skip, cut, intro(known, bound, kind), identified(bound)} (cut ends an intro at once; intro plays the foe's case-file intro, identified its first-bind reveal)" },
  "two-fronts": { state: "await twoFronts.state()", does: "jump({ world, side, hero, assist, near, end }), end('win' | 'loss')" },
  "alien-disc-golf": { state: "golf.state()", does: "aim(heading, power, loft?), throw(), guess(...), skipGuess(), splash(lat, lon), paddle(on), steer(...), seaView(on)" },
  "git-recon": { state: "({ scope: __recon.current?.scope, you: __recon.current?.game?.you?.() })", does: "__recon.current (the level: .game, .game.you(), .game.map), look, cam, stepScope; dev builds only, no pointer lock in automation" },
};

export interface Probe { app?: string; path: string; js?: string; size: { w: number; h: number }; mobile: boolean; settle: number; url?: string; shot?: string; list: boolean }

/** The arguments: the app (a folder under apps/), then a path (starts with / or ?), then flags. */
export function parse(argv: string[]): Probe {
  const p: Probe = { path: "/", size: { w: 1280, h: 720 }, mobile: false, settle: 3000, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!, next = () => argv[++i] ?? "";
    if (a === "--list") p.list = true;
    else if (a === "--js") p.js = next();
    else if (a === "--url") p.url = next();
    else if (a === "--shot") p.shot = next();
    else if (a === "--settle") p.settle = Number(next()) || 3000;
    else if (a === "--mobile") { p.mobile = true; p.size = { w: 390, h: 844 }; }
    else if (a === "--size") { const m = /^(\d+)x(\d+)$/.exec(next()); if (m) p.size = { w: Number(m[1]), h: Number(m[2]) }; }
    else if (a.startsWith("/") || a.startsWith("?")) p.path = a.startsWith("?") ? `/${a}` : a;
    else if (!a.startsWith("-") && !p.app) p.app = a;
  }
  if (!p.js && p.app) p.js = HANDLES[p.app]?.state;
  return p;
}

export const MAX_OUT = 4000;
/** The answer as JSON, cut at MAX_OUT characters with a note; `undefined` says so. */
export const show = (v: unknown) => { const s = v === undefined ? "undefined" : JSON.stringify(v, null, 1); return s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n… ${s.length - MAX_OUT} more characters: ask for less` : s; };

export const listLines = () => [...Object.entries(HANDLES).flatMap(([app, h]) => [`${app}: ${h.state}`, `  ${h.does}`]),
  "any page on @rustybuns/util/commands: __commands.list(), await __commands.run(name, args) (its WebMCP tools and Cmd+K palette)"];

if (import.meta.main) {
  const p = parse(process.argv.slice(2));
  if (p.list) { console.log(listLines().join("\n")); process.exit(0); }
  if (!p.app && !p.url) { console.error("usage: bun run probe <app> [path] [--js <expr>] [--shot <file.png>] [--size WxH] [--mobile] [--settle <ms>] [--url <url>] | --list"); process.exit(2); }
  const root = resolve(import.meta.dir, "..");
  const server = p.url ? { url: p.url.replace(/\/?$/, "/"), stop: () => {} } : await startVite(resolve(root, "apps", p.app!));
  const chrome = await launchChrome();
  let code = 0;
  try {
    const tab = await openTab(chrome.cdp, p.size, p.mobile);
    await load(chrome.cdp, tab, new URL(p.path, server.url).href, p.settle);
    if (p.js) {
      try { console.log(show(await tab.eval(`(async () => { ${p.js.includes("return ") ? p.js : `return (${p.js})`} })()`))); }
      catch (e) { console.log(`error: ${(e as Error).message.split("\n")[0]}`); code = 1; }
    }
    if (p.shot) {
      const { data } = await tab.call("Page.captureScreenshot", { format: p.shot.endsWith(".jpg") ? "jpeg" : "png", quality: 80 });
      await Bun.write(p.shot, Buffer.from(data, "base64"));
      console.log(`shot: ${resolve(p.shot)}`);
    }
    if (tab.noise.length) console.log(`noise (${tab.noise.length}):\n  ${[...new Set(tab.noise)].slice(0, 12).join("\n  ")}`);
    await tab.close();
  } finally { chrome.stop(); server.stop(); }
  process.exit(code);
}
