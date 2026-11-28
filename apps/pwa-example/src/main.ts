// Pocket Dice: pick how many dice and how many sides, tap Roll. Each roll is a seed, so a link with ?seed=&n=&d=
// rolls the same dice on any phone. The dice come from the Rust roller (dice.wasm) when it loads, else from TS.
// The service worker (sw.ts) keeps all of it on the phone, so it opens offline, and the manifest lets Android
// install it as an app. `window.pocketDice.state()` is the page's state for `bun run probe pwa-example`.
import { createElement, Dices, Download, Share2, Wifi, WifiOff, type IconNode } from "lucide";
import wasmUrl from "./dice.wasm?url";
import { arr, check, int, obj, type Of } from "@rustybuns/util/guard";
import { loadRoller, tsRoller, type Roller } from "./roller.ts";
import "./menu.ts";

const COUNTS = [1, 2, 3, 4, 5, 6];
const SIDES = [4, 6, 8, 10, 12, 20];
const KEEP = 8;

/** A roll as the history keeps it in localStorage. */
const Roll = obj({ seed: int(0, 2 ** 32 - 1), n: int(1, 6), sides: int(2, 100), dice: arr(int(1, 100), 6) });
type Roll = Of<typeof Roll>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (node: IconNode) => createElement(node, { width: 20, height: 20, "stroke-width": 2, "aria-hidden": "true" });
const label = (el: HTMLElement, node: IconNode, text: string) => el.replaceChildren(icon(node), text);

const els = {
  dice: $("dice"), total: $("total"), count: $<HTMLSelectElement>("count"), sides: $<HTMLSelectElement>("sides"),
  roll: $<HTMLButtonElement>("roll"), history: $("history"), share: $<HTMLButtonElement>("share"),
  install: $<HTMLButtonElement>("install"), status: $("status"), engine: $("engine"),
};

let roller: Roller = tsRoller;
let last: Roll | null = null;
let history: Roll[] = loadHistory();
let offlineReady = false;
/** The service worker's last word: "off" in dev, "registering", "ready", or why it failed. */
let worker = "off";

for (const n of COUNTS) els.count.add(new Option(String(n), String(n)));
for (const s of SIDES) els.sides.add(new Option(`d${s}`, String(s)));
els.count.value = "2";
els.sides.value = "6";
label(els.roll, Dices, "Roll");
label(els.share, Share2, "Share roll");
label(els.install, Download, "Install app");

/** A die's face: pips for a d6, the number for the rest. */
function face(value: number, sides: number) {
  const d = document.createElement("div");
  d.className = `die d${sides}`;
  d.setAttribute("aria-label", String(value));
  if (sides === 6) {
    d.classList.add("pips", `p${value}`);
    for (let i = 0; i < value; i++) d.append(document.createElement("i"));
  } else d.textContent = String(value);
  return d;
}

function show(r: Roll) {
  last = r;
  els.dice.replaceChildren(...r.dice.map((v) => face(v, r.sides)));
  els.total.textContent = r.n > 1 ? `Total ${r.dice.reduce((a, b) => a + b, 0)}` : "";
  els.history.replaceChildren(...history.map((h) => {
    const li = document.createElement("li");
    li.textContent = `${h.n}d${h.sides}: ${h.dice.join(" + ")}${h.n > 1 ? ` = ${h.dice.reduce((a, b) => a + b, 0)}` : ""}`;
    return li;
  }));
}

function roll(seed = crypto.getRandomValues(new Uint32Array(1))[0]!) {
  const n = Number(els.count.value), sides = Number(els.sides.value);
  const r = { seed, n, sides, dice: roller.roll(seed, n, sides) };
  history = [r, ...history].slice(0, KEEP);
  saveHistory();
  show(r);
  els.dice.animate([{ transform: "rotate(-8deg) scale(.9)" }, { transform: "none" }], { duration: 180, easing: "ease-out" });
  return r;
}

function loadHistory(): Roll[] {
  try { return check(arr(Roll, 50, { drop: true }), JSON.parse(localStorage.getItem("pocket-dice") ?? "[]"))?.slice(0, KEEP) ?? []; }
  catch { return []; }
}
function saveHistory() { try { localStorage.setItem("pocket-dice", JSON.stringify(history)); } catch { /* private mode: history lives for the visit */ } }

function shareUrl(r: Roll) {
  const u = new URL(location.origin);
  u.search = new URLSearchParams({ seed: String(r.seed), n: String(r.n), d: String(r.sides) }).toString();
  return u.href;
}

function setStatus() {
  const online = navigator.onLine;
  label(els.status, online ? Wifi : WifiOff, offlineReady ? (online ? "Works offline" : "Offline") : online ? "Online" : "Offline, not cached yet");
  els.status.dataset.ok = String(offlineReady);
}

els.roll.addEventListener("click", () => roll());
els.share.addEventListener("click", async () => {
  if (!last) return;
  const url = shareUrl(last);
  if (navigator.share) await navigator.share({ title: "Pocket Dice", url }).catch(() => {});
  else await navigator.clipboard?.writeText(url).then(() => label(els.share, Share2, "Link copied"), () => {});
});

// Android Chrome offers the install itself; this button is the same offer in reach, while the browser has one.
let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as Event & { prompt(): Promise<void> };
  els.install.hidden = false;
});
els.install.addEventListener("click", async () => { await installPrompt?.prompt(); installPrompt = null; els.install.hidden = true; });
addEventListener("appinstalled", () => { els.install.hidden = true; });
addEventListener("online", setStatus);
addEventListener("offline", setStatus);
setStatus();

// Not under the dev server (import.meta.hot): a worker caching its modules would serve stale code after every edit.
if ("serviceWorker" in navigator && !import.meta.hot) {
  worker = "registering";
  navigator.serviceWorker.register("/sw.js").catch((e) => { worker = String(e); console.warn("no service worker:", e); });
  navigator.serviceWorker.ready.then(() => { worker = "ready"; offlineReady = true; setStatus(); });
}

const ready = loadRoller(wasmUrl).then((r) => {
  roller = r;
  els.engine.textContent = r.engine === "wasm" ? "Rust (wasm)" : "TypeScript";
  const q = new URLSearchParams(location.search), seed = Number(q.get("seed"));
  if (COUNTS.includes(Number(q.get("n")))) els.count.value = q.get("n")!;
  if (SIDES.includes(Number(q.get("d")))) els.sides.value = q.get("d")!;
  if (q.has("seed") && Number.isInteger(seed) && seed >= 0) roll(seed);
  else if (history[0]) show(history[0]);
  else roll();
});

declare global { interface Window { pocketDice: typeof handle } }
const handle = {
  /** What is on screen: the engine, whether the worker has the app cached, the last roll and its link. */
  state: async () => {
    await ready;
    return { engine: roller.engine, worker, offlineReady, online: navigator.onLine, controlled: !!navigator.serviceWorker?.controller, last, link: last && shareUrl(last), history: history.length };
  },
  /** Rolls as the button does, with this seed if given. */
  roll: async (seed?: number) => { await ready; return roll(seed); },
};
window.pocketDice = handle;
