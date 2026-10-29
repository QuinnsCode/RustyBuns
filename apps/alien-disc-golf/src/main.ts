// Alien Disc Golf: Planet Earth. Nine holes; each tee is a random spot in one country, each basket in
// another, and the real wind (NOAA's GFS, fetched by the Worker) carries the disc the whole flight. The
// alien's scanner shows coastlines and wind, no names: say which country you're teeing off from for a
// stroke back. `?seed=` is a course, `?hole=` jumps, `?wind=synthetic` plays without NOAA.
import { clamp } from "@rustybuns/util";
import { countries, countryAt } from "./countries.ts";
import { BASKET_KM, coursePar, makeCourse, type Course, type Hole } from "./course.ts";
import { carryKm, hangTime, levelFor, MAX_POWER, MIN_POWER, POWER_STEP, powerFor, simulateThrow, type Flight, type Loft } from "./flight.ts";
import { bearing, compass, distanceKm, windHeading, type LatLon } from "./geo.ts";
import { Globe } from "./globe.ts";
import { sampleWind } from "./grib2.ts";
import { icon } from "./icons.ts";
import { loadWind, type Wind } from "./wind-load.ts";

const MAX_STROKES = 8;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Phase = "loading" | "guess" | "aim" | "flying" | "done";
interface HoleScore { strokes: number; guessed: boolean }

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || (Math.floor(Math.random() * 1e6) + 1);
if (!params.get("seed")) { params.set("seed", String(seed)); history.replaceState(null, "", `?${params}`); }

const globe = new Globe($("#globe"));
const panel = $("#panel"), scoreEl = $("#score"), credit = $("#credit");
const toast = document.createElement("div"); toast.className = "toast"; document.body.append(toast);
let toastTimer = 0;
const say = (msg: string, ms = 3200) => { toast.innerHTML = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove("show"), ms); };

const course: Course = makeCourse(seed);
const scores: HoleScore[] = [];
let wind: Wind = { levels: [], source: "synthetic", label: "loading" };
let phase: Phase = "loading";
let holeIx = clamp((Number(params.get("hole")) || 1) - 1, 0, course.holes.length - 1);
let hole: Hole = course.holes[holeIx]!;
let lie: LatLon = hole.tee;        // where the disc is
let strokes = 0, guessed = false;
let heading = 0, power = 5, loft: Loft = "low";
let flight: Flight | null = null, flyT = 0, flyDur = 1;

globe.setCountries(countries());

function windAt(p: LatLon, l: Loft) {
  const lv = levelFor(wind.levels, l);
  if (!lv) return null;
  const [u, v] = sampleWind(lv, p.lat, p.lon);
  return { speed: Math.hypot(u, v), to: windHeading(u, v) };
}

function scoreLine() {
  const played = scores.reduce((t, s, i) => t + s.strokes - (s.guessed ? 1 : 0) - course.holes[i]!.par, 0);
  const total = played === 0 ? "E" : played > 0 ? `+${played}` : String(played);
  scoreEl.innerHTML = phase === "done"
    ? `Round over · <b>${total}</b>`
    : `Hole <b>${hole.n}</b>/${course.holes.length} · Par ${hole.par} · ${fmt(hole.km)} km · Stroke <b>${strokes + 1}</b> · ${total}`;
}

function creditLine() {
  const src = wind.source === "noaa"
    ? `Wind: ${esc(wind.label)}, NOAA via <a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noopener">NOMADS</a>`
    : `Wind: ${esc(wind.label)}`;
  credit.innerHTML = `${src} · Coastlines: Natural Earth · Course #${seed} · A Rusty Buns example`;
}

function startHole(ix: number) {
  holeIx = ix; hole = course.holes[ix]!;
  lie = hole.tee; strokes = 0; guessed = false; loft = "low";
  heading = Math.round(bearing(hole.tee, hole.basket));
  power = powerFor(hole.km);
  globe.setHole(hole.tee, hole.basket);
  globe.setWind(levelFor(wind.levels, loft), loft);
  globe.lookAt(hole.tee, 2.4);
  phase = "guess";
  render();
}

