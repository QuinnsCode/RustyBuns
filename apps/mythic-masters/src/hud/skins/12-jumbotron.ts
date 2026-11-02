// Arcade and broadcast: an LED dot-matrix stadium scoreboard. Digits and bars are lit dots on a black board.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const dots = (v: number, max: number, cls: string, label: string) =>
  `<span class="dots ${cls}" title="${esc(label)}"><i style="width:${pct(v, max)}%"></i></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const hot = v.hits.some((h) => h.by !== i && h.age < 12);
  return `<div class="side s${i}${hot ? " hot" : ""}">
  <div class="nm">${esc(f.name)}</div>
  <div class="row"><span class="led big" title="Health">${String(Math.ceil(f.hp)).padStart(3, " ")}</span>${dots(f.hp, f.hpMax, "hp", "Health")}</div>
  <div class="row"><span class="led" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span>
    ${dots(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina: flying, sprinting and dashing spend it")}
    ${dots(f.energy, f.energyMax, "en", `Energy: specials, beams and the ultimate spend it; hold charge (${v.chargeKey}) to fill it`)}</div>
  ${f.exhausted || f.clipped ? `<div class="led warn">${f.clipped ? `${icon("feather")}CLIPPED ` : ""}${f.exhausted ? "TIRED" : ""}</div>` : ""}
  ${f.combo >= 2 ? `<div class="led combo">${f.combo} HIT COMBO</div>` : ""}
</div>`;
};

const S = '.hud[data-skin="jumbotron"]';
const DOT = "radial-gradient(circle, #000 42%, transparent 48%) 0 0 / 5px 5px";
export const skin: HudSkin = {
  id: "jumbotron", name: "Jumbotron", idea: "An LED dot-matrix stadium scoreboard: every digit and bar is a field of lit dots.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; margin: 8px 56px 0 10px; padding: 8px 12px; background: #07090c; border: 3px solid #2b3038; border-radius: 6px; box-shadow: 0 0 0 2px #0d1014, 0 6px 18px rgba(0, 0, 0, 0.6); font-family: "Courier New", ui-monospace, monospace; font-weight: 700; }
${S} .side { display: grid; gap: 4px; min-width: 0; }
${S} .s1 { order: 3; text-align: right; }
${S} .s1 .row { flex-direction: row-reverse; }
${S} .nm { color: #7fc8ff; text-transform: uppercase; letter-spacing: 0.12em; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .row { display: flex; align-items: center; gap: 8px; }
${S} .led { color: transparent; background: radial-gradient(circle, #ffb347 40%, transparent 48%) 0 0 / 4px 4px; -webkit-background-clip: text; background-clip: text; font-size: 22px; line-height: 1; white-space: pre; font-variant-numeric: tabular-nums; text-shadow: none; filter: drop-shadow(0 0 3px rgba(255, 150, 40, 0.7)); min-width: 4ch; }
${S} .led.big { font-size: 34px; min-width: 3ch; }
${S} .led.warn, ${S} .led.combo { font-size: 13px; letter-spacing: 0.08em; display: flex; gap: 4px; align-items: center; background: radial-gradient(circle, #ff5a4a 40%, transparent 48%) 0 0 / 3px 3px; -webkit-background-clip: text; background-clip: text; }
${S} .s1 .led.warn, ${S} .s1 .led.combo { justify-content: flex-end; }
${S} .led .icon { width: 13px; height: 13px; stroke: #ff5a4a; fill: none; stroke-width: 2.5; -webkit-text-fill-color: initial; }
${S} .dots { flex: 1; display: flex; height: 14px; background: #1b1f26; -webkit-mask: ${DOT.replace("#000 42%", "#000 44%")}; mask: ${DOT.replace("#000 42%", "#000 44%")}; }
${S} .s1 .dots { justify-content: flex-end; }
${S} .dots.hp { height: 20px; }
${S} .dots i { display: block; height: 100%; }
${S} .dots.hp i { background: #6dff7a; } ${S} .dots.st i { background: #7fc8ff; } ${S} .dots.st.out i { background: #ff5a4a; } ${S} .dots.en i { background: #ffd23f; }
${S} .hot .dots.hp i { background: #ff5a4a; }
${S} .clock { order: 2; align-self: center; font-size: 46px; line-height: 1; min-width: 2.4ch; text-align: center; color: transparent; background: radial-gradient(circle, #ff3b30 40%, transparent 48%) 0 0 / 5px 5px; -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 0 5px rgba(255, 50, 40, 0.8)); font-variant-numeric: tabular-nums; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; color: #6dff7a; border-top: 1px dotted #2b3038; padding-top: 4px; width: 100%; letter-spacing: 0.06em; }
${S} .bind .icon { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; }
${S} .bind small { flex-basis: 100%; text-align: center; color: #8a949f; font-weight: 400; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; margin: 6px 54px 0 6px; padding: 6px 8px; gap: 4px 10px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 30px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .led { font-size: 15px; background-size: 3px 3px; } ${S} .clock { background-size: 3px 3px; }
  ${S} .led { font-size: 15px; } ${S} .led.big { font-size: 24px; } ${S} .nm { font-size: 11px; }
  ${S} .row { gap: 4px; } ${S} .dots { height: 10px; } ${S} .dots.hp { height: 14px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${String(v.clock).padStart(2, " ")}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> BIND ${Math.round(v.bind.chance * 100)}% · INK ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
