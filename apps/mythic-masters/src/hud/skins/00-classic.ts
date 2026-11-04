// The default fight HUD: each fighter's card in a framed corner, an angled HP bar running in from it toward the
// clock (the chunk just lost trails behind, then drains; red stripes are what comes back if you get clear), a thin stamina line and a four-cell energy meter under
// it, and on a journey the line-up as lives. Outlines and shadows are borders and hard box-shadows only (no blur
// filters), so it costs nothing on a phone. `--hud-in` (0..1, set by the page from the director) slides each side
// in from its own edge and drops the clock in from the top.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type Party } from "../skin.ts";

const pips = (p: Party | null) => !p || p.size < 2 ? "" : `<span class="pips" title="The line-up: ${p.size - p.down.length} of ${p.size} still standing">${
  Array.from({ length: p.size }, (_, i) => p.down.includes(i) ? `<i class="down">${icon("lock")}</i>` : `<i class="${i === p.up ? "up" : ""}"></i>`).join("")}</span>`;

const side = (f: HudSide, i: number) => {
  const low = f.hp / (f.hpMax || 1) < 0.25, full = f.energy >= f.energyMax;
  const pic = f.art ? `<span class="pic" style="background-image:url('${esc(f.art)}')"></span>` : `<span class="pic"><b>${esc(f.name.slice(0, 1))}</b></span>`;
  return `<div class="side s${i}" style="--tier:var(--t-${f.tier})">${pic}<div class="body">
  <div class="plate"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${icon("move-up-right", "Launch")}${Math.round(f.launch)}%</span></div>
  <div class="hp${low ? " low" : ""}" title="Health"><i class="trail" style="width:${pct(f.hpTrail, f.hpMax)}%"></i><i class="red" title="Comes back if you stay clear of hits" style="width:${pct(f.hpRed, f.hpMax)}%"></i><i class="fill" style="width:${pct(f.hp, f.hpMax)}%"></i></div>
  <div class="meters"><span class="st${f.exhausted ? " out" : ""}" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>
  <span class="en${full ? " full" : ""}" title="Energy: the special, the big move and the ultimate spend it; landing and taking hits fill it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${pips(f.party)}${f.clipped ? `<span class="tag">${icon("feather", "Wings clipped")}grounded</span>` : ""}</div></div>`;
};

const S = '.hud[data-skin="classic"]';
export const skin: HudSkin = {
  id: "classic", name: "Classic", idea: "Framed portraits, angled bars with a damage trail, an energy meter in cells, the line-up as lives.",
  css: `
${S} { --edge: rgba(244, 241, 234, 0.92); --track: rgba(10, 12, 16, 0.78); --drop: 0 3px 0 rgba(0, 0, 0, 0.35); --ring: 0 0 0 1.5px rgba(0, 0, 0, 0.7);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 14px; padding: 12px 64px 0 16px; text-shadow: 0 1px 0 #000, 0 0 2px #000; }
${S} .side { display: flex; gap: 10px; align-items: flex-start; min-width: 0; transform: translateX(calc((var(--hud-in, 1) - 1) * 120%)); }
${S} .s1 { order: 3; flex-direction: row-reverse; transform: translateX(calc((1 - var(--hud-in, 1)) * 120%)); }
${S} .pic { flex: none; width: 64px; height: 64px; border-radius: 10px; background: #1a2029 center / cover no-repeat; border: 3px solid var(--tier, var(--edge));
  box-shadow: var(--ring), var(--drop); display: grid; place-items: center; font: 700 28px/1 system-ui, sans-serif; color: var(--dim); }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 4px; }
${S} .plate { min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 15px; letter-spacing: 0.02em; }
${S} .plate b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .s1 .plate { flex-direction: row-reverse; }
${S} .launch { display: flex; align-items: center; gap: 3px; font-weight: 800; font-size: 17px; font-variant-numeric: tabular-nums; color: var(--hot); }
${S} .hp { position: relative; height: 18px; background: var(--track); border: 2px solid var(--edge); border-radius: 3px; box-shadow: var(--ring), var(--drop); overflow: hidden; transform: skewX(-18deg); }
${S} .s1 .hp { transform: skewX(18deg); }
${S} .hp i { position: absolute; top: 0; bottom: 0; right: 0; }
${S} .s1 .hp i { right: auto; left: 0; }
${S} .hp .trail { background: #f4f1ea; opacity: 0.85; }
${S} .hp .red { background: repeating-linear-gradient(-45deg, #d9534a 0 4px, #a8322b 4px 8px); }
${S} .hp .fill { background: linear-gradient(#8ee69a, var(--hp) 55%, #3e9c50); }
${S} .hp.low .fill { background: linear-gradient(#ff9a7a, #ff5b4a 55%, #b83226); }
${S} .meters { display: grid; grid-template-columns: 1fr 1.4fr; gap: 6px; }
${S} .s1 .meters { direction: rtl; }
${S} .meters span { position: relative; height: 9px; background: var(--track); border: 1.5px solid var(--edge); border-radius: 2px; box-shadow: var(--ring); overflow: hidden; transform: skewX(-18deg); }
${S} .s1 .meters span { transform: skewX(18deg); }
${S} .meters i { position: absolute; top: 0; bottom: 0; right: 0; }
${S} .s1 .meters i { right: auto; left: 0; }
${S} .st i { background: var(--st); } ${S} .st.out i { background: #ff6b6b; }
${S} .en i { background: var(--en); }
${S} .en::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(25% - 2px), var(--edge) calc(25% - 2px) 25%); }
${S} .en.full { box-shadow: var(--ring), 0 0 10px var(--en); }
${S} .pips { display: flex; gap: 5px; align-items: center; margin-top: 2px; }
${S} .s1 .pips { flex-direction: row-reverse; }
${S} .pips i { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--edge); background: var(--track); box-shadow: var(--ring); display: grid; place-items: center; }
${S} .pips i.up { background: var(--hot); box-shadow: var(--ring), 0 0 8px var(--hot); }
${S} .pips i.down { border-color: var(--dim); color: var(--dim); background: none; box-shadow: none; }
${S} .pips .icon { width: 9px; height: 9px; }
${S} .tag { display: flex; gap: 4px; align-items: center; color: var(--hot); font-size: 12px; }
${S} .clock { order: 2; position: relative; width: 64px; height: 56px; display: grid; place-items: center; font: 800 26px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums;
  background: var(--edge); clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); transform: translateY(calc((var(--hud-in, 1) - 1) * 140%)); }
${S} .clock::before { content: ""; position: absolute; inset: 3px 3px; background: #141920; clip-path: inherit; z-index: -1; }
${S} .clock { isolation: isolate; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 2px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; box-shadow: var(--ring), var(--drop); opacity: var(--hud-in, 1); }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 8px 0; gap: 6px 10px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; width: 48px; height: 40px; font-size: 19px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .side { gap: 6px; }
  ${S} .pic { width: 40px; height: 40px; border-width: 2px; font-size: 18px; }
  ${S} .plate { font-size: 12px; } ${S} .launch { font-size: 13px; }
  ${S} .hp { height: 13px; }
  ${S} .meters span { height: 7px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