function render() {
  scoreLine();
  if (phase === "loading") {
    panel.innerHTML = `<h2>${icon("globe")} Scanning the planet</h2><p class="dim">Fetching NOAA's wind grid and the coastlines.</p>`;
  } else if (phase === "guess") {
    panel.innerHTML = `<h2>${icon("help-circle")} Hole ${hole.n}: where are we?</h2>
      <p>Your scanner shows coastlines and wind, no names. The tee is the glowing cone. Name the country for a stroke back on this hole.</p>
      <div class="choices">${hole.guesses.map((g) => `<button type="button" data-guess="${esc(g)}">${esc(g)}</button>`).join("")}</div>
      <div class="actions"><button type="button" id="skip">Skip the guess</button></div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((b) => b.addEventListener("click", () => guess(b.dataset.guess!)));
    $("#skip").addEventListener("click", () => beginAim());
  } else if (phase === "aim") {
    const lo = windAt(lie, "low"), hi = windAt(lie, "high");
    const row = (name: string, w: ReturnType<typeof windAt>, on: boolean) => w
      ? `<span class="lvl ${on ? "on" : ""}">${name}</span><span class="${on ? "on" : ""}">${w.speed.toFixed(0)} m/s blowing ${compass(w.to)}</span><span class="arrow ${on ? "on" : ""}" style="transform: rotate(${w.to}deg)">${icon("arrow-up")}</span>`
      : `<span class="lvl">${name}</span><span class="dim">no data</span><span></span>`;
    const here = countryAt(lie);
    panel.innerHTML = `<h2>${icon("disc")} Stroke ${strokes + 1}${strokes === 0 ? ` from ${esc(hole.teeCountry)}` : here ? ` from ${esc(here.name)}` : " from the open sea"}</h2>
      <p>Basket: <b>${fmt(distanceKm(lie, hole.basket))} km</b> at ${compass(bearing(lie, hole.basket))} (${Math.round(bearing(lie, hole.basket))}°), in ${esc(hole.basketCountry)}. In from ${BASKET_KM} km.</p>
      <div class="wind">${row("Surface", lo, loft === "low")}${row("Jet 250 mb", hi, loft === "high")}</div>
      <div class="row"><label>${icon("navigation")} Aim</label><input id="heading" type="range" min="0" max="359" step="1" value="${heading}" /><output id="heading-out">${heading}° ${compass(heading)}</output></div>
      <div class="row"><label>${icon("chevrons-up")} Power</label><input id="power" type="range" min="${MIN_POWER}" max="${MAX_POWER}" step="${POWER_STEP}" value="${power}" /><output id="power-out">${fmt(carryKm(power))} km</output></div>
      <div class="row"><label>${icon("wind")} Loft</label>
        <button type="button" id="loft-low" class="${loft === "low" ? "primary" : ""}" title="Hover low, in the surface wind">Low</button>
        <button type="button" id="loft-high" class="${loft === "high" ? "primary" : ""}" title="Loft into the jet stream: longer hang, far stronger wind">High: jet stream</button>
      </div>
      <p class="dim">${icon("mouse-pointer-click")} Click the planet to aim there in still air. The dashed line is the throw without wind; the wind will bend it. <kbd>←</kbd><kbd>→</kbd> aim, <kbd>↑</kbd><kbd>↓</kbd> power, <kbd>L</kbd> loft, <kbd>Space</kbd> throw.</p>
      <div class="actions"><button type="button" id="throw" class="primary">${icon("disc")} Throw</button></div>`;
    const h = $<HTMLInputElement>("#heading"), p = $<HTMLInputElement>("#power");
    h.addEventListener("input", () => { heading = Number(h.value); aimChanged(false); });
    p.addEventListener("input", () => { power = Number(p.value); aimChanged(false); });
    $("#loft-low").addEventListener("click", () => setLoft("low"));
    $("#loft-high").addEventListener("click", () => setLoft("high"));
    $("#throw").addEventListener("click", throwDisc);
    aimChanged(false);
  } else if (phase === "flying") {
    panel.innerHTML = `<h2>${icon("wind")} In flight</h2><p class="dim">${loft === "high" ? "Riding the jet stream." : "Riding the surface wind."} Hang time ${hangTime(power, loft).toFixed(1)} s.</p>`;
  } else if (phase === "done") {
    const par = coursePar(course);
    const total = scores.reduce((t, s) => t + s.strokes - (s.guessed ? 1 : 0), 0);
    const rows = scores.map((s, i) => {
      const h = course.holes[i]!, net = s.strokes - (s.guessed ? 1 : 0), d = net - h.par;
      return `<tr><td>${h.n} ${esc(h.teeCountry)}</td><td>${h.par}</td><td>${s.strokes}${s.guessed ? "-1" : ""}</td><td class="${d < 0 ? "under" : d > 0 ? "over" : ""}">${d === 0 ? "E" : d > 0 ? `+${d}` : d}</td></tr>`;
    }).join("");
    const d = total - par;
    panel.innerHTML = `<h2>${icon("flag")} Round over: ${d === 0 ? "even par" : d > 0 ? `${d} over` : `${-d} under`}</h2>
      <table class="card"><tr><th>Hole</th><th>Par</th><th>Strokes</th><th></th></tr>${rows}<tr><th>Total</th><th>${par}</th><th>${total}</th><th>${d === 0 ? "E" : d > 0 ? `+${d}` : d}</th></tr></table>
      <div class="actions"><button type="button" id="again" class="primary">${icon("rotate-ccw")} Same course</button><button type="button" id="new">${icon("globe")} New course</button><button type="button" id="share" title="Copy a link to this course">${icon("share")}</button></div>`;
    $("#again").addEventListener("click", () => { scores.length = 0; startHole(0); });
    $("#new").addEventListener("click", () => { location.href = `${location.pathname}?seed=${Math.floor(Math.random() * 1e6) + 1}`; });
    $("#share").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); say("Link copied: same nine holes, same wind right now"); } catch { say(esc(location.href)); } });
  }
}

function guess(name: string) {
  const right = name === hole.teeCountry;
  guessed = right;
  panel.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((b) => {
    b.disabled = true;
    if (b.dataset.guess === hole.teeCountry) b.classList.add("right");
    else if (b.dataset.guess === name) b.classList.add("wrong");
  });
  say(right ? `${esc(hole.teeCountry)}. A stroke back on this hole.` : `No: this is ${esc(hole.teeCountry)}.`);
  setTimeout(beginAim, 1100);
}

function beginAim() {
  phase = "aim";
  globe.lookAt(lie, 1.9);
  render();
}

function setLoft(l: Loft) {
  loft = l;
  globe.setWind(levelFor(wind.levels, loft), loft);
  render();
}

function aimChanged(fromKeys: boolean) {
  heading = ((Math.round(heading) % 360) + 360) % 360;
  power = clamp(Math.round(power / POWER_STEP) * POWER_STEP, MIN_POWER, MAX_POWER);
  globe.setAim(lie, heading, carryKm(power), loft);
  if (fromKeys) {
    const h = document.querySelector<HTMLInputElement>("#heading"), p = document.querySelector<HTMLInputElement>("#power");
    if (h) h.value = String(heading);
    if (p) p.value = String(power);
  }
  const ho = document.querySelector("#heading-out"), po = document.querySelector("#power-out");
  if (ho) ho.textContent = `${heading}° ${compass(heading)}`;
  if (po) po.textContent = `${fmt(carryKm(power))} km`;
}

function throwDisc() {
  if (phase !== "aim") return;
  flight = simulateThrow({ from: lie, heading, power, loft }, levelFor(wind.levels, loft));
  strokes++;
  flyT = 0;
  flyDur = 1.6 + flight.hangTime * 0.22;
  phase = "flying";
  globe.startFlight();
  render();
}

function landed(f: Flight) {
  lie = f.landing;
  const toBasket = distanceKm(lie, hole.basket);
  const where = countryAt(lie);
  const drift = f.windDriftKm > 30 ? ` The wind carried it ${fmt(f.windDriftKm)} km.` : "";
  if (toBasket <= BASKET_KM) {
    scores[holeIx] = { strokes, guessed };
    const net = strokes - (guessed ? 1 : 0), d = net - hole.par;
    const name = d <= -3 ? "an albatross" : d === -2 ? "an eagle" : d === -1 ? "a birdie" : d === 0 ? "par" : d === 1 ? "a bogey" : `${d} over`;
    say(`In the basket in ${esc(hole.basketCountry)}: ${name}.${drift}`, 4200);
    setTimeout(nextHole, 1800);
  } else if (strokes >= MAX_STROKES) {
    scores[holeIx] = { strokes: MAX_STROKES + 1, guessed };
    say(`Picked up after ${MAX_STROKES}; that's ${MAX_STROKES + 1} for the hole.`, 4200);
    setTimeout(nextHole, 1800);
  } else {
    say(`Landed ${where ? `in ${esc(where.name)}` : "in the sea"}, ${fmt(toBasket)} km from the basket.${drift}`, 4200);
    beginAim();
  }
}

