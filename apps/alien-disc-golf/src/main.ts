// Alien Disc Golf: Planet Earth. Nine holes; each tee is a random spot in one country, each basket in
// another, and the real wind (NOAA's GFS, fetched by the Worker) carries the disc the whole flight. The
// alien's scanner shows coastlines and wind, no names: say which country you're teeing off from for a
// stroke back. Miss into the sea and the real ocean current takes the disc while you paddle against it.
// `?seed=` is a course, `?hole=` jumps, `?wind=synthetic` plays without NOAA.
import { loadPad, mountControls } from "@rustybuns/game-controls";
import { clamp } from "@rustybuns/util";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { cssUrl, forecastStrip, fronds, lieGlyph, markFor, orbitMark, punchStrip, routeMap, turnRose, windRose, type CardHole, type Vane } from "./board.ts";
import { countries, countryAt } from "./countries.ts";
import currentsUrl from "./currents.bin?url";
import { loadCurrents, PADDLE_KMS, paddleToward, SEA_DRIFT, startSwim, SWIM_S, swimKm, swimOver, swimStep, type Currents, type Swim } from "./currents.ts";
import { BASKET_KM, coursePar, makeCourse, type Course, type Hole } from "./course.ts";
import { carryKm, hangTime, levelFor, MAX_POWER, MIN_POWER, POWER_STEP, powerFor, simulateThrow, type Flight, type Loft } from "./flight.ts";
import { arc, bearing, compass, destination, distanceKm, windHeading, type LatLon } from "./geo.ts";
import { Globe } from "./globe.ts";
import { sampleWind } from "./grib2.ts";
import { accountChip, achieve, finishSignIn, reportButton, THEME } from "./account.ts";
import { about, icon, info } from "./icons.ts";
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
/** `wet`: the disc went in the sea on this hole (the scorecard marks it with a wave). */
interface HoleScore { strokes: number; guessed: boolean; wet?: boolean }

// Back from eqosys with ?code=&state=: the query comes off the address before the seed is read, then the code is traded in.
reportButton();
const back = finishSignIn();
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || (Math.floor(Math.random() * 1e6) + 1);
if (!params.get("seed")) { params.set("seed", String(seed)); history.replaceState(null, "", `?${params}`); }

const globe = new Globe($("#globe"));
accountChip($("#account"));
void back.then((b) => { if (b) accountChip($("#account"), { note: b.error }); });
const panel = $("#panel"), scoreEl = $("#score"), credit = $("#credit"), splash = $("#splash"), windChip = $("#wind-chip");
// On a phone the panel covers the bottom of the screen: the planet centres in what's left above it.
// `--dock` is how much of the screen the panel takes from the bottom: the ⌘ and Report buttons stand on top of it on a phone.
const fitGlobe = () => {
  const dock = innerWidth <= 720 && !splashUp ? innerHeight - panel.getBoundingClientRect().top : 0;
  document.documentElement.style.setProperty("--dock", `${Math.max(0, dock)}px`);
  globe.setInset(dock);
};
addEventListener("resize", fitGlobe);
const toast = document.createElement("div"); toast.className = "toast"; document.body.append(toast);
let toastTimer = 0;
const say = (msg: string, ms = 3200) => { toast.innerHTML = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove("show"), ms); };

/** An eqosys achievement: unlocked on the account (or kept until sign-in); eqosys's own toast celebrates the first time. */
const earn = (id: string) => void achieve(id);

const course: Course = makeCourse(seed);
// The course's own botany on the scorecard's corner, in space kept for it.
document.documentElement.style.setProperty("--flora-big", cssUrl(fronds(seed + 1, 240, 170)));
const scores: HoleScore[] = [];
let wind: Wind = { levels: [], source: "synthetic", label: "loading" };
let phase: Phase = "loading";
// The title splash: up from the start until the player tees off (a jump straight to a hole or a swim skips it).
let splashUp = !params.has("hole") && !params.has("swim");
let holeIx = clamp((Number(params.get("hole")) || 1) - 1, 0, course.holes.length - 1);
let hole: Hole = course.holes[holeIx]!;
let lie: LatLon = hole.tee;        // where the disc is
let strokes = 0, guessed = false, wet = false;
let heading = 0, power = 5, loft: Loft = "low";
let flight: Flight | null = null, flyT = 0, flyDur = 1;
let currents: Currents | null = null;
let seaView = false; // aiming with the ocean currents on the globe instead of the wind
let swim: Swim | null = null, paddling = false, swimFrom = 0; // swimFrom: km to the basket when the disc went in

