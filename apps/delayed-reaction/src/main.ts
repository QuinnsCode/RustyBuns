// The page: a canvas keyboard you run along, four thumb pads, a HUD, and a menu. The sim
// (sim.ts) decides everything; this file draws it and turns thumbs and keys into presses.
import { Music } from "./audio.ts";
import { advance, createRun, delayWords, inFlight, LANES, LEVELS, makeChart, press, release, type Judgement, type Lane, type Run } from "./sim.ts";

const LANE_COLOR: Record<Lane, string> = { 0: "#ff5fa2", 1: "#ffc542", 2: "#4de3ff", 3: "#9dff5f" };
const KEYS: Record<string, Lane> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

const stage = document.getElementById("stage") as HTMLCanvasElement;
const g = stage.getContext("2d")!;
const hud = { score: el("score"), combo: el("combo"), judge: el("judge") };
const menu = el("menu"), levels = el("levels"), pads = [...document.querySelectorAll<HTMLButtonElement>(".pad")];

let music: Music | null = null;
let run: Run | null = null;
let best: Record<number, number> = {};
try { best = JSON.parse(localStorage.getItem("delayed-reaction.best") ?? "{}"); } catch { best = {}; }
const flashes: { lane: Lane; at: number; grade: string }[] = [];
const down = new Set<Lane>();
let judgeUntil = 0;

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
  menu.hidden = false;
}

async function start(level: number) {
  menu.hidden = true;
  music ??= new Music();
  const chart = makeChart(level);
  run = createRun(chart);
  el("delay-words").textContent = delayWords(chart.delay);
  hud.judge.textContent = `Answer ${delayWords(chart.delay)}`;
  judgeUntil = performance.now() + 2500;
  await music.play(chart);
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
  setTimeout(() => showMenu(r), 600);
}

// ---- input ----
// A press is judged at the beat the player heard, not the one the clock is at: the output latency
// (big on phones) comes off first.
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
  show(press(run, lane, heardBeat()));
}

function padUp(lane: Lane) {
  if (!down.has(lane)) return;
  down.delete(lane);
  pads[lane]!.classList.remove("down");
  if (!run || !music || run.over) return;
  const j = release(run, lane, heardBeat());
  if (j) show(j);
}

