// One seeded round through the running page, in headless Chrome over CDP (scripts/chrome.ts), at ?speed=4: guess the tee, throw
// into the sea and swim, hole out, play the other eight holes to the scorecard, and go again. Then the fallbacks:
// no wind relay means synthetic wind, no currents means no swim. Any page error or console.error fails it.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite, type Cdp } from "../../../scripts/chrome.ts";
import { countryAt } from "../src/countries.ts";
import { BASKET_KM, makeCourse } from "../src/course.ts";
import { SWIM_S } from "../src/currents.ts";
import { levelFor, MAX_POWER, MIN_POWER, POWER_STEP, powerFor, simulateThrow, syntheticWind } from "../src/flight.ts";
import { bearing, destination, distanceKm, type LatLon } from "../src/geo.ts";

setDefaultTimeout(240_000);
const SEED = 7, SPEED = 4;
// A swim steps at most 0.1 s a frame, so on software WebGL its clock runs near real time whatever the speed.
const SWIM_MS = SWIM_S * 1000 + 10_000;
const course = makeCourse(SEED);
const hole1 = course.holes[0]!;

/** A low throw from hole 1's tee, on the page's synthetic wind, that comes down well out to sea. */
function seaThrow() {
  const wind = levelFor(syntheticWind(), "low");
  const offshore = (p: LatLon) => [0, 90, 180, 270].every((b) => countryAt(destination(p, b, 250)) === null);
  for (let power = MAX_POWER; power >= MIN_POWER; power -= POWER_STEP)
    for (let heading = 0; heading < 360; heading += 5) {
      const f = simulateThrow({ from: hole1.tee, heading, power, loft: "low" }, wind);
      if (countryAt(f.landing) === null && offshore(f.landing) && distanceKm(f.landing, hole1.basket) > BASKET_KM * 3) return { heading, power, landing: f.landing };
    }
  throw new Error(`no sea throw from hole 1 of course ${SEED}`);
}

let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => {
  [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, ".."))]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fresh tab on `query`, with `fail` (URL endings) answered with that status instead of reaching the server. */
async function open(cdp: Cdp, query: string, fail: Record<string, number> = {}) {
  const tab = await openTab(cdp, { w: 800, h: 560 });
  cdp.on((m) => {
    if (m.sessionId !== tab.sessionId || m.method !== "Fetch.requestPaused") return;
    const hit = Object.entries(fail).find(([s]) => m.params.request.url.endsWith(s));
    void (hit
      ? tab.call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: hit[1], body: btoa("{}") })
      : tab.call("Fetch.continueRequest", { requestId: m.params.requestId }));
  });
  if (Object.keys(fail).length) await tab.call("Fetch.enable", { patterns: Object.keys(fail).map((s) => ({ urlPattern: `*${s}` })) });
  await load(cdp, tab, new URL(`/?${query}&speed=${SPEED}`, vite.url).href, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.golf?.state()").catch(() => null))}`);
  };
  const state = () => page<State>("golf.state()");
  // A page error or console.error; the failed responses asked for above are expected.
  const errors = () => tab.noise.filter((n) => !n.startsWith("HTTP "));
  await until("the course load", `window.golf && golf.state().phase !== "loading"`, 60_000);
  return { page, until, state, errors, close: tab.close };
}
interface State {
  phase: string; hole: number; strokes: number; lie: LatLon; basket: LatLon; currents: { day: string; live: boolean } | null; source: string;
  swim: { pos: LatLon; t: number; ashore: boolean; paddling: boolean } | null;
  scores: { strokes: number; guessed: boolean }[];
}

type Tab = Awaited<ReturnType<typeof open>>;
/** Aim straight at the basket at the power for its distance, throw, and wait for the disc to come to rest
 * (swimming at the basket if it lands in the sea). A new hole's guess is skipped first. */
async function strokeAtBasket(tab: Tab) {
  if ((await tab.state()).phase === "guess") {
    await tab.page("golf.skipGuess()");
    await tab.until("aiming", `golf.state().phase === "aim"`);
  }
  const s = await tab.state();
  if (process.env.ROUND_LOG) console.log(new Date().toISOString().slice(11, 19), `hole ${s.hole} stroke ${s.strokes + 1} ${Math.round(distanceKm(s.lie, s.basket))} km`);
  await tab.page(`golf.aim(${Math.round(bearing(s.lie, s.basket))}, ${powerFor(distanceKm(s.lie, s.basket))}, "low")`);
  await tab.page("golf.throw()");
  await tab.until("the disc in the air", `golf.state().phase !== "aim" || golf.state().hole !== ${s.hole}`);
  await tab.until("the disc at rest", `golf.state().phase === "swim" || golf.state().phase !== "flying"`);
  if ((await tab.state()).phase === "swim") {
    await tab.page("golf.paddle(true)");
    await tab.until("the swim's end", `golf.state().phase !== "swim"`, SWIM_MS);
  }
}

