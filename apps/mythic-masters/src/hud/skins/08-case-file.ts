// A case file: dossier strips on manila, damage taken is redacted in black, hits are stamped.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const sev = (d: number) => (d >= 25 ? "CRITICAL" : d >= 12 ? "SEVERE" : "MINOR");
const field = (label: string, v: number, max: number, cls: string, ic: string, tip: string) =>
  `<span class="row ${cls}" title="${esc(tip)}">${icon(ic, tip)}<em>${label}</em><span class="line"><i style="width:${pct(v, max)}%"></i></span></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const stamp = v.hits.find((h) => h.by !== i);
  const pc = Math.round((f.hp / (f.hpMax || 1)) * 100);
  return `<div class="side s${i}">
  <div class="tab">FILE ${i + 1}</div>
  <div class="head"><b>${esc(f.name)}</b><span class="launch" title="Launch: the higher, the further the next hit sends you">LAUNCH ${Math.round(f.launch)}%</span></div>
  <div class="hp" title="Health"><span class="rest" style="width:${pct(f.hp, f.hpMax)}%">${pc}%</span><span class="redact"></span></div>
  ${field("STAMINA", f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "wind", "Stamina: flying, sprinting and dashing spend it")}
  ${field("ENERGY", f.energy, f.energyMax, "en", "zap", `Energy: landing and taking hits fill it`)}
  ${f.clipped ? `<span class="note">${icon("feather", "Wings clipped")} wings clipped: grounded</span>` : ""}
  ${stamp ? `<span class="stamp" style="animation-delay:-${(stamp.age / 60).toFixed(2)}s">${stamp.guarded ? "BLOCKED" : sev(stamp.damage)}</span>` : ""}</div>`;
};

const S = '.hud[data-skin="case-file"]';
export const skin: HudSkin = {
  id: "case-file", name: "Case file", idea: "Manila dossier strips: lost health is blacked out, hits get stamped.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 12px 60px 0 14px; font-family: "Courier New", Courier, monospace; color: #2b2118; }
${S} .side { position: relative; display: grid; gap: 4px; padding: 8px 10px; background: #e8d5a6; border: 1px solid #a8905a; box-shadow: 0 2px 0 #a8905a, 0 4px 8px rgba(0,0,0,.4); }
${S} .s1 { order: 3; }
${S} .tab { position: absolute; left: 10px; top: -13px; background: #e8d5a6; border: 1px solid #a8905a; border-bottom: 0; padding: 0 8px; font-size: 10px; letter-spacing: .15em; }
${S} .s1 .tab { left: auto; right: 10px; }
${S} .head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 15px; text-transform: uppercase; }
${S} .launch { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
${S} .hp { position: relative; display: flex; height: 22px; background: #14110d; border: 1px solid #14110d; }
${S} .s1 .hp { flex-direction: row-reverse; }
${S} .rest { background: #f6ecd0; font-size: 12px; font-weight: 700; display: grid; align-items: center; padding: 0 6px; overflow: hidden; white-space: nowrap; transition: width .15s linear; }
${S} .s1 .rest { text-align: right; justify-items: end; }
${S} .redact { flex: 1; background: repeating-linear-gradient(135deg, #14110d 0 5px, #231d15 5px 10px); }
${S} .row { display: flex; align-items: center; gap: 6px; font-size: 10px; letter-spacing: .08em; }
${S} .row em { font-style: normal; width: 8ch; }
${S} .line { flex: 1; height: 6px; border-bottom: 1px solid #2b2118; position: relative; }
${S} .line i { display: block; height: 100%; background: #2b2118; }
${S} .row.st.out .line i { background: #b3261e; } ${S} .row.st.out em { color: #b3261e; font-weight: 700; }
${S} .row.en .line i { background: #6b4a12; }
${S} .note { font-size: 11px; color: #8a2a1a; display: flex; gap: 4px; align-items: center; }
${S} .stamp { position: absolute; right: 12px; top: 20px; transform: rotate(-9deg); border: 3px solid #b3261e; color: #b3261e; padding: 0 8px; font-size: 20px; font-weight: 700; letter-spacing: .08em; opacity: 0; animation: case-stamp 2s linear both; background: rgba(232,213,166,.6); }
${S} .s1 .stamp { right: auto; left: 12px; transform: rotate(7deg); }
${S} .clock { order: 2; align-self: start; background: #f6ecd0; border: 1px solid #a8905a; padding: 2px 10px; text-align: center; font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: 0 2px 0 #a8905a; }
${S} .clock small { display: block; font-size: 9px; letter-spacing: .15em; font-weight: 400; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #f6ecd0; border: 1px solid #a8905a; padding: 4px 12px; font-size: 13px; text-align: center; }
${S} .bind b { background: #14110d; color: #14110d; padding: 0 4px; } ${S} .bind small { display: block; opacity: .7; }
@keyframes case-stamp { 0% { opacity: 0; transform: rotate(-9deg) scale(2); } 8% { opacity: 1; transform: rotate(-9deg) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 14px 8px; padding: 14px 52px 0 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; margin-bottom: -4px; font-size: 18px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .row em { display: none; } ${S} .head { font-size: 12px; flex-wrap: wrap; } ${S} .stamp { font-size: 13px; top: 24px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock" title="Seconds left"><small>TIME</small>${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} Subject may be recruited: <b>${Math.round(v.bind.chance * 100)}%</b> · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
