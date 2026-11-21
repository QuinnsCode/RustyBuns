// A web plugin on a track, in the real desk with real sound, in headless Chrome: `bun scripts/web-plugin-check.ts [--url http://localhost:5173]`.
// Starts the desk's audio, puts FM DAW's own Web Audio Module (Test Tone, src/wam/tone.ts) on the selected track and holds a key:
// it must be heard at the output, and not with the key let go or the track muted. Then a plugin from another site:
// it must stay silent and ask first, and load and play once the player says yes (the "other site" is this same server
// under its other name, localhost against 127.0.0.1; a built page serves no source, so a copy built here and served
// beside it). Then a bounce of the track, and its sound on the sesh's live line. Prints what it measured; exit 1 when
// any of that fails. A built page: build the app, `bunx vite preview --outDir dist/client`, then `--url` that.
// Without --url it serves the app on its own dev server, which needs .rustybuns/vite.ts (`bunx rustybuns boundary`
// here writes it).
import { help } from "../../../scripts/help.ts";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

help(import.meta.path);
const app = new URL("..", import.meta.url).pathname;
const given = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : undefined;

const server = given ? { url: given.replace(/\/$/, "") + "/", stop: () => {} } : await startVite(app);
// the "other site" serves Test Tone: the dev server has its source; a built page has none, so a copy built here,
// served from a server of its own on the page's other name (localhost against 127.0.0.1)
const away = await otherSite(server.url);

const JOURNEY = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (f()) return true; await wait(100); } return false; };
  const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: "KeyA", bubbles: true }));
  const T = fmdaw.state().selected;   // the track the keys play
  const plays = () => fmdaw.state().tracks[T].plays;
  const ready = (path) => wait(300).then(() => until(() => plays().path === path && plays().starting === false));
  const peak = async () => { await wait(700); return fmdaw.state().out; };
  await fmdaw.start();
  await until(() => fmdaw.state().audio === "running");
  fmdaw.plays(T, { path: "builtin:tone", index: 0, name: "Test Tone (web)", web: true, values: [] });
  const started = await ready("builtin:tone");
  const sliders = plays().sliders, error = plays().error;
  const idle = await peak();
  key("keydown");
  const held = await peak();
  fmdaw.mute(T, true);
  const muted = await peak();
  fmdaw.mute(T, false);
  key("keyup");
  const released = await peak();
  // the same module from "another site": this server under its other name
  const other = ${JSON.stringify(away.url)};
  fmdaw.plays(T, { path: other, index: 0, name: "tone", web: true, values: [] });
  await ready(other);
  const asked = { site: plays().site, error: plays().error };
  key("keydown");
  const unasked = await peak();
  key("keyup");
  fmdaw.trust(T);
  const trusted = await until(() => plays().starting === false && !plays().site);
  const after = { error: plays().error, sliders: plays().sliders };
  key("keydown");
  const heldOther = await peak();
  key("keyup");
  // the bounce: a copy of its own on an offline context, a key held for the first half of a second
  const bounced = await fmdaw.bounce(T, 1);
  // the sesh's live line, as going online turns it on: the track's own sound goes out
  fmdaw.line(T, true);
  key("keydown");
  await wait(700);
  const line = fmdaw.state().line[T] ?? 0;
  key("keyup");
  fmdaw.line(T, false);
  return { track: T, audio: fmdaw.state().audio, started, error, sliders, idle, held, muted, released, asked, unasked, trusted, after, heldOther, bounced, line };
})()`;

// Chrome's stand-in speakers, as scripts/guitar-check.ts: real time with no sound card (#5278)
const chrome = await launchChrome(["--disable-audio-output"]);
let ok = false;
try {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  await load(chrome.cdp, tab, server.url, 3000);
  // a user gesture, so the page's audio may start
  const res = await tab.call("Runtime.evaluate", { expression: JOURNEY, returnByValue: true, awaitPromise: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  const r = res.result.value;
  // off the desktop the page asks a host that isn't there for CLAP plugins: that 404 is the browser page working
  const noise = tab.noise.filter((n: string) => !n.includes("/__rb/action"));
  const checks: [string, boolean][] = [
    ["the audio runs", r.audio === "running"],
    ["Test Tone starts, with its Level slider", r.started && !r.error && r.sliders.some((s: { name: string }) => s.name === "Level")],
    ["silent with no key down", r.idle < 0.001],
    ["a held key is heard on the master", r.held > 0.02],
    ["silent with the track muted", r.muted < 0.001],
    ["silent again once the key is up", r.released < 0.001],
    ["a plugin from another site asks first, and is silent", typeof r.asked.site === "string" && r.unasked < 0.001],
    ["after a yes it loads and plays", r.trusted && !r.after.error && r.heldOther > 0.02],
    ["a bounce has it: heard with the key held, silent after", !r.bounced.error && r.bounced.held > 0.02 && r.bounced.after < 0.001],
    ["the sesh's live line carries it", r.line > 0.01],
    ["no page errors", noise.length === 0],
  ];
  console.log(JSON.stringify(r));
  for (const [what, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${what}`);
  if (noise.length) console.log(noise.join("\n"));
  ok = checks.every(([, pass]) => pass);
} finally { chrome.stop(); server.stop(); away.stop(); }
process.exit(ok ? 0 : 1);

/** Test Tone at the page's other name: the dev server's own source, or (a built page) a copy built and served here. */
async function otherSite(page: string): Promise<{ url: string; stop: () => void }> {
  const u = new URL(page), name = u.hostname === "localhost" ? "127.0.0.1" : "localhost";
  const src = new URL("src/wam/tone.ts", u);
  if ((await fetch(src).catch(() => null))?.headers.get("content-type")?.includes("javascript")) { src.hostname = name; return { url: src.href, stop: () => {} }; }
  const built = await Bun.build({ entrypoints: [app + "src/wam/tone.ts"], target: "browser", format: "esm" });
  const out = built.outputs[0];
  if (!built.success || !out) throw new Error(`Test Tone wouldn't build: ${built.logs.join("\n")}`);
  const code = await out.text();
  const srv = Bun.serve({ port: 0, hostname: name, fetch: () => new Response(code, { headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" } }) });
  return { url: `http://${name}:${srv.port}/tone.js`, stop: () => srv.stop(true) };
}
