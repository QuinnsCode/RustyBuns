// A DJ's set over the room's PA across a real WebRTC call, in headless Chrome: `bun scripts/pa-check.ts [--url http://localhost:5173]`.
// Two of the jam room's PA lines (src/studio/pa-line.ts) in one page, their signals handed straight across as the World
// would. A plays a set in stereo (220 Hz on the left, 330 Hz on the right); B hears that A is on air and asks. B must
// hear it within 15 s with each channel where it was played (stereo kept), go silent when muted and come back, go
// silent when A goes off air, and hear A again when A comes back on. Prints what it measured; exit 1 when any of that
// fails. Without --url it serves the app itself on bare vite.
import { help } from "../../../scripts/help.ts";
import { freePort, launchChrome, load, openTab } from "../../../scripts/chrome.ts";

help(import.meta.path);
const app = new URL("..", import.meta.url).pathname;
const given = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : undefined;

async function serve(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort(), config = `${app}node_modules/.pa-check.vite.mjs`;
  await Bun.write(config, `export default { root: ${JSON.stringify(app)}, logLevel: "error" };\n`);
  const p = Bun.spawn(["bun", "--bun", "x", "vite", "--config", config, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: app, stdout: "ignore", stderr: "pipe", env: { ...process.env, BROWSER: "none" } });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150 && !(await fetch(url).then((r) => r.ok, () => false)); i++) await Bun.sleep(200);
  return { url, stop: () => p.kill() };
}

/** In the page: A goes on air with a stereo tone, B asks for it, and B measures each ear of what comes out. */
const JOURNEY = `(async () => {
  const { PaLine } = await import("/src/studio/pa-line.ts");
  const { STUN } = await import("/src/guitar.ts");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ctxA = new AudioContext(), ctxB = new AudioContext();
  await ctxA.resume(); await ctxB.resume();
  // B's ears: the set split into left and right, a meter on each
  const into = new GainNode(ctxB), split = ctxB.createChannelSplitter(2);
  const ear = [0, 1].map(() => new AnalyserNode(ctxB, { fftSize: 8192, smoothingTimeConstant: 0 }));
  into.connect(split); split.connect(ear[0], 0); split.connect(ear[1], 1);
  into.connect(ctxB.destination);
  const ice = async () => STUN;
  let a, b;
  a = new PaLine(ctxA, ctxA.destination, (to, line, s) => setTimeout(() => void b.signal({ t: "rtc", from: 1, line, s }), 5), ice);
  b = new PaLine(ctxB, into, (to, line, s) => setTimeout(() => void a.signal({ t: "rtc", from: 2, line, s }), 5), ice);
  // the set: 220 Hz left, 330 Hz right
  const merge = ctxA.createChannelMerger(2), dest = ctxA.createMediaStreamDestination();
  dest.channelCount = 2;
  for (const [hz, ch] of [[220, 0], [330, 1]]) { const o = new OscillatorNode(ctxA, { frequency: hz }); o.connect(new GainNode(ctxA, { gain: 0.3 })).connect(merge, 0, ch); o.start(); }
  merge.connect(dest);
  const level = () => { const d = new Float32Array(8192); let m = 0; for (const e of ear) { e.getFloatTimeDomainData(d); m = Math.max(m, Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)); } return m; };
  const db = (side, hz) => { const e = ear[side], d = new Float32Array(e.frequencyBinCount); e.getFloatFrequencyData(d); const i = Math.round(hz / (ctxB.sampleRate / e.fftSize)); return Math.max(d[i - 1], d[i], d[i + 1]); };
  const until = async (f, ms = 15000) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await wait(100); return Math.round(performance.now() - t0); };

  a.start(dest.stream);
  b.heardSay(1, true, "Test set");
  const heardMs = await until(() => level() > 0.005);
  await wait(800);
  const ears = { left: { lo: db(0, 220), hi: db(0, 330) }, right: { lo: db(1, 220), hi: db(1, 330) } };
  const calls = [...a.state().calls, ...b.state().calls];
  b.level(1, 0); await wait(500);
  const muted = level();
  b.level(1, 1); await until(() => level() > 0.005, 3000);
  const back = level();
  // off air: A hangs up and B lets it go
  a.stop(); b.heardSay(1, false); await wait(800);
  const off = level();
  // and on again: the same as the first time
  a.start(dest.stream); b.heardSay(1, true, "Test set");
  const againMs = await until(() => level() > 0.005);
  return { calls, heardMs, ears, muted, back, off, againMs, again: level(), b: b.state() };
})()`;

const server = given ? { url: given.replace(/\/$/, ""), stop: () => {} } : await serve();
const chrome = await launchChrome(["--disable-audio-output"]);
let ok = false;
try {
  const tab = await openTab(chrome.cdp, { w: 640, h: 480 });
  await load(chrome.cdp, tab, `${server.url}/amp.html`, 1000);
  const res = await tab.call("Runtime.evaluate", { expression: JOURNEY, returnByValue: true, awaitPromise: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  const r = res.result.value;
  const checks: [string, boolean][] = [
    ["both ends connected", r.calls.length === 2 && r.calls.every((c: { state: string }) => c.state === "connected")],
    ["heard within 15 s", r.heardMs < 15000],
    ["stereo kept: 220 Hz left, 330 Hz right, each 20 dB over the other side's", r.ears.left.lo - r.ears.left.hi >= 20 && r.ears.right.hi - r.ears.right.lo >= 20],
    ["silent when muted, back when not", r.muted < 0.001 && r.back > 0.005],
    ["silent off air", r.off < 0.001],
    ["heard again back on air", r.againMs < 15000 && r.again > 0.005],
    ["no page errors", tab.noise.length === 0],
  ];
  console.log(JSON.stringify(r));
  for (const [what, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${what}`);
  if (tab.noise.length) console.log(tab.noise.join("\n"));
  ok = checks.every(([, pass]) => pass);
} finally { chrome.stop(); server.stop(); }
process.exit(ok ? 0 : 1);