globe.setCountries(countries());

function windAt(p: LatLon, l: Loft): Vane | null {
  const lv = levelFor(wind.levels, l);
  if (!lv) return null;
  const [u, v] = sampleWind(lv, p.lat, p.lon);
  return { speed: Math.hypot(u, v), to: windHeading(u, v) };
}
/** The dial's full reach for each level: the jet runs several times the surface wind. */
const ROSE_SCALE = { low: 25, high: 70, sea: 1.5 } as const;

/** The wind at ten stretches of the throw as aimed, at its loft, for the forecast strip. */
function stripHtml() {
  const km = carryKm(power), end = destination(lie, heading, km);
  const cells: { vane: Vane; track: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const p = destination(lie, heading, (km * (i + 0.5)) / 10), w = windAt(p, loft);
    if (w) cells.push({ vane: w, track: bearing(p, end) });
  }
  return cells.length ? forecastStrip(cells, ROSE_SCALE[loft]) : "";
}

const cardHoles = (): CardHole[] => course.holes.map((h, i) => {
  const s = scores[i];
  return { n: h.n, par: h.par, net: s ? s.strokes - (s.guessed ? 1 : 0) : undefined };
});
const strip = () => punchStrip(cardHoles(), hole.n);

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

/** The title splash: the logotype over the globe with the disc-in-orbit mark, and this course's nine holes as a route
 * over the coastlines. While the wind loads it scans; then it offers Tee off. */
