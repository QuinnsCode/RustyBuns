// Alien Disc Golf: Planet Earth. Nine holes; each tee is a random spot in one country, each basket in
// another, and the real wind (NOAA's GFS, fetched by the Worker) carries the disc the whole flight. The
// alien's scanner shows coastlines and wind, no names: say which country you're teeing off from for a
// stroke back. Miss into the sea and the real ocean current takes the disc while you paddle against it.
// `?seed=` is a course, `?hole=` jumps, `?wind=synthetic` plays without NOAA.
import { loadPad, mountControls } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import { countries, countryAt } from "./countries.ts";
import currentsUrl from "./currents.bin?url";
import { loadCurrents, paddleToward, startSwim, SWIM_S, swimKm, swimOver, swimStep, type Currents, type Swim } from "./currents.ts";
import { BASKET_KM, coursePar, makeCourse, type Course, type Hole } from "./course.ts";
import { carryKm, hangTime, levelFor, MAX_POWER, MIN_POWER, POWER_STEP, powerFor, simulateThrow, type Flight, type Loft } from "./flight.ts";
import { bearing, compass, distanceKm, windHeading, type LatLon } from "./geo.ts";
import { Globe } from "./globe.ts";
import { sampleWind } from "./grib2.ts";
import { finishSignIn, mountAccount, reportButton } from "./account.ts";
import { icon } from "./icons.ts";
import { loadWind, type Wind } from "./wind-load.ts";

const MAX_STROKES = 8;
// The pad: the left stick aims (left/right turns, up/down power); these buttons are rebindable in the cog.
const PAD_KEY = "alien-disc-golf.controls";
const pad = loadPad(PAD_KEY, [
  { id: "throw", label: "Throw (swim: paddle)", button: 0 },
  { id: "loft", label: "Low / high loft", button: 3 },
  { id: "currents", label: "Ocean currents", button: 2 },
  { id: "fine", label: "Hold for fine aim", button: 6 },
]);
let padPaddling = false, padPower = 0;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Phase = "loading" | "guess" | "aim" | "flying" | "swim" | "done";
interface HoleScore { strokes: number; guessed: boolean }

// Back from eqosys with ?code=&state=: the query comes off the address before the seed is read, then the code is traded in.
reportButton();
const back = finishSignIn();
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || (Math.floor(Math.random() * 1e6) + 1);
if (!params.get("seed")) { params.set("seed", String(seed)); history.replaceState(null, "", `?${params}`); }

const globe = new Globe($("#globe"));
mountAccount($("#account"));
void back.then((b) => { if (b) mountAccount($("#account"), b.error); });
const panel = $("#panel"), scoreEl = $("#score"), credit = $("#credit");
// On a phone the panel covers the bottom of the screen: the planet centres in what's left above it.
const fitGlobe = () => globe.setInset(innerWidth <= 720 ? innerHeight - panel.getBoundingClientRect().top : 0);
addEventListener("resize", fitGlobe);
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
let currents: Currents | null = null;
let seaView = false; // aiming with the ocean currents on the globe instead of the wind
let swim: Swim | null = null, paddling = false, swimFrom = 0; // swimFrom: km to the basket when the disc went in

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
  const sea = currents ? ` · Currents: ${currents.day}${currents.live ? "" : " (cached)"}, NOAA <a href="https://coastwatch.noaa.gov/" target="_blank" rel="noopener">CoastWatch</a>` : "";
  credit.innerHTML = `${src}${sea} · Coastlines: Natural Earth · Course #${seed} · A Rusty Buns example`;
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
  renderPanel();
  fitGlobe();
}

