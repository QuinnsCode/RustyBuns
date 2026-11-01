// The spy overlays that sit over the room and never take a click: the aperture that opens
// on a new mission, the dossier that types out the objective, and the rubber stamps
// (INTEL RECOVERED, DECOY) that land on a pick.

import { briefing } from "./spy.ts";
import { sfx } from "./sfx.ts";

const $ = (id: string) => document.getElementById(id)!;
let typing = 0;

/** Restart a CSS animation on an element by toggling its class. */
function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** A new mission: the aperture opens on the dark room and the dossier types out what to find. */
export function brief(seed: number, mission: number, thing: string) {
  const b = briefing(seed, thing);
  replay($("iris"), "open");
  const box = $("brief");
  box.hidden = false;
  $("brief-no").textContent = `Mission ${String(mission).padStart(2, "0")}`;
  $("brief-op").textContent = b.operation;
  const line = $("brief-obj");
  replay(box, "show");
  sfx.brief();
  sfx.teletype(8);
  // Type the objective out, a few letters a frame; reduced motion gets it at once.
  const id = ++typing;
  const text = `Objective: ${b.objective}`;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { line.textContent = text; return b; }
  let n = 0;
  const step = () => {
    if (id !== typing) return;
    n = Math.min(text.length, n + 2);
    line.textContent = text.slice(0, n);
    if (n < text.length) requestAnimationFrame(step);
  };
  step();
  return b;
}

/** The dossier tucks itself away (a find, a lobby, a menu). */
export function closeBrief() {
  typing++;
  $("brief").classList.remove("show");
  $("brief").hidden = true;
}

/** A rubber stamp across the screen: the verdict, and a line under it. */
export function stamp(kind: "found" | "decoy", word: string, under = "") {
  const s = $("stamp");
  s.className = `stamp ${kind}`;
  $("stamp-word").textContent = word;
  $("stamp-under").textContent = under;
  s.hidden = false;
  replay(s, "land");
  if (kind === "found") sfx.found(); else sfx.decoy();
}

export function clearStamp() { $("stamp").hidden = true; }
