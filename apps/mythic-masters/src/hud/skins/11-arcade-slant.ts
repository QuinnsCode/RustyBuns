// Arcade: big slanted health bars with a ghost trail of the health just lost, a portrait and a combo counter.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

/** Health lost in the last second or so and still fading, so the pale ghost trails the real bar (derived from the hits). */
const lost = (v: HudView, i: number) => v.hits.filter((h) => h.by !== i).reduce((s, h) => s + h.damage * Math.max(0, Math.min(1, 1 - (h.age - 18) / 72)), 0);
const mini = (v: number, max: number, cls: string, label: string, ic: string) =>
  `<span class="mini ${cls}" title="${esc(label)}">${icon(ic, label)}<span><i style="width:${pct(v, max)}%"></i></span></span>`;

const side = (f: HudSide, i: number, v: HudView) => {
  const ghost = f.hp + lost(v, i), taken = v.hits.find((h) => h.by !== i)?.age ?? 99, landed = v.hits.find((h) => h.by === i)?.age ?? 99;
  // No CSS animations: the HUD is redrawn every frame, so a hit's shake and a combo's pop are worked out from its age.
  const shake = taken < 12 ? Math.sin(taken * 2.4) * 5 * (1 - taken / 12) : 0, pop = 1 + Math.max(0, 10 - landed) * 0.04;
  return `<div class="side s${i}">
  ${f.art ? `<span class="face"><img src="${esc(f.art)}" alt=""></span>` : ""}
  <div class="body">
    <div class="top"><b class="nm">${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}<small>%</small></span></div>
    <div class="hp" title="Health" style="translate:${shake.toFixed(1)}px 0"><i class="ghost" style="width:${pct(ghost, f.hpMax)}%"></i><i class="real" style="width:${pct(f.hp, f.hpMax)}%"></i><em>${Math.ceil(f.hp)}</em></div>
    <div class="minis">${mini(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina: flying, sprinting and dashing spend it", "wind")}${mini(f.energy, f.energyMax, "en", `Energy: the special, the big move and the ultimate spend it; landing and taking hits fill it`, "zap")}</div>
    ${f.exhausted ? `<span class="flag">${icon("wind")}exhausted</span>` : ""}${f.clipped ? `<span class="flag">${icon("feather")}grounded</span>` : ""}
  </div>
  ${f.combo >= 2 ? `<span class="combo" style="scale:${pop.toFixed(2)}"><b>${f.combo}</b> HIT</span>` : ""}
</div>`;
};

const S = '.hud[data-skin="arcade-slant"]';
export const skin: HudSkin = {
  id: "arcade-slant", name: "Arcade slant", idea: "Big slanted bars, a pale ghost of the health just lost, a portrait and a combo counter.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; padding: 8px 56px 0 14px; align-items: start; text-transform: uppercase; }
${S} .side { position: relative; display: flex; gap: 8px; align-items: flex-start; }
${S} .s1 { order: 3; flex-direction: row-reverse; text-align: right; }
${S} .face { flex: none; width: 58px; height: 58px; overflow: hidden; background: #222; border: 3px solid #fff; transform: skewX(-8deg); box-shadow: 0 3px 0 rgba(0, 0, 0, 0.5); }
${S} .face img { width: 120%; height: 120%; margin: -10%; object-fit: cover; transform: skewX(8deg); }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 3px; }
${S} .top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .nm { font-size: 17px; font-weight: 900; letter-spacing: 0.06em; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .launch { font-size: 26px; font-weight: 900; font-style: italic; color: #ffd23f; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.7); font-variant-numeric: tabular-nums; line-height: 1; }
${S} .launch small { font-size: 14px; }
${S} .hp { position: relative; height: 26px; background: rgba(0, 0, 0, 0.7); border: 3px solid #fff; transform: skewX(-18deg); overflow: hidden; box-shadow: 0 3px 0 rgba(0, 0, 0, 0.5); }
${S} .s1 .hp { transform: skewX(18deg); }
${S} .hp i { position: absolute; top: 0; bottom: 0; left: 0; }
${S} .s1 .hp i { left: auto; right: 0; }
${S} .hp .ghost { background: #fff; opacity: 0.85; }
${S} .hp .real { background: linear-gradient(#b7ff5c, #2fbf4a); }
${S} .hp em { position: absolute; top: 50%; left: 8px; transform: translateY(-50%) skewX(18deg); font-style: normal; font-weight: 900; font-size: 15px; color: #fff; text-shadow: 0 1px 2px #000; font-variant-numeric: tabular-nums; }
${S} .s1 .hp em { left: auto; right: 8px; transform: translateY(-50%) skewX(-18deg); }
${S} .minis { display: flex; gap: 6px; }
${S} .s1 .minis { flex-direction: row-reverse; }
${S} .mini { flex: 1; display: flex; align-items: center; gap: 4px; }
${S} .s1 .mini { flex-direction: row-reverse; }
${S} .mini .icon { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; }
${S} .mini > span { flex: 1; height: 7px; background: rgba(0, 0, 0, 0.7); border: 1px solid #fff; transform: skewX(-18deg); overflow: hidden; display: flex; }
${S} .s1 .mini > span { justify-content: flex-end; transform: skewX(18deg); }
${S} .mini i { display: block; height: 100%; }
${S} .mini.st i { background: var(--st); } ${S} .mini.st.out i { background: #ff6b6b; } ${S} .mini.en i { background: var(--en); }
${S} .flag { display: inline-flex; gap: 4px; align-items: center; font-size: 11px; font-weight: 800; color: #ff8a8a; }
${S} .flag .icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; }
${S} .combo { position: absolute; top: 74px; left: 4px; font-size: 14px; font-weight: 900; font-style: italic; color: #fff; background: #e8312f; padding: 1px 10px 1px 8px; transform: skewX(-12deg); }
${S} .combo b { font-size: 28px; }
${S} .s1 .combo { left: auto; right: 4px; }
${S} .clock { order: 2; min-width: 64px; text-align: center; font-size: 38px; font-weight: 900; font-style: italic; font-variant-numeric: tabular-nums; background: rgba(0, 0, 0, 0.75); border: 3px solid #fff; padding: 0 12px; line-height: 1.25; transform: skewX(-8deg); }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: #e8312f; border: 3px solid #fff; padding: 3px 14px; font-weight: 800; transform: skewX(-8deg); }
${S} .bind .icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }
${S} .bind small { flex-basis: 100%; text-align: center; font-weight: 600; opacity: 0.85; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 6px 54px 0 8px; gap: 6px 10px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 24px; padding: 0 10px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .face { display: none; }
  ${S} .nm { font-size: 13px; } ${S} .launch { font-size: 20px; }
  ${S} .hp { height: 20px; border-width: 2px; } ${S} .hp em { font-size: 12px; }
  ${S} .combo { top: 64px; font-size: 11px; } ${S} .combo b { font-size: 20px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