function drawSplash() {
  document.body.classList.toggle("splashing", splashUp);
  splash.hidden = !splashUp;
  if (!splashUp) return;
  const km = course.holes.reduce((t, h) => t + h.km, 0);
  const route = routeMap(course.holes.map((h) => ({ n: h.n, path: arc(h.tee, h.basket, 24).map((p) => [p.lon, p.lat]) })), countries().flatMap((c) => c.outer));
  splash.innerHTML = `<div class="splash-mark"><i class="sweep"></i>${orbitMark()}</div>
    <h1 class="logotype">Alien Disc Golf</h1>
    <p class="tagline">Planet Earth</p>
    <figure class="route-card">${route}<figcaption><span>Course #${seed}</span><span>9 holes · par ${coursePar(course)} · ${fmt(km)} km</span></figcaption></figure>
    <div class="splash-go">${phase === "loading"
      ? `<p class="scanning" role="status"><i></i>Scanning the planet: fetching NOAA's wind</p>`
      : `<button type="button" id="tee-off" class="primary">${icon("disc")} Tee off</button><p class="dim"><span class="keys"><kbd>Space</kbd> · </span>${esc(wind.source === "noaa" ? wind.label : "Synthetic wind: no live NOAA grid")}</p>`}</div>`;
  splash.querySelector("#tee-off")?.addEventListener("click", teeOff);
  (splash.querySelector("#tee-off") as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

function teeOff() {
  if (!splashUp || phase === "loading") return;
  splashUp = false;
  drawSplash();
  render();
}

/** The wind source as a HUD chip beside the score: live NOAA in teal, the synthetic stand-in in amber. */
function windChipLine() {
  const live = wind.source === "noaa";
  windChip.hidden = false;
  windChip.className = `wind-chip ${live ? "live" : "synthetic"}`;
  windChip.title = live ? `Live wind: ${wind.label}` : `No live wind: ${wind.label}`;
  windChip.innerHTML = `<i></i>${live ? esc(wind.label.replace(/^NOAA /, "").replace(/ \d{4}-\d\d-\d\d/, "")) : "No live wind"}`;
}

function startHole(ix: number) {
  holeIx = ix; hole = course.holes[ix]!;
  lie = hole.tee; strokes = 0; guessed = false; wet = false; loft = "low";
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
    panel.innerHTML = `${strip()}<p class="dim scanning"><i></i>Scanning the planet: fetching NOAA's wind grid.</p>`;
  } else if (phase === "guess") {
    panel.innerHTML = `${strip()}<h2>${icon("map-pin")} Hole ${hole.n}: where are we?${info("about-hole", "How to play")}</h2>
      ${about("about-hole", "<p>Your scanner shows coastlines and wind, no names. The tee is the glowing cone. Name the country for a stroke back on this hole.</p>")}
      <div class="choices">${hole.guesses.map((g) => `<button type="button" data-guess="${esc(g)}">${esc(g)}</button>`).join("")}</div>
      <div class="actions"><button type="button" id="skip" title="Skip the guess">Skip</button></div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((b) => b.addEventListener("click", () => guess(b.dataset.guess!)));
    $("#skip").addEventListener("click", () => beginAim());
  } else if (phase === "aim") {
    const lo = windAt(lie, "low"), hi = windAt(lie, "high"), toBasket = bearing(lie, hole.basket);
    const rose = windRose([{ vane: lo, scale: ROSE_SCALE.low, kind: "low", on: loft === "low" }, { vane: hi, scale: ROSE_SCALE.high, kind: "high", on: loft === "high" }], heading, toBasket);
    const row = (name: string, w: Vane | null, on: boolean) => w
      ? `<span class="lvl ${on ? "on" : ""}">${name}</span><span class="${on ? "on" : ""}">${w.speed.toFixed(0)} m/s blowing ${compass(w.to)}</span><span class="arrow ${on ? "on" : ""}" style="transform: rotate(${w.to}deg)">${icon("arrow-up")}</span>`
      : `<span class="lvl">${name}</span><span class="dim">no data</span><span></span>`;
    const here = countryAt(lie);
    panel.innerHTML = `${strip()}<h2>${icon("disc")} Stroke ${strokes + 1}${strokes === 0 ? ` from ${esc(hole.teeCountry)}` : here ? ` from ${esc(here.name)}` : " from the open sea"}${info("about-aim", "How to throw")}</h2>
      ${about("about-aim", `<p>${icon("mouse-pointer-click")} Click the planet to aim there in still air. The dashed line is the throw without wind; the wind will bend it.</p><p>The basket is in from ${BASKET_KM} km.</p><p class="keys"><kbd>←</kbd><kbd>→</kbd> aim, <kbd>↑</kbd><kbd>↓</kbd> power, <kbd>L</kbd> loft,${currents ? " <kbd>C</kbd> currents," : ""} <kbd>Space</kbd> throw.</p>`)}
      <div class="board">${rose}<div>
        <p>Basket <b>${fmt(distanceKm(lie, hole.basket))} km</b> ${compass(toBasket)} (${Math.round(toBasket)}°), in ${esc(hole.basketCountry)}.</p>
        <div class="wind">${row("Surface", lo, loft === "low")}${row("Jet 250 mb", hi, loft === "high")}</div></div></div>
      <figure class="forecast"><figcaption>Wind along the throw <span>${loft === "high" ? "jet" : "surface"}, m/s · tee → landing</span></figcaption><div id="strip">${stripHtml()}</div></figure>
      <div class="row"><label>${icon("navigation")} Aim</label><input id="heading" type="range" min="0" max="359" step="1" value="${heading}" /><output id="heading-out">${heading}° ${compass(heading)}</output></div>
      <div class="row"><label>${icon("chevrons-up")} Power</label><input id="power" type="range" min="${MIN_POWER}" max="${MAX_POWER}" step="${POWER_STEP}" value="${power}" /><output id="power-out">${fmt(carryKm(power))} km</output></div>
      <div class="row"><label>${icon("wind")} Loft</label>
        <button type="button" id="loft-low" class="${loft === "low" ? "primary" : ""}" title="Hover low, in the surface wind">Low</button>
        <button type="button" id="loft-high" class="${loft === "high" ? "primary" : ""}" title="Loft into the jet stream: longer hang, far stronger wind">High</button>
        ${currents ? `<button type="button" id="sea-view" class="icon ${seaView ? "primary" : ""}" title="Show the ocean currents a splash would swim in (C)" aria-pressed="${seaView}">${icon("waves")}</button>` : ""}
      </div>
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
    panel.innerHTML = `${strip()}<h2>${icon("wind")} In flight</h2><p class="dim">${loft === "high" ? "Riding the jet stream." : "Riding the surface wind."} Hang time ${hangTime(power, loft).toFixed(1)} s.</p>`;
  } else if (phase === "swim" && swim) {
    panel.innerHTML = `${strip()}<h2>${icon("waves")} Overboard: paddle!${info("about-swim", "How to swim")}</h2>
      ${about("about-swim", `<p>The disc is in the sea and the current has it. Paddle against it before the clock runs out, or ride it to a shore.</p>
        <p>Hold the button<span class="keys">, <kbd>Space</kbd> or <kbd>↑</kbd></span> to paddle; tap the planet<span class="keys"> or <kbd>←</kbd><kbd>→</kbd></span> to steer.</p>`)}
      <div class="board">${windRose([{ vane: { speed: ROSE_SCALE.sea / 2, to: 0 }, scale: ROSE_SCALE.sea, kind: "sea", on: true }], swim.heading, bearing(swim.pos, hole.basket))}<div class="wind"><span class="lvl">Current</span><span id="swim-cur" class="on"></span><span id="swim-arrow" class="arrow on">${icon("arrow-up")}</span>
        <span class="lvl">Basket</span><span id="swim-km"></span><span></span>
        <span class="lvl">${icon("timer")}</span><span><span id="swim-clock" class="swim-clock"></span><span class="tip" title="The swim lasts ${SWIM_S} s. A 1 m/s current carries the disc ${fmt(SEA_DRIFT)} km a second; paddling makes ${fmt(PADDLE_KMS)}.">${icon("info")}</span></span><span></span></div></div>
      <div class="row"><label>${icon("navigation")} Paddle</label><input id="heading" type="range" min="0" max="359" step="1" value="${swim.heading}" /><output id="heading-out">${swim.heading}° ${compass(swim.heading)}</output></div>
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
      return `<tr><td>${lieGlyph(!!s.wet)}${h.n} <span class="where">${esc(h.teeCountry)}</span></td><td>${h.par}</td><td><span class="mark ${markFor(d)}">${s.strokes}${s.guessed ? "-1" : ""}</span></td><td class="${d < 0 ? "under" : d > 0 ? "over" : ""}">${d === 0 ? "E" : d > 0 ? `+${d}` : d}</td></tr>`;
    }).join("");
    const d = total - par;
    panel.innerHTML = `<div class="slot" aria-hidden="true"><i></i></div><div class="scorecard"><header><span>Alien Disc Golf · Planet Earth</span><span>Course #${seed}</span></header>
      <h2>${icon("flag")} Round over: ${d === 0 ? "even par" : d > 0 ? `${d} over` : `${-d} under`}</h2>
      <table class="card"><tr><th>Hole</th><th>Par</th><th>Strokes</th><th></th></tr>${rows}<tr><th>Total</th><th>${par}</th><th>${total}</th><th>${d === 0 ? "E" : d > 0 ? `+${d}` : d}</th></tr></table>
      <footer><span>${lieGlyph(false)}dry ${lieGlyph(true)}swam</span><span>Wind: ${esc(wind.label)}</span></footer></div>
      <div class="actions card-actions"><button type="button" id="again" class="primary">${icon("rotate-ccw")} Same course</button><button type="button" id="new">${icon("globe")} New course</button><button type="button" id="share" title="Copy a link to this course">${icon("share")}</button></div>`;
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
  if (right) earn("where-are-we");
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
  turnRose(panel, "aim", heading);
  const st = document.querySelector("#strip");
  if (st) st.innerHTML = stripHtml();
}

function throwDisc() {
  if (phase !== "aim") return;
  flight = simulateThrow({ from: lie, heading, power, loft }, levelFor(wind.levels, loft));
  strokes++;
  earn("played"); earn("alpha");
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
    scores[holeIx] = { strokes, guessed, wet };
    const net = strokes - (guessed ? 1 : 0), d = net - hole.par;
    const name = d <= -3 ? "an albatross" : d === -2 ? "an eagle" : d === -1 ? "a birdie" : d === 0 ? "par" : d === 1 ? "a bogey" : `${d} over`;
    say(`In the basket in ${esc(hole.basketCountry)}: ${name}.${drift}`, 4200);
    earn("first-basket");
    if (strokes === 1) earn("ace");
    if (d <= -2) earn("eagle"); else if (d === -1) earn("birdie");
    setTimeout(nextHole, 1800);
  } else if (strokes >= MAX_STROKES) {
    scores[holeIx] = { strokes: MAX_STROKES + 1, guessed, wet };
    say(`Picked up after ${MAX_STROKES}; that's ${MAX_STROKES + 1} for the hole.`, 4200);
    setTimeout(nextHole, 1800);
  } else if (!where && canSwim && currents) {
    say(`Splash! In the sea, ${fmt(toBasket)} km from the basket.${drift}`, 3000);
    earn("splash");
    beginSwim();
  } else {
    say(canSwim ? `Landed ${where ? `in ${esc(where.name)}` : "in the sea"}, ${fmt(toBasket)} km from the basket.${drift}` : drift, 4200);
    beginAim();
  }
}

