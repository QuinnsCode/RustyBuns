// Classic's layout as a case file: the card art clipped on as a mugshot, the angled HP bar in black on manila with the
// chunk just lost trailing in grey (red hatching is what comes back), stamina and four energy cells under it, hits
// stamped. Health left shrinks toward its own side: the left fighter's bar loses from its right end.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView, type Party } from "../skin.ts";

const sev = (d: number) => (d >= 25 ? "CRITICAL" : d >= 12 ? "SEVERE" : "MINOR");
const pips = (p: Party | null) => !p || p.size < 2 ? "" : `<span class="pips" title="The line-up: ${p.size - p.down.length} of ${p.size} still standing">${
  Array.from({ length: p.size }, (_, i) => `<i class="${p.down.includes(i) ? "down" : i === p.up ? "up" : ""}"></i>`).join("")}</span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const stamp = v.hits.find((h) => h.by !== i);
  const pic = f.art ? `<span class="pic" style="background-image:url('${esc(f.art)}')"></span>` : `<span class="pic"><b>${esc(f.name.slice(0, 1))}</b></span>`;
  return `<div class="side s${i}">${pic}<div class="body">
  <div class="plate"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">LAUNCH ${Math.round(f.launch)}%</span></div>
  <div class="hp" title="Health"><i class="trail" style="width:${pct(f.hpTrail, f.hpMax)}%"></i><i class="red" title="Comes back if you stay clear of hits" style="width:${pct(f.hpRed, f.hpMax)}%"></i><i class="fill" style="width:${pct(f.hp, f.hpMax)}%"></i></div>
  <div class="meters"><span class="st${f.exhausted ? " out" : ""}" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>
  <span class="en" title="Energy: the special, the big move and the ultimate spend it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${pips(f.party)}${f.clipped ? `<span class="note">${icon("feather", "Wings clipped")} grounded</span>` : ""}</div>
  ${stamp ? `<span class="stamp" style="animation-delay:-${(stamp.age / 60).toFixed(2)}s">${stamp.guarded ? "BLOCKED" : sev(stamp.damage)}</span>` : ""}</div>`;
};

const S = '.hud[data-skin="classic-file"]';
export const skin: HudSkin = {
  id: "classic-file", name: "Classic file", idea: "Classic's portraits, angled bars and damage trail, printed as a manila case file with a black life bar.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 14px; padding: 12px 64px 0 16px; font-family: "Courier New", Courier, monospace; color: #2b2118; }
${S} .side { position: relative; display: flex; gap: 10px; align-items: flex-start; min-width: 0; padding: 8px 10px; background: #e8d5a6; border: 1px solid #a8905a; box-shadow: 0 2px 0 #a8905a, 0 4px 8px rgba(0,0,0,.4);
  transform: translateX(calc((var(--hud-in, 1) - 1) * 120%)); }
${S} .s1 { order: 3; flex-direction: row-reverse; transform: translateX(calc((1 - var(--hud-in, 1)) * 120%)); }
${S} .pic { position: relative; flex: none; width: 60px; height: 64px; background: #2b2118 center / cover no-repeat; border: 3px solid #f6ecd0; box-shadow: 0 1px 3px rgba(0,0,0,.5); transform: rotate(-3deg); filter: sepia(.45) contrast(1.05);
  display: grid; place-items: center; font: 700 26px/1 "Courier New", monospace; color: #f6ecd0; }
${S} .s1 .pic { transform: rotate(3deg); }
${S} .pic::after { content: ""; position: absolute; left: 18px; top: -9px; width: 10px; height: 20px; border: 2px solid #7b7f86; border-radius: 6px; }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 4px; }
${S} .plate { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 14px; text-transform: uppercase; }
${S} .plate b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } ${S} .s1 .plate { flex-direction: row-reverse; }
${S} .launch { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
${S} .hp { position: relative; height: 18px; background: #f6ecd0; border: 1.5px solid #14110d; overflow: hidden; transform: skewX(-14deg); }
${S} .s1 .hp { transform: skewX(14deg); }
${S} .hp i { position: absolute; top: 0; bottom: 0; left: 0; } ${S} .s1 .hp i { left: auto; right: 0; }
${S} .hp .trail { background: #8f8676; }
${S} .hp .red { background: repeating-linear-gradient(-45deg, #b3261e 0 3px, transparent 3px 6px); }
${S} .hp .fill { background: repeating-linear-gradient(135deg, #14110d 0 5px, #231d15 5px 10px); transition: width .15s linear; }
${S} .meters { display: grid; grid-template-columns: 1fr 1.4fr; gap: 6px; } ${S} .s1 .meters { direction: rtl; }
${S} .meters span { position: relative; height: 7px; border-bottom: 1px solid #2b2118; overflow: hidden; }
${S} .meters i { position: absolute; top: 0; bottom: 0; left: 0; background: #2b2118; } ${S} .s1 .meters i { left: auto; right: 0; }
${S} .st.out i { background: #b3261e; } ${S} .en i { background: #6b4a12; }
${S} .en::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(25% - 2px), #e8d5a6 calc(25% - 2px) 25%); }
${S} .pips { display: flex; gap: 4px; } ${S} .s1 .pips { flex-direction: row-reverse; }
${S} .pips i { width: 11px; height: 11px; border: 1.5px solid #2b2118; } ${S} .pips i.up { background: #2b2118; } ${S} .pips i.down { background: repeating-linear-gradient(45deg, #b3261e 0 2px, transparent 2px 4px); }
${S} .note { font-size: 11px; color: #8a2a1a; display: flex; gap: 4px; align-items: center; }
${S} .stamp { position: absolute; right: 14px; bottom: -10px; transform: rotate(-9deg); border: 3px solid #b3261e; color: #b3261e; padding: 0 8px; font-size: 18px; font-weight: 700; letter-spacing: .08em; opacity: 0; animation: cf-stamp 2s linear both; background: rgba(232,213,166,.7); }
${S} .s1 .stamp { right: auto; left: 14px; transform: rotate(7deg); }
@keyframes cf-stamp { 0% { opacity: 0; scale: 2; } 8% { opacity: 1; scale: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
${S} .clock { order: 2; align-self: start; background: #f6ecd0; border: 1px solid #a8905a; padding: 2px 10px; text-align: center; font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: 0 2px 0 #a8905a;
  transform: translateY(calc((var(--hud-in, 1) - 1) * 140%)); }
${S} .clock small { display: block; font-size: 9px; letter-spacing: .15em; font-weight: 400; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #f6ecd0; border: 1px solid #a8905a; padding: 4px 12px; font-size: 13px; text-align: center; }
${S} .bind small { display: block; opacity: .7; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 8px 0; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 18px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .side { gap: 6px; padding: 6px; }
  ${S} .pic { width: 36px; height: 40px; border-width: 2px; } ${S} .pic::after { display: none; }
  ${S} .plate { font-size: 11px; flex-wrap: wrap; } ${S} .hp { height: 13px; } ${S} .stamp { font-size: 12px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock" title="Seconds left"><small>TIME</small>${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} Subject may be recruited: <b>${Math.round(v.bind.chance * 100)}%</b> · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