function show(j: Judgement) {
  if (!music) return;
  const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch {} };
  if (j.kind === "hit") {
    music.answer(j.call.lane, j.grade, j.call.hold);
    flashes.push({ lane: j.call.lane, at: performance.now(), grade: j.grade });
    say(j.grade === "perfect" ? "Perfect" : j.offset < 0 ? "Early" : "Late");
    buzz(j.grade === "perfect" ? 12 : 6);
  } else if (j.kind === "release") {
    if (j.grade === "dropped") { music.answer(j.call.lane, "bad"); say("Dropped"); buzz(40); }
    else { flashes.push({ lane: j.call.lane, at: performance.now(), grade: j.grade }); say("Held"); }
  } else if (j.kind === "early") {
    music.answer(j.lane, "bad");
    say("Nothing there");
    buzz(25);
  } else {
    say("Miss");
    buzz(40);
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
  const W = innerWidth, H = innerHeight;
  const beat = music && run ? music.beat() : 0;
  if (run && music) {
    for (const j of advance(run, beat)) show(j);
    hud.score.textContent = String(run.score);
    hud.combo.textContent = run.combo >= 5 ? `${run.combo}x` : "";
    if (run.over) finish();
  }
  if (now > judgeUntil) hud.judge.textContent = "";

  // Background pulses with the kick: a dark room with a light that breathes.
  const pulse = run ? Math.max(0, 1 - (((beat % 1) + 1) % 1) * 3) : 0;
  g.fillStyle = `rgb(${11 + pulse * 10}, ${7 + pulse * 4}, ${20 + pulse * 18})`;
  g.fillRect(0, 0, W, H);

  const padTop = H - (pads[0]?.getBoundingClientRect().height ?? 0) - 16;
  const stripTop = H * 0.18, stripH = Math.min(padTop - stripTop - 24, H * 0.5);
  const laneH = stripH / 4;
  const runnerX = W * 0.28;
  const delay = run?.chart.delay ?? 4;
  const pxPerBeat = (W - runnerX) / delay;

  // The keyboard: four rails, the lowest lane at the bottom. Keys slide left; the runner stands
  // at the echo line, and a key is answered when it reaches them.
  for (const lane of LANES) {
    const y = stripTop + (3 - lane) * laneH;
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(0, y + laneH * 0.15, W, laneH * 0.7);
    g.fillStyle = LANE_COLOR[lane];
    g.globalAlpha = down.has(lane) ? 0.9 : 0.35;
    g.fillRect(0, y + laneH * 0.82, runnerX, 3);
    g.globalAlpha = 1;
  }
  // Lives as a thin bar along the top of the strip.
  if (run) {
    g.fillStyle = run.lives <= 2 ? "#ff5fa2" : "rgba(255,255,255,0.5)";
    g.fillRect(0, stripTop - 10, (W * run.lives) / 8, 3);
  }

  if (run) {
    for (const c of run.chart.calls) {
      const x = runnerX + (c.due - beat) * pxPerBeat;
      const w = Math.max(laneH * 0.6, c.hold * pxPerBeat);
      if (x + w < -20 || x > W + 20 || c.beat > beat + 0.02) continue;
      const y = stripTop + (3 - c.lane) * laneH;
      const gone = c.state === "hit" || c.state === "missed";
      g.globalAlpha = gone ? 0.15 : c.state === "held" ? 0.9 : 0.8;
      g.fillStyle = c.state === "missed" ? "#664" : LANE_COLOR[c.lane];
      roundRect(x - laneH * 0.3, y + laneH * 0.2, w, laneH * 0.6, 6);
      if (c.hold && !gone) {
        g.globalAlpha = 0.35;
        g.fillStyle = "#fff";
        g.fillRect(x - laneH * 0.3 + 6, y + laneH * 0.45, w - 12, 3);
      }
      g.globalAlpha = 1;
    }
  }

  // The echo line and the runner: a figure that bobs on the beat and stomps a lane's colour when it answers.
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.setLineDash([6, 8]);
  g.beginPath(); g.moveTo(runnerX, stripTop - 14); g.lineTo(runnerX, stripTop + stripH + 10); g.stroke();
  g.setLineDash([]);
  const bob = run ? Math.abs(Math.sin(beat * Math.PI)) * 8 : 0;
  const fy = stripTop - 20 - bob;
  const recent = flashes.filter((f) => now - f.at < 220).at(-1);
  g.strokeStyle = recent ? LANE_COLOR[recent.lane] : "#fff";
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.arc(runnerX, fy - 34, 8, 0, Math.PI * 2);
  g.moveTo(runnerX, fy - 26); g.lineTo(runnerX, fy - 4);
  const swing = run ? Math.sin(beat * Math.PI) * 10 : 0;
  g.moveTo(runnerX, fy - 4); g.lineTo(runnerX - 8 + swing, fy + 12);
  g.moveTo(runnerX, fy - 4); g.lineTo(runnerX + 8 - swing, fy + 12);
  g.moveTo(runnerX, fy - 20); g.lineTo(runnerX - 10 - swing, fy - 8);
  g.moveTo(runnerX, fy - 20); g.lineTo(runnerX + 10 + swing, fy - 8);
  g.stroke();
  g.lineWidth = 1;

  // Flashes: a ring that grows out of the answered lane.
  for (const f of flashes) {
    const age = (now - f.at) / 400;
    if (age > 1) continue;
    const y = stripTop + (3 - f.lane) * laneH + laneH / 2;
    g.strokeStyle = LANE_COLOR[f.lane];
    g.globalAlpha = 1 - age;
    g.lineWidth = f.grade === "perfect" ? 4 : 2;
    g.beginPath(); g.arc(runnerX, y, 10 + age * laneH, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }
  while (flashes.length && now - flashes[0]!.at > 400) flashes.shift();

  // The queue you're carrying: one dot per call in flight, in its lane colour, under the strip.
  if (run) {
    const q = inFlight(run, beat);
    q.forEach((c, i) => {
      g.fillStyle = LANE_COLOR[c.lane];
      g.beginPath(); g.arc(16 + i * 18, stripTop + stripH + 18, 5, 0, Math.PI * 2); g.fill();
    });
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

// Avoid the page scrolling or zooming under a thumb.
document.addEventListener("touchmove", (e) => { if (!menu.hidden) return; e.preventDefault(); }, { passive: false });

showMenu();
requestAnimationFrame(frame);

