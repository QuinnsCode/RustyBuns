// The play caller's pieces, as HTML: a unit as an icon and a big number (warships, transports,
// troops), the step strip (from, to, how many), a tile to pick, and the matchup of what you send
// against what's there, with the odds. Plain strings; main.ts wires the clicks.
import { icon } from "./icons.ts";

export type Unit = "ship" | "transport" | "troops";
const UNITS: Record<Unit, { icon: string; one: string; many: string }> = {
  ship: { icon: "rocket", one: "warship", many: "warships" },
  transport: { icon: "package", one: "transport", many: "transports" },
  troops: { icon: "users", one: "troop", many: "troops" },
};
export const unitName = (u: Unit, n: number | string) => `${n} ${n === 1 ? UNITS[u].one : UNITS[u].many}`;

/** A unit and its count: `[rocket 5]`. `side` colours it (yours, theirs), `big` for the matchup. */
export const unit = (u: Unit, n: number | string, side = "", big = false) =>
  `<span class="u ${u} ${side}${big ? " big" : ""}${n === "?" ? " fog" : ""}" title="${unitName(u, n)}">${icon(UNITS[u].icon, big ? 20 : 14)}<b>${n}</b></span>`;

export interface Step { label: string; value?: string; to?: string }
/** The strip over a call: each step numbered, the done ones showing their pick (a click goes back
 * to that step), the one we're on lit. */
export function steps(list: Step[], on: number) {
  return `<ol class="call-steps">${list.map((s, i) => {
    const state = i < on ? "done" : i === on ? "on" : "";
    const inner = `<i>${i < on ? icon("circle-check", 13) : i + 1}</i><span>${s.label}</span>${s.value ? `<b>${s.value}</b>` : ""}`;
    return `<li class="${state}">${i < on && s.to ? `<button type="button" data-call-back="${s.to}" title="Change it">${inner}</button>` : inner}</li>`;
  }).join("")}</ol>`;
}

/** A pickable tile: a name, a line under it, and the units there. */
export const tile = (attr: string, name: string, sub: string, units: string, on = false, title = "") =>
  `<button type="button" class="tile${on ? " on" : ""}" ${attr}${title ? ` title="${title}"` : ""}><span class="t-name">${name}</span>${sub ? `<span class="t-sub">${sub}</span>` : ""}<span class="t-units">${units}</span></button>`;

/** You against them, and the odds: a bar that fills to your chance, or a question mark when their
 * numbers are hidden, or "no fight" when nobody of theirs is there. */
export function vs(you: string, them: string | null, win: number | null) {
  if (them === null) return `<div class="vs nofight"><span class="vs-side">${you}</span><span class="vs-mid">${icon("arrow-right", 16)}</span><span class="vs-side">No fight: it's a move</span></div>`;
  const pct = win === null ? null : Math.round(win * 100);
  const tone = pct === null ? "fog" : pct >= 65 ? "good" : pct >= 40 ? "even" : "bad";
  return `<div class="vs ${tone}"><span class="vs-side">${you}</span><span class="vs-mid">VS</span><span class="vs-side them">${them}</span>
    <span class="odds" title="${pct === null ? "Their strength is hidden: a gamble" : `About ${pct}% to win, from what you can see`}"><i style="width:${pct ?? 50}%"></i><b>${pct === null ? "?" : `${pct}%`}</b></span></div>`;
}

/** The big count: minus, the number as a unit, plus, and how many of how many. */
export const howMany = (u: Unit, n: number, max: number, side: string) =>
  `<div class="howmany"><button type="button" data-call-n="${n - 1}" ${n > 1 ? "" : "disabled"} aria-label="Fewer">${icon("minus", 18)}</button>
    ${unit(u, n, side, true)}<button type="button" data-call-n="${n + 1}" ${n < max ? "" : "disabled"} aria-label="More">${icon("plus", 18)}</button>
    <button type="button" class="all" data-call-n="${max}" ${n < max ? "" : "disabled"} title="All of them">All ${max}</button></div>`;