function renderPanel() {
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
        ${currents ? `<button type="button" id="sea-view" class="icon ${seaView ? "primary" : ""}" title="Show the ocean currents a splash would swim in (C)" aria-pressed="${seaView}">${icon("waves")}</button>` : ""}
      </div>
      <p class="dim">${icon("mouse-pointer-click")} Click the planet to aim there in still air. The dashed line is the throw without wind; the wind will bend it. <kbd>←</kbd><kbd>→</kbd> aim, <kbd>↑</kbd><kbd>↓</kbd> power, <kbd>L</kbd> loft,${currents ? " <kbd>C</kbd> currents," : ""} <kbd>Space</kbd> throw.</p>
      <div class="actions"><button type="button" id="throw" class="primary">${icon("disc")} Throw</button></div>`;
    const h = $<HTMLInputElement>("#heading"), p = $<HTMLInputElement>("#power");
    h.addEventListener("input", () => { heading = Number(h.value); aimChanged(false); });
    p.addEventListener("input", () => { power = Number(p.value); aimChanged(false); });
    $("#loft-low").addEventListener("click", () => setLoft("low"));
    $("#loft-high").addEventListener("click", () => setLoft("high"));
    $("#throw").addEventListener("click", throwDisc);
    document.querySelector("#sea-view")?.addEventListener("click", () => setSeaView(!seaView));
    aimChanged(false);
  } else if (phase === "flying") {
    panel.innerHTML = `<h2>${icon("wind")} In flight</h2><p class="dim">${loft === "high" ? "Riding the jet stream." : "Riding the surface wind."} Hang time ${hangTime(power, loft).toFixed(1)} s.</p>`;
  } else if (phase === "swim" && swim) {
    panel.innerHTML = `<h2>${icon("waves")} Overboard: paddle!</h2>
      <p>The disc is in the sea and the current has it. Paddle against it before the clock runs out, or ride it to a shore.</p>
      <div class="wind"><span class="lvl">Current</span><span id="swim-cur" class="on"></span><span id="swim-arrow" class="arrow on">${icon("arrow-up")}</span>
        <span class="lvl">Basket</span><span id="swim-km"></span><span></span>
        <span class="lvl">${icon("timer")}</span><span><span id="swim-clock" class="swim-clock"></span><span class="tip" title="The swim lasts ${SWIM_S} s. A 1 m/s current carries the disc 150 km a second; paddling makes 60.">${icon("info")}</span></span><span></span></div>
      <div class="row"><label>${icon("navigation")} Paddle</label><input id="heading" type="range" min="0" max="359" step="1" value="${swim.heading}" /><output id="heading-out">${swim.heading}° ${compass(swim.heading)}</output></div>
      <p class="dim">Hold <kbd>Space</kbd> or <kbd>↑</kbd> (or the button) to paddle; <kbd>←</kbd><kbd>→</kbd> or tap the planet to steer.</p>
      <div class="actions"><button type="button" id="paddle" class="primary">${icon("waves")} Hold to paddle</button></div>`;
    const h = $<HTMLInputElement>("#heading"), b = $("#paddle");
    h.addEventListener("input", () => steer(Number(h.value)));
    b.addEventListener("pointerdown", (e) => { b.setPointerCapture(e.pointerId); setPaddling(true); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, () => setPaddling(false));
    swimHud();
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
  loft = l; seaView = false;
  globe.setWind(levelFor(wind.levels, loft), loft);
  render();
}

function setSeaView(on: boolean) {
  seaView = on && !!currents;
  globe.setWind(seaView ? currents!.level : levelFor(wind.levels, loft), seaView ? "sea" : loft);
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
  arrive(f.windDriftKm > 30 ? ` The wind carried it ${fmt(f.windDriftKm)} km.` : "", true);
}

/** The disc has come to rest at `lie`: holed, picked up, into the sea for a swim, or the next stroke. */
function arrive(drift: string, canSwim: boolean) {
  const toBasket = distanceKm(lie, hole.basket);
  const where = countryAt(lie);
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
  } else if (!where && canSwim && currents) {
    say(`Splash! In the sea, ${fmt(toBasket)} km from the basket.${drift}`, 3000);
    beginSwim();
  } else {
    say(canSwim ? `Landed ${where ? `in ${esc(where.name)}` : "in the sea"}, ${fmt(toBasket)} km from the basket.${drift}` : drift, 4200);
    beginAim();
  }
}

function beginSwim() {
  swim = startSwim(lie, paddleToward(lie, hole.basket));
  swimFrom = distanceKm(lie, hole.basket);
  paddling = false;
  phase = "swim";
  globe.hideAim();
  globe.setWind(currents?.level ?? null, "sea");
  globe.lookAt(lie, 1.9);
  render();
}

const isSea = (p: LatLon) => countryAt(p) === null;

function swimHud() {
  if (!swim) return;
  const left = Math.max(0, SWIM_S - swim.t);
  const clock = document.querySelector("#swim-clock"), cur = document.querySelector("#swim-cur"), arrow = document.querySelector<HTMLElement>("#swim-arrow"), km = document.querySelector("#swim-km");
  if (clock) { clock.textContent = `${left.toFixed(1)} s`; clock.classList.toggle("low", left < 3); }
  if (currents && cur && arrow) {
    const [u, v] = sampleWind(currents.level, swim.pos.lat, swim.pos.lon);
    cur.textContent = `${Math.hypot(u, v).toFixed(2)} m/s to ${compass(windHeading(u, v))}`;
    arrow.style.transform = `rotate(${windHeading(u, v)}deg)`;
  }
  if (km) km.textContent = `${fmt(distanceKm(swim.pos, hole.basket))} km`;
}

function steer(h: number) {
  if (!swim) return;
  swim.heading = ((Math.round(h) % 360) + 360) % 360;
  const r = document.querySelector<HTMLInputElement>("#heading"), o = document.querySelector("#heading-out");
  if (r) r.value = String(swim.heading);
  if (o) o.textContent = `${swim.heading}° ${compass(swim.heading)}`;
}

function setPaddling(on: boolean) {
  paddling = on && phase === "swim";
  document.querySelector("#paddle")?.classList.toggle("on", paddling);
}

function endSwim() {
  const s = swim!;
  swim = null; setPaddling(false);
  lie = s.pos;
  globe.setWind(levelFor(wind.levels, loft), loft);
  const gained = swimFrom - distanceKm(lie, hole.basket);
  const where = countryAt(lie);
  const how = s.ashore ? `Washed up${where ? ` in ${esc(where.name)}` : ""}` : `Drifted ${fmt(swimKm(s))} km`;
  const net = Math.abs(gained) < 20 ? "held your ground" : gained > 0 ? `${fmt(gained)} km closer` : `${fmt(-gained)} km further off`;
  arrive(` ${how}, ${fmt(distanceKm(lie, hole.basket))} km from the basket: ${net}.`, false);
}

function nextHole() {
  if (holeIx + 1 >= course.holes.length) { phase = "done"; globe.hideAim(); render(); return; }
  startHole(holeIx + 1);
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (phase === "swim" && swim) {
    if (e.key === "ArrowLeft") steer(swim.heading - (e.shiftKey ? 10 : 3));
    else if (e.key === "ArrowRight") steer(swim.heading + (e.shiftKey ? 10 : 3));
    else if (e.key === " " || e.key === "ArrowUp") setPaddling(true);
    else return;
    e.preventDefault();
    return;
  }
  if (phase !== "aim" || (e.target instanceof HTMLElement && e.target.tagName === "INPUT" && e.key === " ")) return;
  const step = e.shiftKey ? 10 : 2;
  if (e.key === "ArrowLeft") { heading -= step; aimChanged(true); }
  else if (e.key === "ArrowRight") { heading += step; aimChanged(true); }
  else if (e.key === "ArrowUp") { power += POWER_STEP; aimChanged(true); }
  else if (e.key === "ArrowDown") { power -= POWER_STEP; aimChanged(true); }
  else if (e.key === "l" || e.key === "L") setLoft(loft === "low" ? "high" : "low");
  else if (e.key === "c" || e.key === "C") setSeaView(!seaView);
  else if (e.key === " " || e.key === "Enter") throwDisc();
  else return;
  e.preventDefault();
});

window.addEventListener("keyup", (e: KeyboardEvent) => { if (e.key === " " || e.key === "ArrowUp") setPaddling(false); });
window.addEventListener("blur", () => setPaddling(false));

globe.onPick = (p) => {
  if (phase === "swim" && swim) { steer(bearing(swim.pos, p)); return; }
  if (phase !== "aim") return;
  heading = Math.round(bearing(lie, p));
  power = powerFor(distanceKm(lie, p));
  aimChanged(true);
};

/** Once a frame: the left stick aims or steers, buttons throw, loft and paddle. */
function padFrame(dt: number) {
  const g = pad.poll(), fine = g.held.has("fine") ? 0.25 : 1;
  if (phase === "swim" && swim) {
    if (g.left.x) steer(swim.heading + g.left.x * 90 * fine * dt);
    const on = g.held.has("throw");
    if (on !== padPaddling) setPaddling((padPaddling = on));
    return;
  }
  if (padPaddling) setPaddling((padPaddling = false));
  if (phase !== "aim") return;
  if (g.left.x) { heading += g.left.x * 60 * fine * dt; aimChanged(true); }
  // Up is more power: it builds up until it is a whole step, so a gentle push is slow and the aim stays on the step grid.
  padPower += -g.left.y * 12 * fine * dt;
  if (Math.abs(padPower) >= POWER_STEP) { power += Math.sign(padPower) * POWER_STEP; padPower = 0; aimChanged(true); }
  else if (!g.left.y) padPower = 0;
  if (g.pressed.has("loft")) setLoft(loft === "low" ? "high" : "low");
  if (g.pressed.has("currents")) setSeaView(!seaView);
  if (g.pressed.has("throw")) throwDisc();
}
mountControls({
  key: PAD_KEY, pad, parent: $("#top"), title: "Controls",
  skin: "house",
  hide: ["lookX", "lookY", "touch", "invertY"],
  keys: [["Arrows", "Aim and power"], ["L", "Loft"], ["Space", "Throw"], ["Left stick", "Aim and power"]],
});

// ?speed=4 runs the game clock four times as fast (flights and swims), for a test or an agent playing a round.
const speed = clamp(Number(params.get("speed")) || 1, 0.25, 20);
let last = performance.now();
function frame(now: number) {
  const real = (now - last) / 1000, dt = real * speed; last = now;
  if (phase === "flying" && flight) {
    flyT += dt;
    const t = clamp(flyT / flyDur, 0, 1);
    const ix = Math.min(flight.path.length - 1, Math.floor(t * (flight.path.length - 1)));
    const p = flight.path[ix]!;
    globe.setDisc(p, t, loft);
    globe.lookAt(p);
    if (t >= 1) { const f = flight; flight = null; landed(f); }
  } else if (phase === "swim" && swim) {
    swimStep(swim, Math.min(dt, 0.1), currents?.level ?? null, paddling, isSea);
    globe.setDisc(swim.pos, 0, "low");
    globe.lookAt(swim.pos);
    swimHud();
    if (swimOver(swim)) endSwim();
  }
  padFrame(real);
  globe.tick(real);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

render();
// ?wind=synthetic plays offline: the cached currents too, so a seeded run is the same run every time.
const offline = params.get("wind") === "synthetic";
Promise.all([loadWind(params.get("wind")), loadCurrents(currentsUrl, offline ? null : "/api/currents")]).then(([w, c]) => {
  wind = w;
  currents = c;
  creditLine();
  if (w.source !== "noaa") say(`No live wind: ${esc(w.label)}`, 5000);
  startHole(holeIx);
  // `?swim=36.5,-72`: straight into the sea there (that one is the Gulf Stream), for a hands-on check of the swim.
  const at = params.get("swim")?.split(",").map(Number);
  if (at?.length === 2 && at.every(Number.isFinite)) { beginAim(); golfApi.splash(at[0]!, at[1]!); }
});

// For an agent's browser or a hands-on check: read the state, aim, throw, guess, swim.
const golfApi = {
    state: () => ({ seed, phase, hole: hole.n, strokes, lie, basket: hole.basket, heading, power, loft, seaView, wind: wind.label, source: wind.source, currents: currents && { day: currents.day, live: currents.live }, swim: swim && { ...swim, paddling }, scores: [...scores] }),
    aim: (h: number, p: number, l?: Loft) => { heading = h; power = p; if (l) setLoft(l); aimChanged(true); },
    throw: throwDisc,
    guess,
    skipGuess: beginAim,
    /** Drop the disc in the sea here and start the swim, as if a throw had landed there. */
    splash: (lat: number, lon: number) => { if (phase !== "aim" || !currents) return; lie = { lat, lon }; beginSwim(); },
    paddle: setPaddling,
    steer,
    seaView: setSeaView,
};
Object.assign(window, { golf: golfApi });
