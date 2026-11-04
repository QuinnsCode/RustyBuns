// A local TV breaking-news lower third pinned up top: scoreboard bars, a red BREAKING tag, a ticker of hits.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudHit, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const bar = (v: number, max: number, cls: string, ic: string, tip: string) =>
  `<span class="bar ${cls}" title="${esc(tip)}">${icon(ic, tip)}<span><i style="width:${pct(v, max)}%"></i></span></span>`;
const side = (f: HudSide, i: number, v: HudView) => `<div class="side s${i}">
  <div class="head"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <span class="hpbar${f.hp / (f.hpMax || 1) < 0.25 ? " low" : ""}" title="Health"><i style="width:${pct(f.hp, f.hpMax)}%"></i><em>${Math.ceil(f.hp)}</em></span>
  <div class="small">${bar(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "wind", "Stamina: flying, sprinting and dashing spend it")}${bar(f.energy, f.energyMax, "en", "zap", `Energy: landing and taking hits fill it`)}</div>
  ${f.clipped ? `<span class="flag">${icon("feather", "Wings clipped")} grounded</span>` : ""}</div>`;
const headline = (h: HudHit, v: HudView) => {
  const a = esc(v.sides[h.by].name).toUpperCase(), b = esc(v.sides[1 - h.by as 0 | 1].name).toUpperCase();
  return h.guarded ? `${b} BLOCKS ${a}'S ${esc(h.move).toUpperCase()}` : `${a} HITS ${b} WITH ${esc(h.move).toUpperCase()} FOR ${Math.round(h.damage)}`;
};

const S = '.hud[data-skin="news-ticker"]';
export const skin: HudSkin = {
  id: "news-ticker", name: "News ticker", idea: "Local TV breaking-news banner with a ticker of the latest hits.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0 10px; padding: 8px 60px 0 8px; font-family: "Helvetica Neue", Arial, sans-serif; color: #fff; }
${S} .live { grid-column: 1 / -1; order: -2; display: flex; align-items: stretch; height: 22px; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
${S} .live span { background: #d11a1a; padding: 0 10px; display: flex; align-items: center; gap: 6px; animation: news-pulse 1.6s ease-in-out infinite; }
${S} .live em { font-style: normal; background: #0b2a6b; padding: 0 10px; display: flex; align-items: center; font-weight: 600; }
${S} .side { background: linear-gradient(#123a8f, #0b2a6b); padding: 6px 10px; display: grid; gap: 3px; border-top: 3px solid #f5c400; }
${S} .s1 { order: 3; text-align: right; }
${S} .head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 15px; text-transform: uppercase; font-weight: 800; letter-spacing: .03em; }
${S} .launch { font-variant-numeric: tabular-nums; color: #f5c400; font-weight: 700; }
${S} .hpbar { position: relative; display: block; height: 20px; background: rgba(0,0,0,.45); overflow: hidden; }
${S} .hpbar i { display: block; height: 100%; background: #36c46a; transition: width .12s linear; }
${S} .s1 .hpbar i { margin-left: auto; }
${S} .hpbar.low i { background: #ff5a3c; }
${S} .hpbar em { position: absolute; top: 0; left: 8px; line-height: 20px; font-style: normal; font-weight: 800; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px #000; }
${S} .s1 .hpbar em { left: auto; right: 8px; }
${S} .small { display: flex; gap: 10px; } ${S} .s1 .small { flex-direction: row-reverse; }
${S} .bar { flex: 1; display: flex; align-items: center; gap: 4px; } ${S} .s1 .bar { flex-direction: row-reverse; }
${S} .bar > span { flex: 1; height: 5px; background: rgba(0,0,0,.45); } ${S} .bar i { display: block; height: 100%; background: #7fc8ff; }
${S} .s1 .bar i { margin-left: auto; }
${S} .bar.en i { background: #f5c400; } ${S} .bar.st.out i { background: #ff5a3c; }
${S} .flag { font-size: 11px; color: #f5c400; display: flex; gap: 4px; align-items: center; } ${S} .s1 .flag { justify-content: flex-end; }
${S} .clock { order: 2; align-self: start; background: #fff; color: #0b2a6b; font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; padding: 2px 12px; border-top: 3px solid #d11a1a; min-width: 2.4ch; text-align: center; }
${S} .ticker { grid-column: 1 / -1; order: 5; display: flex; gap: 0; height: 22px; margin-top: 4px; overflow: hidden; background: #fff; color: #111; font-size: 12px; font-weight: 700; white-space: nowrap; }
${S} .ticker b { background: #f5c400; padding: 0 8px; display: flex; align-items: center; flex: none; }
${S} .ticker span { display: flex; align-items: center; padding: 0 12px; border-right: 1px solid #ccc; overflow: hidden; text-overflow: ellipsis; animation: news-in 2s linear both; }
${S} .ticker span:first-of-type { color: #d11a1a; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; margin-top: 4px; background: #d11a1a; padding: 3px 12px; font-size: 13px; font-weight: 700; text-align: center; }
${S} .bind small { display: block; font-weight: 400; opacity: .85; }
@keyframes news-pulse { 50% { filter: brightness(1.25); } }
@keyframes news-in { 0% { background: #f5c400; } 20% { background: transparent; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 6px 52px 0 6px; gap: 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: -1; justify-self: end; margin-bottom: 4px; font-size: 18px; padding: 0 8px; }
  ${S} .live { order: -2; } ${S} .live em { display: none; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .head { font-size: 12px; }
  ${S} .ticker span:nth-of-type(n+3) { display: none; }
}`,
  render: (v) => `<div class="live"><span><svg viewBox="0 0 24 24" class="icon" role="img"><title>Live</title><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/></svg>${v.over ? "FINAL" : "BREAKING"}</span><em>CRYPTID WATCH LIVE</em></div>`
    + v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock" title="Seconds left">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} EXCLUSIVE: ${Math.round(v.bind.chance * 100)}% chance it can be bound · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : "")
    + `<div class="ticker"><b>LATEST</b>${v.hits.length ? v.hits.slice(0, 3).map((h) => `<span>${headline(h, v)}</span>`).join("") : "<span>NO INCIDENTS REPORTED</span>"}</div>`,
};