function beginSwim() {
  swim = startSwim(lie, paddleToward(lie, hole.basket));
  wet = true;
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
    turnRose(panel, "sea", windHeading(u, v));
  }
  turnRose(panel, "aim", swim.heading);
  turnRose(panel, "basket", bearing(swim.pos, hole.basket));
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
  if (holeIx + 1 >= course.holes.length) {
    phase = "done"; globe.hideAim(); render();
    earn("nine");
    if (scores.reduce((t, s, i) => t + s.strokes - (s.guessed ? 1 : 0) - course.holes[i]!.par, 0) < 0) earn("under-par");
    return;
  }
  startHole(holeIx + 1);
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (splashUp) {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); teeOff(); }
    return;
  }
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
  if (splashUp) { if (g.pressed.has("throw")) teeOff(); return; }
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
  theme: THEME,
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
drawSplash();
// ?wind=synthetic plays offline: the cached currents too, so a seeded run is the same run every time.
const offline = params.get("wind") === "synthetic";
Promise.all([loadWind(params.get("wind")), loadCurrents(currentsUrl, offline ? null : "/api/currents")]).then(([w, c]) => {
  wind = w;
  currents = c;
  creditLine();
  windChipLine();
  startHole(holeIx);
  drawSplash();
  // `?swim=36.5,-72`: straight into the sea there (that one is the Gulf Stream), for a hands-on check of the swim.
  const at = params.get("swim")?.split(",").map(Number);
  if (at?.length === 2 && at.every(Number.isFinite)) { beginAim(); golfApi.splash(at[0]!, at[1]!); }
});

