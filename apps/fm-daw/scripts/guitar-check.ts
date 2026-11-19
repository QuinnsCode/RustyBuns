// A friend's guitar across a real WebRTC call, in headless Chrome: `bun scripts/guitar-check.ts [--url http://localhost:5173]`.
// Two of the jam room's guitar lines (src/studio/guitar-line.ts) in one page, their signals handed straight across as the
// World would, one playing a 110 Hz tone as its guitar. The other must hear it within 15 s, louder and fuller (its 3rd
// harmonic up) once that track's amp is on, report a lag, and go silent when muted. Prints what it measured; exit 1 when
// any of that fails. Without --url it serves the app itself on bare vite (the app's own config wants the desktop build).
import { help } from "../../../scripts/help.ts";
import { freePort, launchChrome, load, openTab } from "../../../scripts/chrome.ts";

help(import.meta.path);
const app = new URL("..", import.meta.url).pathname;
const given = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : undefined;

async function serve(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort(), config = `${app}node_modules/.guitar-check.vite.mjs`;
  await Bun.write(config, `export default { root: ${JSON.stringify(app)}, logLevel: "error" };\n`);
  const p = Bun.spawn(["bun", "--bun", "x", "vite", "--config", config, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: app, stdout: "ignore", stderr: "pipe", env: { ...process.env, BROWSER: "none" } });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150 && !(await fetch(url).then((r) => r.ok, () => false)); i++) await Bun.sleep(200);
  return { url, stop: () => p.kill() };
}

/** In the page: A plugs a tone in, B asks for it, and B measures what comes out of its line. */
const JOURNEY = `(async () => {
  const { GuitarLine } = await import("/src/studio/guitar-line.ts");
  const { guitarSettings } = await import("/src/guitar.ts");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ctxA = new AudioContext(), ctxB = new AudioContext();
  await ctxA.resume(); await ctxB.resume();
  const meter = new AnalyserNode(ctxB, { fftSize: 8192 });
  meter.connect(ctxB.destination);
  let a, b;
  a = new GuitarLine(ctxA, (to, line, s) => setTimeout(() => void b.signal({ t: "rtc", from: 1, line, s }), 5));
  b = new GuitarLine(ctxB, (to, line, s) => setTimeout(() => void a.signal({ t: "rtc", from: 2, line, s }), 5), meter);
  const osc = new OscillatorNode(ctxA, { frequency: 110 }), dest = ctxA.createMediaStreamDestination();
  osc.connect(new GainNode(ctxA, { gain: 0.3 })).connect(dest); osc.start();
  await a.plugIn(dest.stream);
  b.ask(1);
  const level = () => { const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length); };
  const db = (hz) => { const d = new Float32Array(meter.frequencyBinCount); meter.getFloatFrequencyData(d); const i = Math.round(hz / (ctxB.sampleRate / meter.fftSize)); return Math.max(d[i - 1], d[i], d[i + 1]); };
  const t0 = performance.now();
  while (level() < 0.005 && performance.now() - t0 < 15000) await wait(100);
  const heardMs = Math.round(performance.now() - t0);
  // why it's silent, when it is: a listener whose clock stands still never rendered; no bytes is the call
  const clock = ctxB.currentTime; await wait(200);
  const inbound = [];
  for (const c of b.calls.values()) (await c.pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp") inbound.push(r.bytesReceived); });
  const why = { ctx: ctxB.state, ticks: ctxB.currentTime > clock, bytesIn: inbound };
  await wait(500);
  const dry = { rms: level(), h3: db(330) - db(110) };
  b.set(1, guitarSettings({ amp: "brit", gain: 9, bass: 5, mid: 5, treble: 6, master: 6, rate: 5, depth: 0 }));
  await wait(1500);
  const amped = { rms: level(), h3: db(330) - db(110) };
  await b.lags(); await wait(1500);
  const lag = (await b.lags()).get(1) ?? null;
  b.level(1, 0); await wait(400);
  return { calls: [...a.state(), ...b.state()], heardMs, why, dry, amped, lag, muted: level() };
})()`;

const server = given ? { url: given.replace(/\/$/, ""), stop: () => {} } : await serve();
// Chrome's stand-in speakers: they render in real time with no sound card, so the listener never waits on whatever this
// Mac plays to (an asleep Bluetooth or AirPlay output stalls the AudioContext and the meter reads 0, #5278)
const chrome = await launchChrome(["--disable-audio-output"]);
let ok = false;
try {
  const tab = await openTab(chrome.cdp, { w: 640, h: 480 });
  await load(chrome.cdp, tab, `${server.url}/amp.html`, 1000);
  // a user gesture, so the page's audio may start
  const res = await tab.call("Runtime.evaluate", { expression: JOURNEY, returnByValue: true, awaitPromise: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  const r = res.result.value;
  const checks: [string, boolean][] = [
    ["both ends connected", r.calls.length === 2 && r.calls.every((c: { state: string }) => c.state === "connected")],
    ["heard within 15 s", r.heardMs < 15000 && r.dry.rms > 0.005],
    ["the amp drives it: its 3rd harmonic up 10 dB or more", r.amped.h3 - r.dry.h3 >= 10],
    ["a lag", typeof r.lag === "number"],
    ["silent when muted", r.muted < 0.001],
    ["no page errors", tab.noise.length === 0],
  ];
  console.log(JSON.stringify(r));
  for (const [what, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${what}`);
  if (tab.noise.length) console.log(tab.noise.join("\n"));
  ok = checks.every(([, pass]) => pass);
} finally { chrome.stop(); server.stop(); }
process.exit(ok ? 0 : 1);
