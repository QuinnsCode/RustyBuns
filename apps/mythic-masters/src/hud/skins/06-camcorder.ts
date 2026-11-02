// A handheld camcorder's viewfinder: REC light, battery-cell health, a timecode for the clock.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const CELLS = 10;
const cells = (f: HudSide) => {
  const on = Math.ceil((f.hp / (f.hpMax || 1)) * CELLS), low = f.hp / (f.hpMax || 1) <= 0.25;
  return Array.from({ length: CELLS }, (_, i) => `<i class="${i < on ? (low ? "on low" : "on") : ""}"></i>`).join("");
};
const meter = (v: number, max: number, cls: string, label: string, ic: string, tip: string) =>
  `<span class="m ${cls}" title="${esc(tip)}">${icon(ic, tip)}<em>${label}</em><span><i style="width:${pct(v, max)}%"></i></span></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const hit = v.hits.find((h) => h.by !== i);
  return `<div class="side s${i}">
  <div class="top"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <div class="batt" title="Health"><span class="cap"></span><span class="cells">${cells(f)}</span></div>
  ${meter(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", f.exhausted ? "NO FOCUS" : "FOCUS", "wind", "Stamina: flying, sprinting and dashing spend it")}
  ${meter(f.energy, f.energyMax, "en", "EXPOSURE", "zap", `Energy: hold charge (${v.chargeKey}) to fill it`)}
  ${f.clipped ? `<span class="warn">${icon("feather", "Wings clipped")} NO FLIGHT</span>` : ""}
  ${hit ? `<span class="glitch" style="animation-delay:-${(hit.age / 60).toFixed(2)}s"></span>` : ""}</div>`;
};
const two = (n: number) => String(n).padStart(2, "0");

const S = '.hud[data-skin="camcorder"]';
export const skin: HudSkin = {
  id: "camcorder", name: "Camcorder", idea: "A handheld viewfinder: REC light, battery-cell health, timecode clock.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 14px 60px 10px 18px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #f2f2f2; text-shadow: 0 0 3px #000, 0 0 1px #000; }
${S}::before, ${S}::after { content: ""; position: fixed; width: 22px; height: 22px; border: 2px solid rgba(255,255,255,.7); pointer-events: none; }
${S}::before { left: 6px; top: 6px; border-right: 0; border-bottom: 0; }
${S}::after { left: 6px; bottom: 6px; border-right: 0; border-top: 0; }
${S} .side { position: relative; display: grid; gap: 4px; padding: 6px 8px; background: rgba(0,0,0,.45); border-left: 2px solid rgba(255,255,255,.55); }
${S} .s1 { order: 3; text-align: right; border-left: 0; border-right: 2px solid rgba(255,255,255,.55); }
${S} .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 14px; text-transform: uppercase; letter-spacing: .06em; }
${S} .launch { font-variant-numeric: tabular-nums; color: #ffd23f; font-weight: 700; }
${S} .batt { display: flex; align-items: stretch; height: 22px; border: 2px solid #f2f2f2; border-radius: 3px; padding: 2px; position: relative; margin-right: 6px; }
${S} .s1 .batt { flex-direction: row-reverse; margin: 0 0 0 6px; }
${S} .cap { position: absolute; right: -7px; top: 5px; width: 4px; height: 8px; background: #f2f2f2; }
${S} .s1 .cap { right: auto; left: -7px; }
${S} .cells { display: flex; gap: 2px; flex: 1; }
${S} .s1 .cells { flex-direction: row-reverse; }
${S} .cells i { flex: 1; background: rgba(255,255,255,.12); }
${S} .cells i.on { background: #fff; }
${S} .cells i.on.low { background: #ff4d4d; animation: cam-blink .7s steps(2) infinite; }
${S} .m { display: flex; align-items: center; gap: 6px; font-size: 10px; letter-spacing: .1em; }
${S} .s1 .m { flex-direction: row-reverse; }
${S} .m em { font-style: normal; width: 9ch; text-align: left; opacity: .85; }
${S} .s1 .m em { text-align: right; }
${S} .m > span { flex: 1; height: 5px; background: rgba(255,255,255,.18); }
${S} .m > span > i { display: block; height: 100%; background: #f2f2f2; }
${S} .s1 .m > span > i { margin-left: auto; }
${S} .m.st.out > span > i, ${S} .m.st.out em { background: #ff4d4d; color: #ff4d4d; }
${S} .m.en > span > i { background: #ffd23f; }
${S} .warn { font-size: 11px; color: #ff9d3f; display: flex; gap: 4px; align-items: center; }
${S} .s1 .warn { justify-content: flex-end; }
${S} .glitch { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.35) 0 2px, transparent 2px 5px); opacity: 0; animation: cam-glitch .35s steps(3) both; pointer-events: none; }
${S} .mid { order: 2; display: grid; justify-items: center; gap: 2px; align-self: start; background: rgba(0,0,0,.45); padding: 4px 10px; }
${S} .rec { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; letter-spacing: .1em; }
${S} .rec i { width: 10px; height: 10px; border-radius: 50%; background: #ff2d2d; }
${S} .rec.off i { opacity: .15; }
${S} .tc { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .04em; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: rgba(0,0,0,.6); border: 2px solid #f2f2f2; padding: 4px 12px; font-size: 13px; text-align: center; }
${S} .bind small { display: block; opacity: .75; }
@keyframes cam-blink { 50% { opacity: .25; } }
@keyframes cam-glitch { 0% { opacity: .9; transform: translateX(-4px); } 60% { opacity: .4; transform: translateX(3px); } 100% { opacity: 0; transform: none; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px 52px 6px 12px; }
  ${S} .mid { grid-column: 1 / -1; order: 0; justify-self: start; display: flex; gap: 12px; align-items: center; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .tc { font-size: 16px; }
  ${S} .m em { display: none; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="mid"><span class="rec ${v.tick % 60 < 40 && !v.over ? "" : "off"}"><i></i>REC</span><span class="tc" title="Seconds left">00:${two(Math.floor(v.clock / 60))}:${two(v.clock % 60)}:${two(v.tick % 30)}</span></div>`
    + (v.bind ? `<div class="bind">${icon("link")} TRACKING LOCK ${Math.round(v.bind.chance * 100)}% · tape ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
