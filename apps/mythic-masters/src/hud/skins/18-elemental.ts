// Each beast's first field sets the colours and the glyph; the bars are filled with that element's pattern.
import { esc } from "@rustybuns/util";
import { COLOR, type Field } from "../../fields.ts";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin } from "../skin.ts";

// lucide-style 24x24 glyph paths, one per field
const GLYPH: Record<Field, string> = {
  ember: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3 0 1.7 1 2.5 2.5 2.5z"/>',
  tide: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  gale: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  stone: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  frost: '<path d="M2 12h20M12 2v20m-7-5 14-10M5 7l14 10"/>',
  storm: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  grove: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.5 6-7"/>',
  venom: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M12.5 17h-1"/><path d="M16 20a2 2 0 0 0 1.6-3.2A8 8 0 1 0 6.4 16.8 2 2 0 0 0 8 20"/>',
  spirit: '<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  shadow: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  iron: '<path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  wild: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.8 1.2c-.4-1.2-1.5-1.6-2.7-2A3.5 3.5 0 0 1 5.5 11c1.4 0 2.5-.2 3.5-1z"/>',
};
// a bar's fill per element: flicker, ripple, streaks, grit, shards, crackle, veins, bubbles, mist, dusk, rivets, hide
const FILL: Record<Field, string> = {
  ember: "repeating-linear-gradient(100deg, var(--c) 0 6px, var(--c2) 6px 9px)",
  tide: "repeating-radial-gradient(circle at 0 100%, var(--c) 0 5px, var(--c2) 5px 9px)",
  gale: "repeating-linear-gradient(170deg, var(--c) 0 3px, var(--c2) 3px 7px)",
  stone: "repeating-linear-gradient(90deg, var(--c) 0 11px, var(--c2) 11px 13px)",
  frost: "repeating-linear-gradient(60deg, var(--c) 0 7px, var(--c2) 7px 9px)",
  storm: "repeating-linear-gradient(120deg, var(--c) 0 4px, var(--c2) 4px 6px, var(--c) 6px 14px)",
  grove: "repeating-linear-gradient(45deg, var(--c) 0 8px, var(--c2) 8px 10px)",
  venom: "radial-gradient(circle at 30% 50%, var(--c2) 0 3px, transparent 4px) 0 0 / 12px 100%, var(--c)",
  spirit: "linear-gradient(90deg, var(--c), var(--c2), var(--c))",
  shadow: "linear-gradient(90deg, var(--c2), var(--c))",
  iron: "repeating-linear-gradient(90deg, var(--c) 0 14px, var(--c2) 14px 16px)",
  wild: "repeating-linear-gradient(80deg, var(--c) 0 5px, var(--c2) 5px 8px)",
};
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const bar = (v: number, max: number, cls: string, t: string, filled: boolean) => `<span class="bar ${cls}" title="${esc(t)}"><i style="width:${pct(v, max)}%"${filled ? ' class="el"' : ""}></i></span>`;
const side = (f: HudSide, i: number, age: number | undefined) => {
  const fld = f.fields[0] ?? "wild", c = hex(COLOR[fld]);
  return `<div class="side s${i}${age !== undefined ? " hurt" : ""}" data-f="${fld}" style="--c:${c};--c2:color-mix(in srgb, ${c} 55%, #000);--age:${(age ?? 99) / 60}s">
  <div class="gl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${fld}">${GLYPH[fld]}</svg></div>
  <div class="body"><div class="nm"><b>${esc(f.name)}</b>${f.fields.slice(1).map((x) => `<small style="color:${hex(COLOR[x])}">${x}</small>`).join("")}${f.combo > 1 ? `<em>x${f.combo}</em>` : ""}${f.clipped ? icon("feather", "Wings clipped") : ""}<span class="pc">${Math.round(f.launch)}%</span></div>
  ${bar(f.hp, f.hpMax, "hp", "Health", true)}${bar(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina", false)}${bar(f.energy, f.energyMax, "en", "Energy", false)}</div></div>`;
};
const fillRules = (Object.keys(FILL) as Field[]).map((f) => `.hud[data-skin="elemental"] [data-f="${f}"] .hp .el { background: ${FILL[f]}; }`).join("\n");

const S = '.hud[data-skin="elemental"]';
export const skin: HudSkin = {
  id: "elemental", name: "Elemental", idea: "Each beast's field sets its colour, glyph and the pattern its health bar is woven from.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 10px 56px 0 12px; }
${S} .side { display: flex; gap: 8px; align-items: stretch; background: var(--panel); border: 1px solid var(--c); border-radius: 12px; padding: 6px 8px; box-shadow: 0 0 14px color-mix(in srgb, var(--c) 40%, transparent); }
${S} .s1 { flex-direction: row-reverse; order: 3; text-align: right; }
${S} .gl { flex: none; width: 40px; height: 40px; align-self: center; display: grid; place-items: center; color: var(--c); background: color-mix(in srgb, var(--c) 18%, #000); border-radius: 50%; }
${S} .gl svg { width: 26px; height: 26px; }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 4px; }
${S} .nm { display: flex; gap: 6px; align-items: baseline; font-size: 13px; } ${S} .s1 .nm { flex-direction: row-reverse; }
${S} .nm small { font-size: 11px; } ${S} .nm em { color: var(--hot); font-style: normal; font-weight: 700; }
${S} .pc { margin-left: auto; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; } ${S} .s1 .pc { margin: 0 auto 0 0; }
${S} .bar { display: block; height: 7px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; }
${S} .bar i { display: block; height: 100%; } ${S} .s1 .bar i { margin-left: auto; }
${S} .bar.hp { height: 16px; border-radius: 6px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent); }
${S} .bar.st i { background: var(--st); } ${S} .bar.st.out i { background: #ff6b6b; } ${S} .bar.en i { background: var(--en); }
${fillRules}
${S} .hurt .gl { animation: el-hit 0.45s ease-out calc(var(--age) * -1) 1; }
@keyframes el-hit { 0% { transform: scale(1.4); background: var(--c); color: #000; } 100% { transform: scale(1); } }
${S} .clock { order: 2; align-self: start; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 2.4ch; text-align: center; background: var(--panel); border-radius: 10px; padding: 4px 8px; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 1px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; }
${S} .bind small { flex-basis: 100%; text-align: center; color: var(--dim); }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 52px 0 8px; gap: 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; font-size: 16px; padding: 0 8px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .gl { display: none; } ${S} .pc { font-size: 16px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v.hits.find((h) => h.by !== i)?.age)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
