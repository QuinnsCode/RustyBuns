// A field recorder: segmented VU meters as the bars, and a waveform of the last two seconds that spikes on hits.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const SEG = 20;
/** Lit LED segments for a value; health changes colour as it runs low. */
const leds = (v: number, max: number, health = false) => {
  const frac = Math.min(1, Math.max(0, v / (max || 1))), on = Math.round(frac * SEG), hp = frac < 0.25 ? "r" : frac < 0.5 ? "a" : "g";
  return Array.from({ length: SEG }, (_, k) => `<i class="${k < on ? "lit " + (health ? hp : "") : ""}"></i>`).join("");
};
const vu = (v: number, max: number, cls: string, label: string, ic: string, tip: string, health = false) =>
  `<span class="vu ${cls}" title="${esc(tip)}">${icon(ic, tip)}<em>${label}</em><span class="leds">${leds(v, max, health)}</span></span>`;
const side = (f: HudSide, i: number, v: HudView) => `<div class="side s${i}">
  <div class="head"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  ${vu(f.hp, f.hpMax, "hp", "HP", "heart", "Health", true)}
  ${vu(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", f.exhausted ? "CLIP" : "STA", "wind", "Stamina: flying, sprinting and dashing spend it")}
  ${vu(f.energy, f.energyMax, "en", "ENG", "zap", `Energy: hold charge (${v.chargeKey}) to fill it`)}
  ${f.clipped ? `<span class="flag">${icon("feather", "Wings clipped")} wings clipped</span>` : ""}</div>`;

/** The last 120 ticks as a mirrored waveform: a low noise floor, and a spike where each hit landed. */
function wave(v: HudView) {
  const W = 240, H = 30, N = 60, up: string[] = [], down: string[] = [];
  for (let k = 0; k < N; k++) {
    const age = (N - 1 - k) * 2; // ticks ago; the right edge is now
    let a = 2 + 1.6 * Math.abs(Math.sin((v.tick - age) * 0.9) * Math.cos((v.tick - age) * 0.37));
    for (const h of v.hits) { const d = Math.abs(h.age - age); if (d < 6) a = Math.max(a, (h.guarded ? 5 : 8 + Math.min(h.damage, 24) * 0.6) * (1 - d / 6)); }
    const x = ((k / (N - 1)) * W).toFixed(1);
    up.push(`${x},${(H / 2 - a).toFixed(1)}`); down.push(`${x},${(H / 2 + a).toFixed(1)}`);
  }
  return `<svg class="wave" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${up.join(" ")}"/><polyline points="${down.join(" ")}"/></svg>`;
}
const two = (n: number) => String(n).padStart(2, "0");

const S = '.hud[data-skin="field-recorder"]';
export const skin: HudSkin = {
  id: "field-recorder", name: "Field recorder", idea: "Segmented VU meters for the bars and a waveform that spikes on every hit.",
  css: `
${S} { display: grid; grid-template-columns: 1fr minmax(150px, 260px) 1fr; gap: 12px; padding: 10px 60px 0 12px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #e8e4da; }
${S} .side { display: grid; gap: 4px; padding: 6px 8px; background: #1d1f21; border: 1px solid #3a3d40; border-radius: 6px; }
${S} .s1 { order: 3; text-align: right; }
${S} .head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 14px; text-transform: uppercase; }
${S} .launch { color: #ff9d3f; font-weight: 700; font-variant-numeric: tabular-nums; }
${S} .vu { display: flex; align-items: center; gap: 6px; font-size: 10px; } ${S} .s1 .vu { flex-direction: row-reverse; }
${S} .vu em { font-style: normal; width: 4ch; opacity: .8; }
${S} .leds { flex: 1; display: flex; gap: 2px; } ${S} .s1 .leds { flex-direction: row-reverse; } ${S} .vu.hp .leds { height: 16px; } ${S} .vu .leds { height: 8px; }
${S} .leds i { flex: 1; background: #2c2f32; border-radius: 1px; }
${S} .leds i.lit.g { background: #4cd964; } ${S} .leds i.lit.a { background: #ffc531; } ${S} .leds i.lit.r { background: #ff4d3d; }
${S} .vu.st.out em { color: #ff4d3d; font-weight: 700; animation: rec-blink .6s steps(2) infinite; }
${S} .vu.en .leds i.lit { background: #7fc8ff; } ${S} .vu.st .leds i.lit { background: #cfd4d8; } ${S} .vu.st.out .leds i.lit { background: #ff4d3d; }
${S} .flag { font-size: 11px; color: #ff9d3f; display: flex; gap: 4px; align-items: center; } ${S} .s1 .flag { justify-content: flex-end; }
${S} .mid { order: 2; align-self: start; display: grid; gap: 4px; background: #1d1f21; border: 1px solid #3a3d40; border-radius: 6px; padding: 6px 10px; text-align: center; }
${S} .time { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
${S} .time small { font-size: 10px; letter-spacing: .15em; margin-left: 6px; color: #ff4d3d; }
${S} .wave { width: 100%; height: 30px; background: #0f1011; border-radius: 3px; }
${S} .wave polyline { fill: none; stroke: #4cd964; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #1d1f21; border: 1px solid #4cd964; border-radius: 6px; padding: 4px 12px; font-size: 13px; text-align: center; }
${S} .bind small { display: block; opacity: .7; }
@keyframes rec-blink { 50% { opacity: .2; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px 52px 0 6px; }
  ${S} .mid { grid-column: 1 / -1; order: 0; grid-template-columns: auto 1fr; align-items: center; gap: 10px; padding: 3px 8px; }
  ${S} .time { font-size: 16px; } ${S} .time small { display: none; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .head { font-size: 12px; } ${S} .vu em { display: none; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="mid"><span class="time" title="Seconds left">${two(Math.floor(v.clock / 60))}:${two(v.clock % 60)}<small>${v.over ? "STOP" : "REC"}</small></span>${wave(v)}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} Signal lock ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
