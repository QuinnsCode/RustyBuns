// The page: a canvas tunnel you run down, four thumb pads, a HUD, and a menu. The sim
// (sim.ts) decides everything; this file draws it and turns thumbs and keys into presses.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { Music } from "./audio.ts";
import { burst, drawTunnel, echoBursts, LANE_X, sway, view, type Burst } from "./hallway.ts";
import { drawRunner } from "./runner.ts";
import { fromSearch, runOf, Scenario, toSearch } from "./scenario.ts";
import { advance, createRun, delayWords, dueLanes, knockback, LEVELS, makeChart, press, runnerX, type Judgement, type Lane, type Run } from "./sim.ts";
const KEYS: Record<string, Lane> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

const stage = document.getElementById("stage") as HTMLCanvasElement;
const g = stage.getContext("2d")!;
const hud = { score: el("score"), combo: el("combo"), judge: el("judge"), lives: el("lives") };
const menu = el("menu"), levels = el("levels"), pads = [...document.querySelectorAll<HTMLButtonElement>(".pad")];

// The game has no mouse or drag look, so the cog's look speeds scale how far the tunnel's view sways (X across, Y up and down).
let ctl = { ...DEFAULTS };
let paused = false; // the Controls dialog is open: the run waits and the music holds
let music: Music | null = null;
let run: Run | null = null;
let best: Record<number, number> = {};
try { best = JSON.parse(localStorage.getItem("delayed-reaction.best") ?? "{}"); } catch { best = {}; }
const bursts: Burst[] = [];
const down = new Set<Lane>();
let judgeUntil = 0;
let missBeat: number | undefined; // the runner stumbles on the beat after a miss
let passBeat: number | undefined; // and dives shoulder-first through the door on a hit

// ?level=5&beat=40&speed=2&delay=8&bpm=140&hint=0&lane=3 lands in that state; a tap starts it (audio needs a tap).
const asked = fromSearch(location.search);

function el(id: string) { return document.getElementById(id)!; }

// ---- menu ----
function showMenu(result?: Run) {
  levels.replaceChildren();
  if (result) {
    const p = document.createElement("p");
    p.className = "result";
    p.textContent = result.over === "won"
      ? `Level ${result.chart.level}: ${result.score} points, ${result.perfects} perfect, best combo ${result.maxCombo}.`
      : `Lost it at bar ${Math.floor(result.beat / 4)}: ${result.score} points.`;
    levels.append(p);
  }
  LEVELS.forEach((spec, i) => {
    const b = document.createElement("button");
    const n = i + 1;
    b.innerHTML = `<b>${n}</b> ${spec.bpm} bpm · ${delayWords(spec.delay)}${best[n] ? ` · best ${best[n]}` : ""}`;
    b.addEventListener("click", () => start(n));
    levels.append(b);
  });
  if (asked) {
    const b = document.createElement("button");
    b.id = "scenario";
    b.innerHTML = `<b>Go</b> ${toSearch(asked)}`;
    b.addEventListener("click", () => start(asked.level, asked));
    levels.prepend(b);
  }
  menu.hidden = false;
}

async function start(level: number, scene?: Scenario) {
  menu.hidden = true;
  music ??= new Music();
  const made = scene ? runOf(scene) : null;
  const chart = made?.chart ?? makeChart(level);
  run = made?.run ?? createRun(chart);
  el("delay-words").textContent = delayWords(chart.delay);
  hud.judge.textContent = chart.hint ? `Answer on the echo, ${delayWords(chart.delay)}` : `Answer ${delayWords(chart.delay)}, no echo now`;
  judgeUntil = performance.now() + 2500;
  await music.play(chart, scene?.beat);
}

function finish() {
  if (!run || !music) return;
  const r = run;
  run = null;
  music.stop();
  if (r.over === "won" && r.score > (best[r.chart.level] ?? 0)) {
    best[r.chart.level] = r.score;
    try { localStorage.setItem("delayed-reaction.best", JSON.stringify(best)); } catch {}
  }
  pads.forEach((p) => p.classList.remove("due"));
  setTimeout(() => showMenu(r), 600);
}

// ---- input ----
// The beat the player hears, not the one the clock is at: the output latency (big on phones) comes
// off first. Presses are judged on it and the frame draws on it.
function heardBeat() {
  if (!music) return 0;
  const lag = ("outputLatency" in music.ctx ? music.ctx.outputLatency : 0) || music.ctx.baseLatency || 0;
  return music.beat() - lag / music.spb;
}

function padDown(lane: Lane) {
  if (down.has(lane)) return;
  down.add(lane);
  pads[lane]!.classList.add("down");
  if (!run || !music || run.over) return;
  for (const j of press(run, lane, heardBeat())) show(j);
}

function padUp(lane: Lane) {
  if (!down.has(lane)) return;
  down.delete(lane);
  pads[lane]!.classList.remove("down");
}

function show(j: Judgement) {
  if (!music) return;
  const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch {} };
  if (j.kind === "hit") {
    music.answer(j.call.lane, j.grade, j.call.hold);
    bursts.push({ ...burst(j.call.lane, music.beat(), j.grade === "perfect" ? 1 : 0.6), x: LANE_X[j.call.lane] });
    passBeat = heardBeat();
    say(j.grade === "perfect" ? "Perfect" : j.offset < 0 ? "Early" : j.offset > 0 ? "Late" : "Through");
    buzz(j.grade === "perfect" ? 12 : 6);
  } else if (j.kind === "release") {
    if (j.grade === "dropped") { music.wall(); say("Dropped"); buzz(40); missBeat = heardBeat(); }
    else { bursts.push({ ...burst(j.call.lane, music.beat(), j.grade === "perfect" ? 1.2 : 0.8), x: LANE_X[j.call.lane] }); say("Held"); }
  } else if (j.kind === "miss") {
    music.wall();
    say("Miss");
    buzz(40);
    missBeat = heardBeat();
  }
}

