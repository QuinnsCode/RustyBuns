// One shared bar across the top: the fight's momentum, each side's share of the health still standing.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin } from "../skin.ts";

const small = (v: number, max: number, cls: string, t: string) => `<span class="mini ${cls}" title="${esc(t)}"><i style="width:${pct(v, max)}%"></i></span>`;
const end = (f: HudSide, i: number) => `<div class="end e${i}">
  <div class="top"><b>${esc(f.name)}</b>${f.combo > 1 ? `<em>x${f.combo}</em>` : ""}${f.clipped ? icon("feather", "Wings clipped") : ""}</div>
  <div class="hpn">${Math.round(f.hp)}<small>/${Math.round(f.hpMax)}</small></div>
  <div class="pc" title="Launch">${icon("move-up-right", "Launch")}${Math.round(f.launch)}%</div>
  ${small(f.hp, f.hpMax, "hp", "Health")}${small(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina")}${small(f.energy, f.energyMax, "en", "Energy")}</div>`;

const S = '.hud[data-skin="tug-of-war"]';
export const skin: HudSkin = {
  id: "tug-of-war", name: "Tug of war", idea: "One shared bar: the line slides toward whoever has less health left.",
  css: `
${S} { padding: 8px 56px 0 12px; }
${S} .rope { position: relative; height: 22px; border-radius: 11px; overflow: hidden; background: #222; box-shadow: 0 0 0 2px var(--panel), 0 4px 12px rgba(0, 0, 0, 0.5); }
${S} .rope .a, ${S} .rope .b { position: absolute; top: 0; bottom: 0; transition: width 0.15s linear; }
${S} .rope .a { left: 0; background: linear-gradient(90deg, #3d8bfd, #7fc8ff); }
${S} .rope .b { right: 0; background: linear-gradient(270deg, #ff6b35, #ffb347); }
${S} .knot { position: absolute; top: -2px; width: 4px; height: 26px; background: #fff; box-shadow: 0 0 10px #fff; transition: left 0.15s linear; }
${S} .clock { position: absolute; top: 8px; left: calc(50% - 28px); width: 56px; text-align: center; font-weight: 700; font-size: 15px; text-shadow: 0 1px 3px #000; font-variant-numeric: tabular-nums; }
${S} .ends { display: flex; justify-content: space-between; margin-top: 4px; }
${S} .end { width: min(30vw, 190px); display: grid; gap: 3px; text-shadow: 0 1px 3px #000; }
${S} .e1 { text-align: right; justify-items: end; }
${S} .top { display: flex; gap: 6px; align-items: center; font-size: 13px; } ${S} .top em { color: var(--hot); font-style: normal; font-weight: 700; }
${S} .hpn { font-size: 26px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; } ${S} .hpn small { font-size: 12px; color: var(--dim); }
${S} .pc { display: flex; align-items: center; gap: 4px; font-weight: 700; font-variant-numeric: tabular-nums; }
${S} .mini { display: block; width: 100%; height: 5px; background: rgba(255, 255, 255, 0.12); border-radius: 3px; overflow: hidden; }
${S} .mini i { display: block; height: 100%; }
${S} .mini.hp { height: 8px; } ${S} .mini.hp i { background: var(--hp); } ${S} .mini.st i { background: var(--st); } ${S} .mini.st.out i { background: #ff6b6b; } ${S} .mini.en i { background: var(--en); }
${S} .bind { margin: 6px auto 0; width: max-content; max-width: 90vw; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 1px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) { ${S} { padding: 8px 60px 0 8px; } ${S} .end { width: 42vw; } ${S} .hpn { font-size: 20px; } ${S} .clock { top: 6px; } }`,
  render(v) {
    const [a, b] = v.sides, fa = a.hp / a.hpMax, fb = b.hp / b.hpMax, share = fa + fb > 0 ? (fa / (fa + fb)) * 100 : 50;
    return `<div class="rope"><i class="a" style="width:${share.toFixed(1)}%"></i><i class="b" style="width:${(100 - share).toFixed(1)}%"></i><i class="knot" style="left:calc(${share.toFixed(1)}% - 2px)"></i></div>
<div class="clock">${v.clock}</div><div class="ends">${end(a, 0)}${end(b, 1)}</div>`
      + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : "");
  },
};
