// A night-vision trail camera: green monochrome, an infrared timestamp strip, motion boxes on hits.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const bar = (v: number, max: number, cls: string, label: string, ic: string, tip: string) =>
  `<span class="bar ${cls}" title="${esc(tip)}">${icon(ic, tip)}<em>${label}</em><span><i style="width:${pct(v, max)}%"></i></span></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const mine = v.hits.filter((h) => h.by !== i).slice(0, 3);
  return `<div class="side s${i}">
  <div class="top"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  ${bar(f.hp, f.hpMax, f.hp / (f.hpMax || 1) < 0.25 ? "hp low" : "hp", "HP", "heart", "Health")}
  ${bar(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", f.exhausted ? "SPENT" : "STA", "wind", "Stamina: flying, sprinting and dashing spend it")}
  ${bar(f.energy, f.energyMax, "en", "ENG", "zap", `Energy: hold charge (${v.chargeKey}) to fill it`)}
  ${f.clipped ? `<span class="warn">${icon("feather", "Wings clipped")} GROUNDED</span>` : ""}
  ${mine.map((h, k) => `<span class="box k${k}" style="animation-delay:-${(h.age / 60).toFixed(2)}s"><b>${h.guarded ? "BLK" : "-" + Math.round(h.damage)}</b></span>`).join("")}</div>`;
};
const two = (n: number) => String(n).padStart(2, "0");

const S = '.hud[data-skin="trail-cam"]';
export const skin: HudSkin = {
  id: "trail-cam", name: "Trail cam", idea: "Night-vision green, an infrared timestamp, motion boxes that pop on hits.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 0 60px 0 0; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #9dff9d; text-shadow: 0 0 4px rgba(120,255,120,.6); }
${S}::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(0,40,0,.18) 0 1px, transparent 1px 3px); mix-blend-mode: multiply; }
${S} .strip { grid-column: 1 / -1; order: -1; display: flex; justify-content: space-between; gap: 12px; padding: 3px 12px; background: rgba(0,25,0,.75); font-size: 11px; letter-spacing: .08em; white-space: nowrap; overflow: hidden; }
${S} .side { position: relative; display: grid; gap: 4px; margin: 8px 0 0 12px; padding: 6px 8px; background: rgba(0,25,0,.6); border: 1px solid rgba(157,255,157,.6); }
${S} .s1 { order: 3; margin: 8px 0 0 0; text-align: right; }
${S} .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 14px; text-transform: uppercase; }
${S} .launch { font-weight: 700; font-variant-numeric: tabular-nums; }
${S} .bar { display: flex; align-items: center; gap: 6px; font-size: 10px; }
${S} .s1 .bar { flex-direction: row-reverse; }
${S} .bar em { font-style: normal; width: 5ch; }
${S} .bar > span { flex: 1; height: 8px; border: 1px solid rgba(157,255,157,.7); padding: 1px; }
${S} .bar.hp > span { height: 14px; }
${S} .bar > span > i { display: block; height: 100%; background: #9dff9d; }
${S} .s1 .bar > span > i { margin-left: auto; }
${S} .bar.hp.low > span > i { background: #eaffea; animation: trail-flash .6s steps(2) infinite; }
${S} .bar.en > span > i { background: repeating-linear-gradient(90deg, #9dff9d 0 4px, transparent 4px 6px); }
${S} .bar.st.out > span > i { background: #eaffea; opacity: .5; } ${S} .bar.st.out em { animation: trail-flash .6s steps(2) infinite; }
${S} .warn { font-size: 11px; display: flex; gap: 4px; align-items: center; }
${S} .s1 .warn { justify-content: flex-end; }
${S} .box { position: absolute; top: 100%; width: 54px; height: 30px; margin-top: 6px; border: 2px solid #eaffea; opacity: 0; animation: trail-box 1.4s linear both; display: grid; place-items: center; font-size: 12px; background: rgba(0,25,0,.4); }
${S} .box.k1 { margin-left: 62px; } ${S} .box.k2 { margin-left: 124px; }
${S} .s1 .box { right: 0; } ${S} .s1 .box.k1 { margin-left: 0; margin-right: 62px; } ${S} .s1 .box.k2 { margin-left: 0; margin-right: 124px; }
${S} .clock { order: 2; align-self: start; margin-top: 8px; padding: 2px 10px; background: rgba(0,25,0,.6); border: 1px solid rgba(157,255,157,.6); font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; margin-top: 8px; padding: 4px 12px; background: rgba(0,25,0,.75); border: 1px dashed #9dff9d; font-size: 13px; text-align: center; }
${S} .bind small { display: block; opacity: .75; }
@keyframes trail-flash { 50% { opacity: .3; } }
@keyframes trail-box { 0% { opacity: 1; transform: scale(1.4); } 15% { transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding-right: 52px; }
  ${S} .strip { font-size: 9px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 18px; margin-top: 4px; }
  ${S} .s0 { order: 1; margin-left: 6px; } ${S} .s1 { order: 2; margin-right: 0; }
  ${S} .bar em { display: none; }
  ${S} .box { width: 40px; height: 22px; font-size: 10px; } ${S} .box.k1 { margin-left: 46px; } ${S} .box.k2 { display: none; }
  ${S} .s1 .box.k1 { margin-left: 0; margin-right: 46px; }
}`,
  render: (v) => `<div class="strip"><span>CAM 04 ${v.over ? "STOP" : "REC"}</span><span>IR 850nm ${two(Math.floor(v.tick / 3600))}:${two(Math.floor(v.tick / 60) % 60)}:${two(v.tick % 60)}</span><span>MOTION ${v.hits.length ? "TRIGGER" : "IDLE"}</span></div>`
    + v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock" title="Seconds left">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} SUBJECT LOCK ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
