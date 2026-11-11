// The page: a canvas tunnel you run down, four thumb pads, a HUD, and a menu. The sim
// (sim.ts) decides everything; this file draws it and turns thumbs and keys into presses.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { CircleHelp, createElement } from "lucide";
import { Music } from "./audio.ts";
import { accountChip, achieve, finishSignIn, reportButton } from "./eqosys.ts";
import { burst, drawTunnel, echoBursts, LANE_X, sway, view, type Burst } from "./hallway.ts";
import { drawRunner } from "./runner.ts";
import { backplate, fibre, grille, HI, knob, LANE_COLOURS, LO, needleAt, screw, tear, tuningScale, vuMeter, vuTurn } from "./fascia.ts";
import { SETUP_NAMES, SETUPS } from "./dub.ts";
import { fromSearch, runOf, Scenario, setupOf, toSearch } from "./scenario.ts";
import { addCommands } from "@rustybuns/util/commands";
import { check, int, obj, oneOf } from "@rustybuns/util/guard";
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
// The menu is the front of a dub radio (fascia.ts): a station display with a tuning scale, Tempo and Delay knobs, the levels
// as preset keys with a tape label each, the arranged tracks as tapes over the speaker grille, and the last run on a VU meter.
const fascia = menu.querySelector<HTMLElement>(".fascia")!, tuned = el("tuned"), resultBox = el("result"), tracks = el("tracks");
fascia.insertAdjacentHTML("afterbegin", [20, 75, 130, 160].map((t, i) => `<i class="screw-at s${i}">${screw(t)}</i>`).join(""));
el("tuner").innerHTML = tuningScale();
for (const b of document.querySelectorAll("button.info")) b.replaceChildren(createElement(CircleHelp)); // opens the how-to (a popover)
// The live meter swings on the menu's beat (frame() below), the knobs point at what you're on.
el("knobs").innerHTML = knob("Tempo", 1) + knob("Delay", 2) + `<figure class="live">${vuMeter("LIVE")}</figure>`;
tracks.style.setProperty("--grille", grille);
fascia.style.setProperty("--fibre", fibre);
/** A delay as a tape label says it: "1 bar", "2 bars", "6 beats". */
const short = (beats: number) => beats % 4 === 0 ? `${beats / 4} bar${beats === 4 ? "" : "s"}` : `${beats} beats`;

/** Point the radio at a level or a tape: the needle at its tempo, the knobs at its tempo and delay, its name in the display. */
function tune(bpm: number, delay: number, words: string) {
  fascia.style.setProperty("--needle", String(needleAt(bpm)));
  fascia.style.setProperty("--tempo", `${-135 + ((bpm - LO) / (HI - LO)) * 270}deg`);
  fascia.style.setProperty("--delay", `${-135 + Math.min(1, delay / 16) * 270}deg`);
  tuned.textContent = words;
}
const tunesTo = (b: HTMLElement, bpm: number, delay: number, words: string) => {
  for (const ev of ["pointerenter", "focus"]) b.addEventListener(ev, () => tune(bpm, delay, words));
};
const taped = (b: HTMLElement, seed: number) => { const t = tear(seed); b.style.setProperty("--clip", t.clip); b.style.setProperty("--tilt", `${t.tilt}deg`); };

/** The last run, read off the radio: a VU meter at the share of calls answered, and the numbers. */
function readout(r: Run) {
  const answered = r.hits + r.misses, bar = Math.floor(r.beat / 4) + 1;
  const verdict = r.over === "won" ? `Level ${r.chart.level} clear` : bar < 1 || answered === 0 ? `Level ${r.chart.level}: left before the first call` : `Level ${r.chart.level}: lost it at bar ${bar}`;
  const stat = (k: string, v: number) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  // The display's own screen: the verdict, the score big in the display's glow, the rest under it, and the hits meter beside.
  resultBox.innerHTML = `<div class="readout"><div><p class="verdict">${verdict}</p><p class="big"><span>Score</span>${r.score}</p>
    <dl>${stat("Perfect", r.perfects)}${stat("Best combo", r.maxCombo)}${stat("Hits", r.hits)}${stat("Misses", r.misses)}</dl></div>${vuMeter("HITS")}</div>`;
  // The needle swings up from rest to the share of calls answered, once the readout is on screen.
  const box = resultBox.firstElementChild as HTMLElement;
  requestAnimationFrame(() => requestAnimationFrame(() => box.style.setProperty("--got", vuTurn(answered ? r.hits / answered : 0))));
}

