// Arcade and broadcast: calm serif captions like a wildlife documentary, with a narrator line for the latest hit.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const narrate = (v: HudView) => {
  const h = v.hits.find((x) => x.age < 100);
  if (v.over) return "And so the contest ends.";
  if (!h) return "";
  const a = v.sides[h.by]!.name, b = v.sides[1 - h.by]!.name;
  return h.guarded ? `${b} turns the blow aside.` : h.rear ? `${a} strikes from behind.` : `${a} strikes ${b}.`;
};
const side = (f: HudSide, i: number, v: HudView) => `<div class="side s${i}">
  <div class="nm">${esc(f.name)}</div>
  <div class="facts">${f.massKg} kg · ${f.heightM} m · ${esc(f.fields.map((x) => x[0]!.toUpperCase() + x.slice(1)).join(", "))}</div>
  <div class="vit" title="Health"><span>Vitality</span><i><u style="width:${pct(f.hp, f.hpMax)}%"></u></i><b>${Math.ceil(f.hp)}</b></div>
  <div class="vit" title="Stamina: flying, sprinting and dashing spend it"><span>${f.exhausted ? "Spent" : "Stamina"}</span><i class="${f.exhausted ? "out" : "st"}"><u style="width:${pct(f.stamina, f.staminaMax)}%"></u></i></div>
  <div class="vit" title="Energy: the special, the big move and the ultimate spend it; landing and taking hits fill it"><span>Energy</span><i class="en"><u style="width:${pct(f.energy, f.energyMax)}%"></u></i></div>
  <div class="note" title="Launch: the higher, the further the next hit sends you">Thrown ${Math.round(f.launch)}%${f.combo >= 2 ? ` · ${f.combo} blows unanswered` : ""}${f.clipped ? ` · ${icon("feather")}wings clipped` : ""}</div>
</div>`;

const S = '.hud[data-skin="nature-doc"]';
export const skin: HudSkin = {
  id: "nature-doc", name: "Nature documentary", idea: "Serif captions with mass, height and field, hairline vitality bars and a narrator line.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 12px 64px 0 20px; font-family: "IM Fell English", Georgia, "Times New Roman", serif; color: #f1ead8; text-shadow: 0 1px 3px #000, 0 0 6px rgba(0, 0, 0, 0.8), 0 0 16px rgba(0, 0, 0, 0.6); }
${S} .side { display: grid; gap: 3px; max-width: 340px; }
${S} .s1 { order: 3; justify-self: end; text-align: right; }
${S} .nm { font-size: 26px; font-style: italic; line-height: 1.05; }
${S} .facts { font-size: 13px; opacity: 0.8; letter-spacing: 0.03em; }
${S} .vit { display: grid; grid-template-columns: 5.5em 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
${S} .s1 .vit { direction: rtl; } ${S} .s1 .vit > * { direction: ltr; }
${S} .vit span { opacity: 0.85; font-style: italic; text-align: left; }
${S} .s1 .vit span { text-align: right; }
${S} .vit i { display: block; height: 3px; background: rgba(241, 234, 216, 0.4); }
${S} .vit u { display: block; height: 100%; background: #f1ead8; text-decoration: none; }
${S} .s1 .vit u { margin-left: auto; }
${S} .vit:first-of-type i { height: 5px; }
${S} .vit i.st u { background: #b9d8e8; } ${S} .vit i.out u { background: #e59a8a; } ${S} .vit i.en u { background: #e9cf86; }
${S} .vit b { font-weight: 400; font-size: 15px; min-width: 3ch; font-variant-numeric: tabular-nums; }
${S} .note { font-size: 13px; font-style: italic; opacity: 0.85; }
${S} .note .icon { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; vertical-align: -1px; }
${S} .mid { order: 2; text-align: center; min-width: 8em; }
${S} .clock { font-size: 22px; font-variant-numeric: tabular-nums; letter-spacing: 0.08em; }
${S} .narr { font-size: 15px; font-style: italic; opacity: 0.9; min-height: 1.3em; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; text-align: center; font-size: 15px; font-style: italic; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; align-items: center; border-top: 1px solid rgba(241, 234, 216, 0.4); border-bottom: 1px solid rgba(241, 234, 216, 0.4); padding: 3px 18px; }
${S} .bind .icon { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; }
${S} .bind small { flex-basis: 100%; opacity: 0.8; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 62px 0 10px; gap: 4px 10px; }
  ${S} .mid { grid-column: 1 / -1; order: 0; display: flex; gap: 10px; justify-content: center; align-items: baseline; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .nm { font-size: 19px; } ${S} .facts { font-size: 11px; }
  ${S} .vit { grid-template-columns: 1fr; gap: 0; font-size: 11px; } ${S} .vit span, ${S} .vit b { display: none; }
  ${S} .note { font-size: 11px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="mid"><div class="clock">${mmss(v.clock)}</div><div class="narr">${esc(narrate(v))}</div></div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> a binding, ${Math.round(v.bind.chance * 100)}% likely · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