describe("a round of Alien Disc Golf", () => {
  test("tee to scorecard on a seeded course, with a swim, then the same course again", async () => {
    const tab = await open(chrome.cdp, `seed=${SEED}&wind=synthetic`);
    // Hole 1: name the tee's country for a stroke back.
    await tab.until("the guess", `golf.state().phase === "guess"`);
    expect(await tab.page<string[]>(`[...document.querySelectorAll("[data-guess]")].map((b) => b.dataset.guess)`)).toContain(hole1.teeCountry);
    await tab.page(`golf.guess(${JSON.stringify(hole1.teeCountry)})`);
    await tab.until("aiming", `golf.state().phase === "aim"`);
    expect((await tab.state()).source).toBe("synthetic");

    // Into the sea on purpose: the swim starts, the clock runs, paddling moves the disc, and it ends back in aim.
    const sea = seaThrow();
    await tab.page(`golf.aim(${sea.heading}, ${sea.power}, "low")`);
    await tab.page("golf.throw()");
    await tab.until("the swim", `golf.state().phase === "swim"`);
    const clock = () => tab.page<number>(`parseFloat(document.querySelector("#swim-clock").textContent)`);
    const first = await tab.state(), clock1 = await clock();
    expect(distanceKm(first.lie, sea.landing)).toBeLessThan(1);
    await tab.page("golf.paddle(true)");
    await sleep(1000);
    const later = await tab.state();
    expect(later.swim!.paddling).toBe(true);
    expect(later.swim!.t).toBeGreaterThan(first.swim!.t);
    expect(await clock()).toBeLessThan(clock1);
    // Paddling (60 km/s) on top of a mid-ocean current, per second of swim.
    expect(distanceKm(later.swim!.pos, first.swim!.pos) / (later.swim!.t - first.swim!.t)).toBeGreaterThan(30);
    await tab.until("the swim's end", `golf.state().phase === "aim"`, SWIM_MS);
    const after = await tab.state();
    expect(after.strokes).toBe(1);
    expect(distanceKm(after.lie, sea.landing)).toBeGreaterThan(30);

    // Hole out, then the other eight: at the basket until it's in or picked up at eight.
    while ((await tab.state()).phase !== "done") await strokeAtBasket(tab);
    const end = await tab.state();
    expect(end.scores).toHaveLength(9);
    expect(end.scores[0]!.guessed).toBe(true);
    for (const s of end.scores) expect(s.strokes).toBeWithin(1, 10);
    const net = end.scores.reduce((t, s) => t + s.strokes - (s.guessed ? 1 : 0), 0);
    const card = await tab.page<string[][]>(`[...document.querySelectorAll(".card tr")].map((r) => [...r.children].map((c) => c.textContent))`);
    expect(card).toHaveLength(11); // header, nine holes, total
    expect(card[10]![2]).toBe(String(net));

    await tab.page(`document.querySelector("#again").click()`);
    await tab.until("hole 1 again", `golf.state().phase === "guess" && golf.state().hole === 1`);
    expect((await tab.state()).scores).toEqual([]);
    expect(tab.errors()).toEqual([]);
    await tab.close();
  });

  test("paddling at a shore washes the disc up there before the clock runs out", async () => {
    const tab = await open(chrome.cdp, `seed=${SEED}&wind=synthetic&swim=39.5,-10`);
    await tab.until("the swim", `golf.state().phase === "swim"`);
    await tab.page("golf.steer(90)");
    await tab.page("golf.paddle(true)");
    let last = 0;
    for (const end = Date.now() + SWIM_MS; Date.now() < end; await sleep(20)) {
      const s = await tab.state();
      if (s.phase !== "swim") break;
      last = s.swim!.t;
    }
    const s = await tab.state();
    expect(s.phase).toBe("aim");
    expect(last).toBeLessThan(SWIM_S - 2);
    expect(countryAt(s.lie)?.name).toBe("Portugal");
    expect(tab.errors()).toEqual([]);
    await tab.close();
  });

  test("no wind relay plays the synthetic wind and says so; no currents file means a sea landing plays on", async () => {
    const tab = await open(chrome.cdp, `seed=${SEED}`, { "/api/wind": 503, "/api/currents": 503, "currents.bin": 404 });
    const st = await tab.state();
    expect(st.source).toBe("synthetic");
    expect(st.currents).toBeNull();
    const credit = await tab.page<string>(`document.querySelector("#credit").textContent`);
    expect(credit).toContain("synthetic wind (the wind relay answered 503)");
    expect(credit).not.toContain("Currents");
    await tab.page("golf.skipGuess()");
    const sea = seaThrow();
    await tab.page(`golf.aim(${sea.heading}, ${sea.power}, "low")`);
    await tab.page("golf.throw()");
    await tab.until("the landing", `golf.state().phase === "aim" && golf.state().strokes === 1`);
    expect(distanceKm((await tab.state()).lie, sea.landing)).toBeLessThan(1);
    expect(tab.errors()).toEqual([]);
    await tab.close();
  });
});