// For an agent's browser or a hands-on check: read the state, aim, throw, guess, swim.
const golfApi = {
    state: () => ({ seed, phase, splash: splashUp, hole: hole.n, strokes, lie, basket: hole.basket, heading, power, loft, seaView, wind: wind.label, source: wind.source, currents: currents && { day: currents.day, live: currents.live }, swim: swim && { ...swim, paddling }, scores: [...scores] }),
    aim: (h: number, p: number, l?: Loft) => { heading = h; power = p; if (l) setLoft(l); aimChanged(true); },
    throw: throwDisc,
    guess,
    skipGuess: beginAim,
    /** The round-over scorecard now, with any hole not yet played entered at par (every third one wet, so both glyphs show): for a screenshot of the card. */
    card: () => { splashUp = false; drawSplash(); course.holes.forEach((h, i) => { scores[i] ??= { strokes: h.par, guessed: false, wet: i % 3 === 1 }; }); phase = "done"; globe.hideAim(); render(); },
    /** The title splash again (for a screenshot of it), and the Tee off that takes it away. */
    title: () => { splashUp = true; drawSplash(); render(); },
    teeOff,
    /** Drop the disc in the sea here and start the swim, as if a throw had landed there. */
    splash: (lat: number, lon: number) => { if (phase !== "aim" || !currents) return; lie = { lat, lon }; beginSwim(); },
    paddle: setPaddling,
    steer,
    seaView: setSeaView,
};
Object.assign(window, { golf: golfApi });

// The same functions as commands: WebMCP tools for an agent, the Cmd/Ctrl+K palette (and a corner button on a phone) for a person.
const nums = (a: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(typeof a === "object" && a ? a : {}).filter((e): e is [string, number] => typeof e[1] === "number"));
const LOFTS: readonly Loft[] = ["low", "high"];
addCommands([
  { name: "golf_state", title: "Look at the hole", group: "Hole", description: "Phase, hole, strokes, aim (heading, power, loft), wind, swim and scores.", annotations: { readOnlyHint: true }, execute: () => golfApi.state() },
  { name: "golf_aim", title: "Aim the disc", group: "Throw", description: "Heading in degrees, power, and loft (low or high).",
    inputSchema: { type: "object", properties: { heading: { type: "number" }, power: { type: "number" }, loft: { type: "string", enum: [...LOFTS] } }, required: ["heading", "power"] },
    execute: (a) => { const { heading: h = 0, power: p = 0.5 } = nums(a), l = LOFTS.find((x) => typeof a === "object" && a && Reflect.get(a, "loft") === x); golfApi.aim(h, p, l); return golfApi.state(); } },
  { name: "golf_throw", title: "Throw the disc", group: "Throw", description: "Throw with the current aim.", execute: () => { golfApi.throw(); } },
  { name: "golf_splash", title: "Splash into the sea", group: "Swim", description: "Drop the disc in the sea at lat, lon and start the swim.",
    inputSchema: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] }, execute: (a) => { const { lat = 0, lon = 0 } = nums(a); golfApi.splash(lat, lon); return golfApi.state(); } },
  { name: "golf_sea_view", title: "Toggle sea view", group: "Swim", description: "Show or hide the sea-current view.", inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
    execute: (a) => { golfApi.seaView(!(typeof a === "object" && a && Reflect.get(a, "on") === false)); } },
]);
mountPalette({ button: true });