function nextHole() {
  if (holeIx + 1 >= course.holes.length) { phase = "done"; globe.hideAim(); render(); return; }
  startHole(holeIx + 1);
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (phase !== "aim" || (e.target instanceof HTMLElement && e.target.tagName === "INPUT" && e.key === " ")) return;
  const step = e.shiftKey ? 10 : 2;
  if (e.key === "ArrowLeft") { heading -= step; aimChanged(true); }
  else if (e.key === "ArrowRight") { heading += step; aimChanged(true); }
  else if (e.key === "ArrowUp") { power += POWER_STEP; aimChanged(true); }
  else if (e.key === "ArrowDown") { power -= POWER_STEP; aimChanged(true); }
  else if (e.key === "l" || e.key === "L") setLoft(loft === "low" ? "high" : "low");
  else if (e.key === " " || e.key === "Enter") throwDisc();
  else return;
  e.preventDefault();
});

globe.onPick = (p) => {
  if (phase !== "aim") return;
  heading = Math.round(bearing(lie, p));
  power = powerFor(distanceKm(lie, p));
  aimChanged(true);
};

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000; last = now;
  if (phase === "flying" && flight) {
    flyT += dt;
    const t = clamp(flyT / flyDur, 0, 1);
    const ix = Math.min(flight.path.length - 1, Math.floor(t * (flight.path.length - 1)));
    const p = flight.path[ix]!;
    globe.setDisc(p, t, loft);
    globe.lookAt(p);
    if (t >= 1) { const f = flight; flight = null; landed(f); }
  }
  globe.tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

render();
loadWind(params.get("wind")).then((w) => {
  wind = w;
  creditLine();
  if (w.source !== "noaa") say(`No live wind: ${esc(w.label)}`, 5000);
  startHole(holeIx);
});

// For an agent's browser or a hands-on check: read the state, aim, throw, guess.
Object.assign(window, {
  golf: {
    state: () => ({ seed, phase, hole: hole.n, strokes, lie, basket: hole.basket, heading, power, loft, wind: wind.label, source: wind.source, scores: [...scores] }),
    aim: (h: number, p: number, l?: Loft) => { heading = h; power = p; if (l) setLoft(l); aimChanged(true); },
    throw: throwDisc,
    guess,
    skipGuess: beginAim,
  },
});
