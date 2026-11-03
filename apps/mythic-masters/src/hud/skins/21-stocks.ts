// Stocks: your line-up is your life count. Each corner holds the fighting beast's card in an angled frame, its
// name and who plays it (Player 1, CPU); a long slanted HP bar with a gold trim and notches runs in toward a
// hexagon clock, the chunk just lost trailing pale before it drains. Under it a four-cell energy meter, and under
// that the stocks: one pip per beast in the line-up joined by a line, a lock on each one down, the one fighting
// lit, the rest hollow rings. A quick fight has one stock. Launch % sits by the portrait, brawler-style.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

/** How full each of the four energy cells is, 0..1. */
export const cells = (energy: number, max: number) => [0, 1, 2, 3].map((k) => Math.min(1, Math.max(0, (energy / (max || 1)) * 4 - k)));

const stocks = (f: HudSide) => {
  const p = f.party ?? { size: 1, down: [], up: 0 };
  const pip = (i: number) => p.down.includes(i) ? `<i class="down">${icon("lock", "Down")}</i>` : `<i class="${i === p.up ? "up" : "left"}"></i>`;
  return `<span class="stocks" title="Stocks: ${p.size - p.down.length} of ${p.size} still standing">${Array.from({ length: p.size }, (_, i) => pip(i)).join("")}</span>`;
};

const side = (f: HudSide, i: number, charge: string) => {
  const low = f.hp / (f.hpMax || 1) < 0.25, full = f.energy >= f.energyMax;
  const pic = f.art ? `<span class="pic" style="background-image:url('${esc(f.art)}')"></span>` : `<span class="pic"><b>${esc(f.name.slice(0, 1))}</b></span>`;
  return `<div class="side s${i}" style="--tier:var(--t-${f.tier})">
  <div class="face">${pic}<span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}<small>%</small></span></div>
  <div class="body">
    <div class="hp${low ? " low" : ""}" title="Health ${Math.ceil(f.hp)} of ${Math.round(f.hpMax)}"><i class="trail" style="width:${pct(f.hpTrail, f.hpMax)}%"></i><i class="red" style="width:${pct(f.hpRed, f.hpMax)}%"></i><i class="fill" style="width:${pct(f.hp, f.hpMax)}%"></i></div>
    <div class="plate"><b>${esc(f.name)}</b><small>${f.bot ? "CPU" : `Player ${i + 1}`}</small></div>
    <span class="en${full ? " full" : ""}" title="Energy: specials, beams and the ultimate spend it; hold charge (${charge}) to fill it">${cells(f.energy, f.energyMax).map((c) => `<i style="--c:${c.toFixed(2)}"></i>`).join("")}</span>
    ${stocks(f)}
  </div></div>`;
};

const round = (v: HudView) => { const p = v.sides[0].party; return p && p.size > 1 ? `<small>Round ${p.down.length + 1}</small>` : ""; };