function showMenu(result?: Run, note = "") {
  levels.replaceChildren();
  accountChip(account, { note });
  if (result) readout(result); else resultBox.replaceChildren();
  LEVELS.forEach((spec, i) => {
    const b = document.createElement("button");
    const n = i + 1, words = `${spec.bpm} bpm · ${delayWords(spec.delay)}`;
    b.className = "preset";
    b.setAttribute("aria-label", `Level ${n}, ${words}${best[n] ? `, best ${best[n]}` : ""}`);
    b.style.setProperty("--led", LANE_COLOURS[i % 4]!);
    b.innerHTML = `<span class="key"><i class="led"${best[n] ? " data-on" : ""}></i><b>${n}</b></span>`
      + `<span class="tape" style="--code:${LANE_COLOURS[i % 4]}">${spec.bpm} · ${short(spec.delay)}${best[n] ? `<em>best ${best[n]}</em>` : ""}</span>`;
    taped(b.querySelector<HTMLElement>(".tape")!, n);
    tunesTo(b, spec.bpm, spec.delay, `Preset ${n}: ${words}`);
    b.addEventListener("click", () => start(n));
    levels.append(b);
  });
  // The twenty-four arranged dub tracks, to try: each plays level 3's calls over its own tempo, delay and length.
  tracks.replaceChildren(...SETUPS.map((s, i) => {
    const b = document.createElement("button");
    b.className = "cassette";
    b.innerHTML = `<span class="name">${s.name}</span><span class="meta">${s.bpm} · ${s.bars} bars</span>`;
    b.title = `${s.bpm} bpm, ${s.bars} bars, ${s.back} on the three, delay on the ${s.echo}`;
    taped(b, 100 + i);
    tunesTo(b, s.bpm, s.delay, `Tape: ${s.name}, ${s.bpm} bpm, ${s.bars} bars`);
    b.addEventListener("click", () => start(3, Scenario({ level: 3, setup: s.name })));
    return b;
  }));
  if (asked) {
    const b = document.createElement("button");
    b.id = "scenario";
    b.innerHTML = `<b>Go</b> ${toSearch(asked)}`;
    b.addEventListener("click", () => start(asked.level, asked));
    levels.prepend(b);
  }
  const at = LEVELS[(result?.chart.level ?? 1) - 1] ?? LEVELS[0]!;
  tune(at.bpm, at.delay, result ? `Preset ${result.chart.level}` : "Tuned to preset 1");
  menu.hidden = false;
  menu.scrollTop = 0;
}

async function start(level: number, scene?: Scenario) {
  menu.hidden = true;
  music ??= new Music();
  const made = scene ? runOf(scene) : null;
  const chart = made?.chart ?? makeChart(level);
  run = made?.run ?? createRun(chart);
  void achieve("played");
  el("delay-words").textContent = delayWords(chart.delay);
  hud.judge.textContent = chart.hint ? `Answer ${delayWords(chart.delay)}` : `${delayWords(chart.delay).replace(/^./, (c) => c.toUpperCase())}, no echo`;
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

/** Notes answered in a row, for the streak achievement. */
let answered = 0;
function show(j: Judgement) {
  if (!music) return;
  const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch {} };
  if (j.kind === "hit") {
    music.answer(j.call.lane, j.grade, j.call.hold);
    bursts.push({ ...burst(j.call.lane, music.beat(), j.grade === "perfect" ? 1 : 0.6), x: LANE_X[j.call.lane] });
    passBeat = heardBeat();
    void achieve("first-answer");
    if (++answered >= 8) void achieve("streak-8");
    say(j.grade === "perfect" ? "Perfect" : j.offset < 0 ? "Early" : j.offset > 0 ? "Late" : "Through");
    buzz(j.grade === "perfect" ? 12 : 6);
  } else if (j.kind === "release") {
    if (j.grade === "dropped") { answered = 0; music.wall(); say("Dropped"); buzz(40); missBeat = heardBeat(); }
    else { bursts.push({ ...burst(j.call.lane, music.beat(), j.grade === "perfect" ? 1.2 : 0.8), x: LANE_X[j.call.lane] }); say("Held"); }
  } else if (j.kind === "miss") {
    answered = 0;
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
/** The radio is the theme: a black fascia, cold white ink and hairlines, monospace like the display. The lanes keep the colour. */
const NEON = { "--ui-bg": "#0b0c10", "--ui-ink": "#e9ecf2", "--ui-dim": "#9aa0b4", "--ui-line": "#e9ecf259", "--ui-border": "1px", "--ui-panel": backplate, "--ui-soft": "#14161c", "--ui-accent": "#e9ecf2", "--ui-on-accent": "#0b0c10", "--ui-accent-soft": "#20232b", "--ui-scrim": "#000c", "--ui-radius": "10px", "--ui-radius-sm": "6px", "--ui-font": "ui-monospace, SFMono-Regular, Menlo, monospace" };

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
  // The menu's live meter, on the idle beat the tunnel rolls to: a kick on every beat, the one hardest, a little flutter.
  if (!menu.hidden) {
    const b = now / 500, kick = Math.exp(-(b % 1) * 5) * (b % 4 < 1 ? 1 : 0.72);
    fascia.style.setProperty("--live", vuTurn(0.22 + kick * 0.5 + Math.sin(now / 37) * 0.02));
  }
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
/** A finished run's numbers, for showing the results screen without playing one (shots, agents). */
const Finished = obj({ level: int(1, LEVELS.length, 1), score: int(0, 1e7, 0), perfects: int(0, 1e5, 0), hits: int(0, 1e5, 0), misses: int(0, 1e5, 0),
  maxCombo: int(0, 1e5, 0), over: oneOf(["won", "lost"], "won"), bar: int(1, 1e4, 1) });
const hook = {
  start: (o: unknown) => { const sc = Scenario(o ?? {}); void start(sc.level, sc); return toSearch(sc); },
  result: (o: unknown) => {
    const f = check(Finished, o ?? {});
    if (!f) return null;
    const r = { ...createRun(makeChart(f.level)), ...f, beat: (f.bar - 1) * 4 + 1 };
    showMenu(r);
    return f;
  },
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

