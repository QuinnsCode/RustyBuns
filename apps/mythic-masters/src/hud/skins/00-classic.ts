// The HUD the game shipped with: two dark panels, three thin bars each, the clock between them.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin } from "../skin.ts";

const bar = (v: number, max: number, cls: string, label: string, ic: string) =>
  `<span class="bar ${cls}" title="${esc(label)}">${icon(ic, label)}<span><i style="width:${pct(v, max)}%"></i></span></span>`;
const side = (f: HudSide, i: number, charge: string) => `<div class="side s${i}">
  <b>${esc(f.name)}</b>${bar(f.hp, f.hpMax, "hp", "Health", "heart")}
  <span class="launch" title="Launch: the higher, the further the next hit sends you">${icon("move-up-right", "Launch")}${Math.round(f.launch)}%</span>
  ${bar(f.stamina, f.staminaMax, `st${f.exhausted ? " out" : ""}`, "Stamina: flying, sprinting and dashing spend it", "wind")}
  ${bar(f.energy, f.energyMax, "en", `Energy: specials, beams and the ultimate spend it; hold charge (${charge}) to fill it`, "zap")}
  ${f.clipped ? `<span class="tag">${icon("feather", "Wings clipped")}grounded</span>` : ""}</div>`;

const S = '.hud[data-skin="classic"]';
export const skin: HudSkin = {
  id: "classic", name: "Classic", idea: "The shipped HUD: two panels of thin bars and a clock.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 10px 16px; }
${S} .side { background: var(--panel); border-radius: 10px; padding: 8px 10px; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; }
${S} .s1 { order: 3; }
${S} .clock { order: 2; font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 2.4ch; text-align: center; align-self: start; background: var(--panel); border-radius: 10px; padding: 4px 8px; }
${S} .launch { display: flex; align-items: center; gap: 4px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 5ch; justify-content: flex-end; }
${S} .tag { grid-column: 1 / -1; display: flex; gap: 4px; align-items: center; color: var(--hot); font-size: 12px; }
${S} .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }
${S} .bar > span { flex: 1; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; }
${S} .bar i { display: block; height: 100%; }
${S} .bar.hp i { background: var(--hp); } ${S} .bar.st i { background: var(--st); } ${S} .bar.st.out i { background: #ff6b6b; } ${S} .bar.en i { background: var(--en); }
${S} .bar.hp > span { height: 12px; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 1px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px; gap: 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, esc(v.chargeKey))).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
