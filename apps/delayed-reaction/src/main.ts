// The page: a canvas tunnel you run down, four thumb pads, a HUD, and a menu. The sim
// (sim.ts) decides everything; this file draws it and turns thumbs and keys into presses.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { Music } from "./audio.ts";
import { finishSignIn, renderAccount, reportButton } from "./eqosys.ts";
import { burst, drawTunnel, echoBursts, LANE_X, sway, view, type Burst } from "./hallway.ts";
import { drawRunner } from "./runner.ts";
import { SETUP_NAMES, SETUPS } from "./dub.ts";
import { fromSearch, runOf, Scenario, setupOf, toSearch } from "./scenario.ts";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { advance, createRun, delayWords, dueLanes, knockback, LEVELS, makeChart, press, runnerX, type Judgement, type Lane, type Run } from "./sim.ts";
const KEYS: Record<string, Lane> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

const stage = document.getElementById("stage") as HTMLCanvasElement;
const g = stage.getContext("2d")!;
const hud = { score: el("score"), combo: el("combo"), judge: el("judge"), lives: el("lives") };
const menu = el("menu"), levels = el("levels"), account = el("account"), pads = [...document.querySelectorAll<HTMLButtonElement>(".pad")];

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
function showMenu(result?: Run, note = "") {
  levels.replaceChildren();
  renderAccount(account, note);
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
  // The twelve arranged dub tracks, to try: each plays level 3's calls over its own tempo, delay and length.
  const tracks = document.createElement("div");
  tracks.id = "tracks";
  for (const s of SETUPS) {
    const b = document.createElement("button");
    b.textContent = `${s.name} ${s.bpm}·${s.bars}`;
    b.title = `${s.bpm} bpm, ${s.bars} bars, ${s.back} on the three, delay on the ${s.echo}`;
    b.addEventListener("click", () => start(3, Scenario({ level: 3, setup: s.name })));
    tracks.append(b);
  }
  levels.append(tracks);
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
  music.only = scene?.stem ?? null;
  await music.play(chart, scene?.beat, scene ? setupOf(scene) : null);
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
  const lag = music.latency;
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
/** The neon tunnel is the theme: black glass, white ink, one cyan glow. */
const NEON = { "--ui-bg": "#07080d", "--ui-ink": "#ffffff", "--ui-dim": "#9aa0b4", "--ui-line": "#3be8ff", "--ui-soft": "#141826", "--ui-accent": "#3be8ff", "--ui-accent-soft": "#0f2a33", "--ui-scrim": "#000a" };

mountControls({
  key: "delayed-reaction.controls", parent: el("controls-host"),
  skin: "house", theme: NEON,
  keys: [["D F J K", "Pads 1 to 4"], ["Arrow keys", "Pads 1 to 4"], ["Hold", "Long notes"], ["M", "Mute"], ["Esc", "Leave the run"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => {
    paused = open;
    for (const l of [...down]) padUp(l);
    if (!music) return;
    music.hold(open);
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

// The same state setter for an agent: window.delayedReaction, and as commands (WebMCP tools and the Cmd/Ctrl+K palette).
const hook = {
  start: (o: unknown) => { const sc = Scenario(o ?? {}); void start(sc.level, sc); return toSearch(sc); },
  state: () => run && { level: run.chart.level, beat: Math.round(run.beat * 100) / 100, score: run.score, combo: run.combo, lives: run.lives, speed: run.speed, lane: run.lane, over: run.over },
};
Reflect.set(window, "delayedReaction", hook);
const props = { level: { type: "integer" }, bpm: { type: "number" }, delay: { type: "integer" }, hint: { type: "number" }, beat: { type: "number" }, speed: { type: "number" }, lane: { type: "integer" }, stem: { type: "string", enum: ["drums", "bass", "synth", "dub"] }, setup: { type: "string", enum: SETUP_NAMES } };
addCommands([
  { name: "dr_start", title: "Start in a state", group: "Run", description: "Start a run at a level, tempo, delay, beat, speed and lane, optionally hearing one stem (drums, bass, synth, dub) or playing one of the arranged dub tracks (setup). Returns the link that lands in the same state.",
    inputSchema: { type: "object", properties: props }, execute: (a) => ({ link: hook.start(a) }) },
  { name: "dr_state", title: "Look at the run", group: "Run", description: "Score, combo, lives, speed, lane and beat of the run now.",
    annotations: { readOnlyHint: true }, execute: () => hook.state() ?? { menu: true } },
]);
mountPalette();

reportButton();
void finishSignIn().then((back) => showMenu(undefined, back?.error));
requestAnimationFrame(frame);

