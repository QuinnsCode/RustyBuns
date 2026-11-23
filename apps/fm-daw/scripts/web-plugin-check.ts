// A web plugin on a track, in the real desk with real sound, in headless Chrome: `bun scripts/web-plugin-check.ts [--url http://localhost:5173]`.
// Starts the desk's audio, puts FM DAW's own Web Audio Module (Test Tone, src/wam/tone.ts) on the selected track and holds a key:
// it must be heard at the output, and not with the key let go or the track muted. Then a plugin from another site:
// it must stay silent and ask first, and load and play once the player says yes (the "other site" is this same server
// under its other name, localhost against 127.0.0.1; a built page serves no source, so a copy built here and served
// beside it). Then a bounce of the track, and its sound on the sesh's live line. Then the track back on its FM voice
// with an effect in its Insert (#5359, FM DAW's own Gain): as loud as dry at Gain 1, half at 0.5, dry again once it's
// off, and an instrument isn't taken as an effect. Then the bounce with the effect in it (#5551: half at 0.5), and
// a web plugin track (Test Tone) with Gain in its Insert, heard and bounced at half, and panned hard left it is silent
// on the right, live and bounced (#5617), and a deep low cut on its Shape takes it down live as in its bounce (#5641). Prints what it measured; exit 1 when
// any of that fails. A built page: build the app, `bunx vite preview --outDir dist/client`, then `--url` that.
// Without --url it serves the app on its own dev server, which needs .rustybuns/vite.ts (`bunx rustybuns boundary`
// here writes it).
import { help } from "../../../scripts/help.ts";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { paramId } from "../src/ui/wam.ts";

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
  // an effect on an FM track's sound: out of the engine, through the module, back in. Keys (the 7 key picks it)
  // holds a note as long as the key is down, where a drum has died away before the meter reads it
  fmdaw.plays(T, null);
  await until(() => plays() === "fm");
  for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { code: "Digit7", bubbles: true }));
  await until(() => fmdaw.state().selected === 6);
  const K = fmdaw.state().selected;
  const fx = () => fmdaw.state().tracks[K].insert;
  const hold = async () => { key("keydown"); const p = await peak(); key("keyup"); await wait(600); return p; };
  const dry = await hold();
  const gain = (values) => ({ path: "builtin:gain", index: 0, name: "Gain (web)", web: true, values });
  fmdaw.insert(K, gain([]));
  const fxOn = await wait(300).then(() => until(() => fx()?.starting === false));
  const fxError = fx()?.error ?? null, fxSliders = fx()?.sliders ?? [];
  const whole = await hold();
  fmdaw.insert(K, gain([{ id: ${paramId("gain")}, v: 0.5 }]));
  await wait(200);
  const half = await hold();
  fmdaw.insert(K, { path: "builtin:tone", index: 0, name: "Test Tone (web)", web: true, values: [] });
  await wait(300).then(() => until(() => fx()?.starting === false));
  const refused = fx()?.error ?? null, refusedHeld = await hold();
  fmdaw.insert(K, null);
  await wait(200);
  const back = await hold();
  // the bounce has the effect in it (#5551): the track alone holding a note, dry, through Gain at 1, then at 0.5
  const fxReady = () => wait(300).then(() => until(() => fx()?.starting === false));
  const bDry = await fmdaw.mix(K, 2);
  fmdaw.insert(K, gain([]));
  await fxReady();
  const bWhole = await fmdaw.mix(K, 2);
  fmdaw.insert(K, gain([{ id: ${paramId("gain")}, v: 0.5 }]));
  await wait(200);
  const bHalf = await fmdaw.mix(K, 2);
  fmdaw.insert(K, null);
  await wait(200);
  // a web plugin track has an Insert too: Test Tone through Gain at 0.5, heard and bounced at half
  fmdaw.plays(K, { path: "builtin:tone", index: 0, name: "Test Tone (web)", web: true, values: [] });
  await wait(300).then(() => until(() => fmdaw.state().tracks[K].plays.path === "builtin:tone" && fmdaw.state().tracks[K].plays.starting === false));
  const pDry = await hold(), pbDry = await fmdaw.mix(K, 2);
  fmdaw.insert(K, gain([{ id: ${paramId("gain")}, v: 0.5 }]));
  const pOn = await fxReady();
  const pFxError = fx()?.error ?? null, pHalf = await hold(), pbHalf = await fmdaw.mix(K, 2);
  fmdaw.insert(K, null);
  await wait(200);
  const pBack = await hold();
  // PAN on a web plugin track (#5617): hard left, it is silent on the right, live and bounced
  fmdaw.pan(K, -1);
  await wait(200);
  key("keydown");
  await wait(700);
  const leftLive = fmdaw.state().sides;
  key("keyup");
  await wait(600);
  const leftBounce = await fmdaw.mix(K, 2);
  fmdaw.pan(K, 0);
  // its Shape (#5641): a deep low cut above Test Tone's 440 Hz leaves it as quiet live as in its bounce
  await wait(200);
  const cutDry = await hold();
  fmdaw.shape(K, [{ kind: "lowCut", f: 4000, g: 0, q: 0.7, slope: 48, on: true }, null, null, null, null, null, null, null]);
  await wait(300);
  const cutLive = await hold(), cutBounce = await fmdaw.mix(K, 2);
  fmdaw.shape(K, Array(8).fill(null));
  fmdaw.plays(K, null);
  const bounce = { dry: bDry, whole: bWhole, half: bHalf };
  const plugin = { on: pOn, error: pFxError, dry: pDry, half: pHalf, back: pBack, bDry: pbDry, bHalf: pbHalf, leftLive, leftBounce, cutDry, cutLive, cutBounce };
  const insert = { track: K, fxOn, fxError, fxSliders, dry, whole, half, refused, refusedHeld, back, bounce, plugin };
  return { track: T, audio: fmdaw.state().audio, started, error, sliders, idle, held, muted, released, asked, unasked, trusted, after, heldOther, bounced, line, insert };
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
    ["the FM track sounds dry", r.insert.dry > 0.005],
    ["Gain starts in the Insert, with its Gain slider", r.insert.fxOn && !r.insert.fxError && r.insert.fxSliders.some((s: { name: string }) => s.name === "Gain")],
    ["through Gain at 1 it is as loud as dry (not lost, not doubled)", near(r.insert.whole / r.insert.dry, 1, 0.15)],
    ["Gain at 0.5 halves it", near(r.insert.half / r.insert.whole, 0.5, 0.1)],
    ["an instrument in the Insert is refused, and the track plays dry", typeof r.insert.refused === "string" && near(r.insert.refusedHeld / r.insert.dry, 1, 0.15)],
    ["with the Insert off it is dry again", near(r.insert.back / r.insert.dry, 1, 0.15)],
    ["a bounce leaves nothing out", [r.insert.bounce.dry, r.insert.bounce.whole, r.insert.bounce.half].every((b: { missed: string[] }) => b.missed.length === 0)],
    ["a bounce through Gain at 1 is as loud as dry", r.insert.bounce.dry.l > 0.002 && near(r.insert.bounce.whole.l / r.insert.bounce.dry.l, 1, 0.1)],
    ["Gain at 0.5 in a bounce halves it", near(r.insert.bounce.half.l / r.insert.bounce.whole.l, 0.5, 0.05)],
    ["a web plugin track's Insert starts", r.insert.plugin.on && !r.insert.plugin.error],
    ["a web plugin track through Gain at 0.5 is heard at half", r.insert.plugin.dry > 0.02 && near(r.insert.plugin.half / r.insert.plugin.dry, 0.5, 0.1)],
    ["and with its Insert off, dry again", near(r.insert.plugin.back / r.insert.plugin.dry, 1, 0.15)],
    ["its bounce is at half too", r.insert.plugin.bHalf.missed.length === 0 && r.insert.plugin.bDry.l > 0.002 && near(r.insert.plugin.bHalf.l / r.insert.plugin.bDry.l, 0.5, 0.05)],
    ["a web plugin track panned hard left is heard on the left and silent on the right", r.insert.plugin.leftLive.l > 0.02 && r.insert.plugin.leftLive.r < 0.05 * r.insert.plugin.leftLive.l],
    ["and its bounce too", r.insert.plugin.leftBounce.l > 0.002 && r.insert.plugin.leftBounce.r < 0.01 * r.insert.plugin.leftBounce.l],
    ["a web plugin track's Shape is heard live: a deep low cut takes it down", r.insert.plugin.cutDry > 0.02 && r.insert.plugin.cutLive < 0.1 * r.insert.plugin.cutDry],
    ["as its bounce has it", r.insert.plugin.cutBounce.l < 0.1 * r.insert.plugin.bDry.l],
    ["no page errors", noise.length === 0],
  ];
  console.log(JSON.stringify(r));
  for (const [what, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${what}`);
  if (noise.length) console.log(noise.join("\n"));
  ok = checks.every(([, pass]) => pass);
} finally { chrome.stop(); server.stop(); away.stop(); }
process.exit(ok ? 0 : 1);

function near(x: number, want: number, by: number) { return Number.isFinite(x) && Math.abs(x - want) <= by; }

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
