// Arcade and broadcast: minimal. Thin lines along the screen edges, nothing in the middle of the fight.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const side = (f: HudSide, i: number, v: HudView) => {
  const flash = Math.max(0, 1 - (v.hits.find((h) => h.by !== i)?.age ?? 99) / 14);
  return `<div class="side s${i}">
  <div class="hpline" title="Health" style="--flash:${flash.toFixed(2)}"><i style="width:${pct(f.hp, f.hpMax)}%"></i></div>
  <div class="vline st${f.exhausted ? " out" : ""}" title="Stamina: flying, sprinting and dashing spend it"><i style="height:${pct(f.stamina, f.staminaMax)}%"></i></div>
  <div class="vline en" title="Energy: the special, the big move and the ultimate spend it; landing and taking hits fill it"><i style="height:${pct(f.energy, f.energyMax)}%"></i></div>
  <div class="text"><b>${esc(f.name)}</b> ${Math.ceil(f.hp)}<span> · ${Math.round(f.launch)}%</span>
    ${f.combo >= 2 ? `<em>x${f.combo}</em>` : ""}${f.clipped ? `<span class="warn">${icon("feather", "Wings clipped")}</span>` : ""}${f.exhausted ? `<span class="warn">${icon("wind", "Exhausted")}</span>` : ""}</div>
</div>`;
};

const S = '.hud[data-skin="edge-lines"]';
export const skin: HudSkin = {
  id: "edge-lines", name: "Edge lines", idea: "Hairlines along the top and side edges and a few small numbers; the middle of the screen stays empty.",
  css: `
${S} .side { position: fixed; top: 0; bottom: 0; width: 0; }
${S} .s0 { left: 0; } ${S} .s1 { right: 0; }
${S} .hpline { position: fixed; top: 0; height: 4px; width: 42vw; background: rgba(255, 255, 255, 0.12); }
${S} .s0 .hpline { left: 0; } ${S} .s1 .hpline { right: 56px; width: calc(42vw - 56px); }
${S} .hpline i { display: block; height: 100%; background: color-mix(in srgb, var(--hp) calc(100% - var(--flash) * 100%), #ff5a4a); box-shadow: 0 0 6px color-mix(in srgb, var(--hp) calc(100% - var(--flash) * 100%), #ff5a4a); }
${S} .s1 .hpline i { margin-left: auto; }
${S} .vline { position: fixed; top: 64px; bottom: 56px; width: 2px; background: rgba(255, 255, 255, 0.1); display: flex; align-items: flex-end; }
${S} .vline i { display: block; width: 100%; }
${S} .s0 .st { left: 0; } ${S} .s0 .en { left: 5px; } ${S} .s1 .st { right: 0; } ${S} .s1 .en { right: 5px; }
${S} .vline.st i { background: var(--st); } ${S} .vline.st.out i { background: #ff6b6b; } ${S} .vline.en i { background: var(--en); }
${S} .text { position: fixed; top: 9px; font-size: 12px; letter-spacing: 0.04em; color: var(--ink); text-shadow: 0 1px 3px #000, 0 0 8px #000; font-variant-numeric: tabular-nums; display: flex; gap: 6px; align-items: center; white-space: nowrap; }
${S} .s0 .text { left: 10px; } ${S} .s1 .text { right: 62px; flex-direction: row-reverse; }
${S} .text b { font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; }
${S} .text span { color: var(--dim); }
${S} .text em { font-style: normal; color: var(--hot); font-weight: 700; }
${S} .text .warn { color: #ff8a8a; display: inline-flex; }
${S} .text .icon { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; }
${S} .clock { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); font-size: 15px; color: var(--ink); text-shadow: 0 1px 3px #000, 0 0 8px #000; font-variant-numeric: tabular-nums; letter-spacing: 0.1em; }
${S} .bind { position: fixed; top: 30px; left: 50%; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; font-size: 12px; text-shadow: 0 1px 3px #000, 0 0 8px #000; color: #cfe8d6; width: max-content; max-width: calc(100vw - 140px); }
${S} .bind .icon { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) {
  ${S} .hpline { width: 44vw; } ${S} .s1 .hpline { width: calc(44vw - 56px); }
  ${S} .text { top: 12px; font-size: 11px; gap: 2px 4px; flex-wrap: wrap; max-width: 40vw; }
  ${S} .text b { letter-spacing: 0.04em; max-width: 14ch; overflow: hidden; text-overflow: ellipsis; }
  ${S} .clock { top: 24px; font-size: 14px; } ${S} .bind { top: 46px; }
  ${S} .vline { top: 110px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