const S = '.hud[data-skin="stocks"]';
export const skin: HudSkin = {
  id: "stocks", name: "Stocks", idea: "The line-up as stocks: portrait, a long trimmed bar with a damage trail, energy cells and a pip per beast.",
  css: `
${S} { --edge: #f4f1ea; --gold: #d9b45a; --track: rgba(10, 12, 16, 0.82); --ring: 0 0 0 1.5px rgba(0, 0, 0, 0.75); --drop: 0 3px 0 rgba(0, 0, 0, 0.35);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 12px; padding: 12px 64px 0 16px; text-shadow: 0 1px 0 #000, 0 0 2px #000; }
${S} .side { display: flex; gap: 10px; align-items: flex-start; min-width: 0; transform: translateX(calc((var(--hud-in, 1) - 1) * 120%)); }
${S} .s1 { order: 3; flex-direction: row-reverse; transform: translateX(calc((1 - var(--hud-in, 1)) * 120%)); }
${S} .face { position: relative; flex: none; }
${S} .pic { display: grid; place-items: center; width: 72px; height: 72px; background: #1a2029 center / cover no-repeat; border: 3px solid var(--tier, var(--edge));
  clip-path: polygon(14% 0, 100% 0, 86% 100%, 0 100%); font: 700 30px/1 system-ui, sans-serif; color: var(--dim); }
${S} .s1 .pic { clip-path: polygon(0 0, 86% 0, 100% 100%, 14% 100%); }
${S} .launch { position: absolute; bottom: -6px; right: -4px; white-space: nowrap; font: 800 18px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums; color: var(--hot); }
${S} .s1 .launch { right: auto; left: -4px; }
${S} .launch small { font-size: 11px; }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 4px; justify-items: start; }
${S} .s1 .body { justify-items: end; }
${S} .hp { position: relative; justify-self: stretch; height: 20px; background: var(--track); border: 2px solid var(--gold); box-shadow: var(--ring), var(--drop); overflow: hidden;
  clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); }
${S} .s1 .hp { clip-path: polygon(0 0, 100% 0, 100% 100%, 14px 100%); }
${S} .hp::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(217, 180, 90, 0.55) calc(10% - 1px) 10%); }
${S} .hp i { position: absolute; top: 0; bottom: 0; right: 0; }
${S} .s1 .hp i { right: auto; left: 0; }
${S} .hp .trail { background: #f4f1ea; opacity: 0.85; }
${S} .hp .red { background: repeating-linear-gradient(-45deg, #d9534a 0 4px, #a8322b 4px 8px); }
${S} .hp .fill { background: linear-gradient(#8ee69a, var(--hp) 55%, #3e9c50); }
${S} .hp.low .fill { background: linear-gradient(#ff9a7a, #ff5b4a 55%, #b83226); }
${S} .plate { display: flex; align-items: baseline; gap: 8px; max-width: 100%; font-size: 15px; }
${S} .s1 .plate { flex-direction: row-reverse; }
${S} .plate b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .plate small { flex: none; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--dim); }
${S} .en { display: flex; gap: 3px; }
${S} .s1 .en { flex-direction: row-reverse; }
${S} .en i { position: relative; width: 30px; height: 8px; background: var(--track); border: 1.5px solid var(--edge); box-shadow: var(--ring); transform: skewX(-24deg); overflow: hidden; }
${S} .s1 .en i { transform: skewX(24deg); }
${S} .en i::after { content: ""; position: absolute; inset: 0; background: var(--en); transform-origin: left; transform: scaleX(var(--c)); }
${S} .s1 .en i::after { transform-origin: right; }
${S} .en.full i { box-shadow: var(--ring), 0 0 8px var(--en); }
${S} .stocks { position: relative; display: flex; gap: 10px; align-items: center; margin-top: 2px; }
${S} .s1 .stocks { flex-direction: row-reverse; }
${S} .stocks::before { content: ""; position: absolute; left: 6px; right: 6px; top: 50%; height: 2px; margin-top: -1px; background: var(--edge); opacity: 0.6; box-shadow: var(--ring); }
${S} .stocks i { position: relative; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--edge); background: var(--track); box-shadow: var(--ring); display: grid; place-items: center; }
${S} .stocks i.up { background: var(--hot); border-color: #fff3d6; box-shadow: var(--ring), 0 0 10px var(--hot); }
${S} .stocks i.down { border-color: var(--dim); color: var(--dim); background: #141920; }
${S} .stocks .icon { width: 9px; height: 9px; }
${S} .clock { order: 2; isolation: isolate; position: relative; width: 66px; height: 58px; display: grid; place-content: center; justify-items: center; font: 800 26px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums;
  background: var(--gold); clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); transform: translateY(calc((var(--hud-in, 1) - 1) * 140%)); }
${S} .clock::before { content: ""; position: absolute; inset: 3px; background: #141920; clip-path: inherit; z-index: -1; }
${S} .clock small { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 2px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; box-shadow: var(--ring), var(--drop); opacity: var(--hud-in, 1); }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 8px 0; gap: 6px 10px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; width: 52px; height: 44px; font-size: 19px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .side { gap: 6px; }
  ${S} .pic { width: 44px; height: 44px; border-width: 2px; font-size: 18px; }
  ${S} .launch { font-size: 13px; } ${S} .clock small { display: none; }
  ${S} .hp { height: 14px; }
  ${S} .plate { font-size: 12px; } ${S} .plate small { display: none; }
  ${S} .en i { width: 18px; height: 6px; }
  ${S} .stocks { gap: 6px; } ${S} .stocks i { width: 11px; height: 11px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, esc(v.chargeKey))).join("")
    + `<div class="clock">${v.clock}${round(v)}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