function say(text: string) {
  hud.judge.textContent = text;
  hud.judge.dataset.kind = text.toLowerCase().split(" ")[0];
  judgeUntil = performance.now() + 500;
}

pads.forEach((pad) => {
  const lane = Number(pad.dataset.lane) as Lane;
  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); padDown(lane); });
  pad.addEventListener("pointerup", () => padUp(lane));
  pad.addEventListener("pointercancel", () => padUp(lane));
  pad.addEventListener("lostpointercapture", () => padUp(lane));
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
});
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const lane = KEYS[e.code];
  if (lane !== undefined) { e.preventDefault(); padDown(lane); }
  if (e.code === "KeyM" && music) music.muted = !music.muted;
  if (e.code === "Escape" && run) { run.over = "lost"; finish(); }
});
window.addEventListener("keyup", (e) => { const lane = KEYS[e.code]; if (lane !== undefined) padUp(lane); });
window.addEventListener("blur", () => { for (const l of [...down]) padUp(l); });

// ---- controls ----
mountControls({
  key: "delayed-reaction.controls", parent: el("controls-host"),
  keys: [["D F J K", "Pads 1 to 4"], ["Arrow keys", "Pads 1 to 4"], ["Hold", "Long notes"], ["M", "Mute"], ["Esc", "Leave the run"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => {
    paused = open;
    for (const l of [...down]) padUp(l);
    if (!music) return;
    if (open) void music.ctx.suspend(); else void music.ctx.resume();
  },
});

// ---- drawing ----
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  stage.width = Math.floor(innerWidth * dpr);
  stage.height = Math.floor(innerHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function frame(now: number) {
  requestAnimationFrame(frame);
  // Everything you see runs on the beat you hear, so the pad lights, the key lands and the judging agree.
  const beat = music && run ? heardBeat() : 0;
  if (run && music && !paused) {
    for (const j of advance(run, beat)) show(j);
    hud.score.textContent = String(run.score);
    hud.combo.textContent = run.combo >= 5 ? `${run.combo}x` : "";
    hud.lives.style.width = `${(run.lives / 8) * 100}%`;
    hud.lives.dataset.low = run.lives <= 2 ? "1" : "";
    echoBursts(bursts, beat, run.chart.delay);
    music.setSpeed(run.speed);
    // The pad lights in its colour while its key is in the window: a thumb can read that.
    const due = dueLanes(run, beat);
    pads.forEach((p, i) => p.classList.toggle("due", due.has(i as Lane)));
    if (run.over) finish();
  }
  if (now > judgeUntil) hud.judge.textContent = "";
  // scene.speed (1 = normal) is how fast the tunnel rushes and how far the runner leans in.
  // Between runs the tunnel still rolls, at an idle 120 bpm, so the menu has something turning behind it.
  // The runner stands where the sim says (x across the floor) and reels off a wall it just hit.
  const x = run ? runnerX(run, beat) : 0, knock = run ? knockback(run, beat) : 0;
  const scene = { run, beat: run ? beat : now / 500, down, bursts, speed: run?.speed ?? 1, missBeat, passBeat, x, knock, t: now / 1000 };
  const v = sway(view(innerWidth, innerHeight), scene.beat, !!run, { x: ctl.lookX, y: ctl.lookY * (ctl.invertY ? -1 : 1) });
  drawTunnel(g, v, scene);
  drawRunner(g, v, scene);
}

// Avoid the page scrolling or zooming under a thumb.
document.addEventListener("touchmove", (e) => { if (!menu.hidden) return; e.preventDefault(); }, { passive: false });

// The same state setter for an agent: window.delayedReaction, and the WebMCP tools where the browser has them.
const hook = {
  start: (o: unknown) => { const sc = Scenario(o ?? {}); void start(sc.level, sc); return toSearch(sc); },
  state: () => run && { level: run.chart.level, beat: Math.round(run.beat * 100) / 100, score: run.score, combo: run.combo, lives: run.lives, speed: run.speed, lane: run.lane, over: run.over },
};
Reflect.set(window, "delayedReaction", hook);
const mc: unknown = Reflect.get(document, "modelContext") ?? Reflect.get(navigator, "modelContext");
if (mc && typeof (mc as { registerTool?: unknown }).registerTool === "function") {
  const reg = (mc as { registerTool: (t: object) => unknown }).registerTool.bind(mc);
  const props = { level: { type: "integer" }, bpm: { type: "number" }, delay: { type: "integer" }, hint: { type: "number" }, beat: { type: "number" }, speed: { type: "number" }, lane: { type: "integer" } };
  try {
    reg({ name: "dr_start", title: "Start in a state", description: "Start a run at a level, tempo, delay, beat, speed and lane. Returns the link that lands in the same state.",
      inputSchema: { type: "object", properties: props }, execute: async (a: unknown) => ({ link: hook.start(a) }) });
    reg({ name: "dr_state", title: "Look at the run", description: "Score, combo, lives, speed, lane and beat of the run now.",
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, execute: async () => hook.state() ?? { menu: true } });
  } catch { /* a browser whose registerTool has another shape: the window hook still works */ }
}

showMenu();
requestAnimationFrame(frame);

