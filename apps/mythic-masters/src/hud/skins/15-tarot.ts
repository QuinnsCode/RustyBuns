// Arcade and broadcast: two tarot cards in the top corners. Health drains the illustration to grey from the top down.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const pip = (v: number, max: number, cls: string, label: string) => `<span class="pip ${cls}" title="${esc(label)}"><i style="width:${pct(v, max)}%"></i></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const art = f.art ? `url('${esc(f.art)}')` : "linear-gradient(160deg, #3b2f55, #14101f)", lostPct = 100 - Number(pct(f.hp, f.hpMax));
  const hit = Math.max(0, 1 - (v.hits.find((h) => h.by !== i)?.age ?? 99) / 16);
  return `<div class="side s${i}">
  <div class="card" title="Health ${Math.ceil(f.hp)} of ${Math.ceil(f.hpMax)}" style="--hit:${hit.toFixed(2)}">
    <div class="art" style="background-image:${art}"></div>
    <div class="art live" style="background-image:${art};clip-path:inset(${lostPct}% 0 0 0)"></div>
    <span class="num">${ROMAN[(i + 1) % ROMAN.length]}</span>
    <span class="hpn">${Math.ceil(f.hp)}</span>
    <div class="name">${esc(f.name)}</div>
  </div>
  <div class="under">
    <span class="launch" title="Launch: the higher, the further the next hit sends you">${icon("move-up-right")}${Math.round(f.launch)}%</span>
    ${f.combo >= 2 ? `<span class="cmb">x${f.combo}</span>` : ""}${f.clipped ? `<span class="warn">${icon("feather", "Wings clipped")}</span>` : ""}
  </div>
  ${pip(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", f.exhausted ? "Exhausted" : "Stamina: flying, sprinting and dashing spend it")}
  ${pip(f.energy, f.energyMax, "en", `Energy: the special, the big move and the ultimate spend it; landing and taking hits fill it`)}
</div>`;
};

const S = '.hud[data-skin="tarot"]';
export const skin: HudSkin = {
  id: "tarot", name: "Tarot", idea: "Two cards in the top corners; health drains the illustration to grey from the top down.",
  css: `
${S} { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 56px 0 10px; font-family: "IM Fell English", Georgia, serif; }
${S} .side { width: 118px; display: grid; gap: 4px; }
${S} .s1 { order: 3; }
${S} .card { position: relative; height: 178px; border: 3px double #d9b66a; border-radius: 8px; background: #0d0a14; overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6), 0 0 calc(var(--hit) * 18px) #ff5a4a; outline: 2px solid color-mix(in srgb, #ff5a4a calc(var(--hit) * 100%), transparent); outline-offset: -5px; }
${S} .art { position: absolute; inset: 14px 6px 28px; background-size: cover; background-position: center; border: 1px solid #d9b66a; border-radius: 3px; filter: grayscale(1) brightness(0.45) contrast(0.9); }
${S} .art.live { filter: none; }
${S} .num { position: absolute; top: 0; left: 0; right: 0; text-align: center; font-size: 12px; color: #d9b66a; letter-spacing: 0.2em; line-height: 14px; }
${S} .hpn { position: absolute; right: 9px; bottom: 32px; font-size: 22px; font-weight: 700; color: #fff; text-shadow: 0 1px 4px #000, 0 0 8px #000; font-variant-numeric: tabular-nums; }
${S} .name { position: absolute; left: 0; right: 0; bottom: 0; height: 28px; display: grid; place-items: center; background: #1a1326; border-top: 1px solid #d9b66a; color: #f0dfb0; font-size: 13px; font-style: italic; padding: 0 4px; text-align: center; line-height: 1; }
${S} .under { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: #f0dfb0; text-shadow: 0 1px 3px #000; font-size: 16px; padding: 0 2px; }
${S} .s1 .under { flex-direction: row-reverse; }
${S} .launch { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
${S} .icon { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; }
${S} .cmb { color: #ff9a4a; } ${S} .warn { color: #ff8a8a; display: inline-flex; }
${S} .pip { display: flex; height: 5px; background: rgba(0, 0, 0, 0.65); border: 1px solid #d9b66a; border-radius: 3px; overflow: hidden; }
${S} .s1 .pip { justify-content: flex-end; }
${S} .pip i { display: block; height: 100%; } ${S} .pip.st i { background: var(--st); } ${S} .pip.st.out i { background: #ff6b6b; } ${S} .pip.en i { background: var(--en); }
${S} .clock { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); min-width: 44px; text-align: center; font-size: 24px; font-weight: 700; color: #f0dfb0; text-shadow: 0 2px 5px #000; font-variant-numeric: tabular-nums; border-bottom: 1px solid #d9b66a; }
${S} .bind { position: absolute; top: 46px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 2 * 130px - 64px); min-width: 150px; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: rgba(13, 10, 20, 0.88); border: 1px solid #d9b66a; border-radius: 6px; padding: 3px 10px; color: #f0dfb0; font-size: 14px; }
${S} .bind small { flex-basis: 100%; text-align: center; opacity: 0.8; font-size: 12px; }
@media (max-width: 640px) {
  ${S} { padding: 6px 54px 0 6px; }
  ${S} .side { width: 84px; }
  ${S} .card { height: 128px; } ${S} .art { inset: 12px 4px 22px; }
  ${S} .name { height: 22px; font-size: 11px; } ${S} .hpn { font-size: 17px; bottom: 26px; right: 7px; }
  ${S} .under { font-size: 14px; }
  ${S} .clock { font-size: 20px; top: 6px; }
  ${S} .bind { top: 38px; max-width: calc(100vw - 2 * 90px - 64px); min-width: 0; font-size: 12px; padding: 2px 6px; }
}`,
  render: (v) => v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
