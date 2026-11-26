// The cog in the corner: look speeds, invert Y and the key list, shared by every screen and read by the game view.
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { SKIN } from "./eqosys.ts";

/**
 * The Controls sheet as the gadget watch's settings plate: riveted glass with a stamped hairline inside the edge, the
 * red-and-cream hatched trim along its top, a stencilled serial beside the title, and each section an inset panel.
 * A switch's row gives its words the width a slider's track would take, so "Toggle instead of hold" stays on one line.
 * Each section head is stamped: a red-and-cream tab on its top edge and a red serial (SR-CTL · 01, 02...) by a CSS counter.
 */
const LAB_CSS = `.ui-house .gc-card{box-shadow:var(--glow),0 30px 80px -30px #000;border-top:0;backdrop-filter:blur(8px);position:relative;padding-top:26px;
background:var(--rivets),var(--wear),var(--panel);outline:1px solid rgb(239 228 201 / .06);outline-offset:-5px}
.ui-house .gc-card::before{content:"";position:absolute;left:0;right:0;top:0;height:7px;
background:linear-gradient(100deg,var(--red) 0 132px,transparent 132px),repeating-linear-gradient(-55deg,rgb(239 228 201 / .45) 0 3px,transparent 3px 8px)}
.gc-head h2{font:600 1.5rem/1 var(--silk);letter-spacing:.06em;text-transform:uppercase}
.gc-head h2::after{content:"SR-CTL · 0417";margin-left:12px;padding:2px 7px;vertical-align:middle;border:1px solid var(--oxide);border-radius:2px;
font:.62rem var(--mono);letter-spacing:.18em;color:var(--cream);background:rgb(0 0 0 / .3)}
.ui-house .gc-sec{background:var(--wear),rgb(0 0 0 / .22);border-color:var(--oxide);box-shadow:inset 0 1px 4px rgb(0 0 0 / .5)}
.gc-cog.ui-house{background:var(--glass);border-color:var(--edge-hi);color:var(--accent);box-shadow:var(--glow)}
.ui-house .gc-tab[aria-selected=true]{box-shadow:var(--glow)}
.ui-house .gc-keys dt{font-family:var(--mono);font-size:.85em;color:var(--accent)}
.ui-house .gc-card label:has(>input[type=checkbox]){grid-template-columns:1fr auto}
.ui-house .gc-card{counter-reset:gcsec}.ui-house .gc-sec{position:relative;counter-increment:gcsec}
.ui-house .gc-sec::before{content:"";position:absolute;left:12px;top:0;width:34px;height:3px;background:var(--red);box-shadow:38px 0 0 -1px var(--cream)}
.ui-house .gc-sec-h{font:600 1.02rem/1 var(--silk);letter-spacing:.07em;text-transform:uppercase}
.ui-house .gc-sec-h::after{content:"SR-CTL \\00b7  " counter(gcsec,decimal-leading-zero);order:2;margin-left:auto;font:800 .62rem var(--mono);letter-spacing:.14em;color:var(--red);opacity:.85}
.ui-house .gc-chev{order:3;margin-left:10px}
.ui-house .gc-card label:has(>input[type=range]){grid-template-columns:auto 1fr 3.5em}.ui-house .gc-card label:has(>input[type=range]) .gc-lab{white-space:nowrap}
.ui-house .gc-card input[type=checkbox]{border-radius:4px;border-color:var(--oxide);background:linear-gradient(180deg,rgb(0 0 0 / .55),rgb(255 255 255 / .04));box-shadow:inset 0 1px 3px rgb(0 0 0 / .7),inset 0 0 0 1px rgb(239 228 201 / .05)}
.ui-house .gc-card input[type=checkbox]:checked{background:linear-gradient(180deg,rgb(4 18 24 / .7),var(--accent-soft));border-color:var(--accent);box-shadow:var(--glow),inset 0 1px 3px rgb(0 0 0 / .6)}
.ui-house .gc-card input[type=checkbox]::before{content:"OFF";position:absolute;right:4px;top:50%;transform:translateY(-50%);font:800 7px/1 var(--mono);letter-spacing:.04em;color:rgb(147 161 173 / .55)}
.ui-house .gc-card input[type=checkbox]:checked::before{content:"ON";right:auto;left:5px;color:var(--cream);text-shadow:0 0 4px rgb(239 228 201 / .6)}
.ui-house .gc-card label:has(>input:checked){box-shadow:inset 0 -1px 0 rgb(92 214 239 / .45)}
.ui-house .gc-prof{font-size:0;gap:0;flex-direction:column;justify-content:center;line-height:1}.ui-house .gc-prof svg{display:none}
.ui-house .gc-prof::before{font:600 1.05rem/1 var(--silk);letter-spacing:.1em;text-transform:uppercase}
.ui-house .gc-prof[data-slot="0"]::before{content:"Kit A"}.ui-house .gc-prof[data-slot="1"]::before{content:"Kit B"}
.ui-house .gc-prof[data-slot="2"]::before{content:"Kit C"}.ui-house .gc-prof[data-slot="3"]::before{content:"Kit D"}
.ui-house .gc-profiles{counter-reset:gckit}.ui-house .gc-prof{counter-increment:gckit}
.ui-house .gc-prof::after{content:"SR-KIT · " counter(gckit,decimal-leading-zero);white-space:nowrap;margin-top:4px;font:800 .5rem/1 var(--mono);letter-spacing:.14em;color:var(--red);opacity:.85}
.ui-house .gc-prof[aria-pressed=true]::before{color:var(--accent);text-shadow:0 0 8px rgb(92 214 239 / .5)}
.ui-house .gc-fold .gc-icon{width:38px;height:38px;border-radius:50%;border-color:var(--oxide);color:#1a1208;
background:radial-gradient(circle,#f1dcae 0 30%,#8a6a3c 31% 36%,transparent 37%),repeating-conic-gradient(#d8b77a 0 6deg,#4a3820 6deg 12deg);
box-shadow:0 0 0 2px rgb(0 0 0 / .6),0 2px 4px #000}
.ui-house .gc-fold .gc-icon:hover:not(:disabled){background:radial-gradient(circle,#f1dcae 0 30%,#8a6a3c 31% 36%,transparent 37%),repeating-conic-gradient(#e8c98c 0 6deg,#5a4426 6deg 12deg);box-shadow:var(--glow),0 2px 4px #000}
.ui-house .gc-fold .gc-icon svg{width:14px;height:14px;position:relative}`;

/** Brass, by the house kit's tokens: a capped fader thumb with a groove, a dark inset slot, and a rocker switch whose block lights cyan when on. */
const BRASS = "linear-gradient(90deg,#5a4426,#d8b77a 42%,#f1dcae 50%,#8a6a3c 58%,#4a3820)";
const THEME = {
  ...SKIN.theme,
  "--ui-track": "linear-gradient(180deg,rgb(0 0 0 / .85) 0 45%,rgb(239 228 201 / .28))", "--ui-track-h": "6px",
  "--ui-thumb": `linear-gradient(90deg,transparent 44%,rgb(30 20 10 / .85) 44% 56%,transparent 56%),${BRASS}`, "--ui-thumb-w": "14px", "--ui-thumb-h": "24px",
  "--ui-knob": BRASS, "--ui-knob-radius": "2px", "--ui-knob-on": "linear-gradient(180deg,#bff3fb,var(--accent))", "--ui-knob-on-glow": "0 0 8px var(--accent)",
};

/** The saved look settings; GameView reads this on every drag. */
export const look = { ...DEFAULTS };
const openers = new Set<(open: boolean) => void>();
/** Hear the dialog open or close (the hunt pauses while it is up). */
export const onControlsToggle = (f: (open: boolean) => void) => { openers.add(f); return () => { openers.delete(f); }; };

export function mountCog(parent: HTMLElement) {
  mountControls({
    key: "splat-rooms.controls", parent,
    skin: "house", theme: THEME, css: LAB_CSS, faders: true,
    // Short names, so a phone keeps each on one line beside its fader.
    labels: { lookX: "Look X speed", lookY: "Look Y speed", touch: "Touch speed", touchX: "Touch X speed", touchY: "Touch Y speed" },
    keys: [["Drag", "Look around"], ["Space", "One splat"], ["Shift + Space", "Spray twenty"], ["P", "Pick mode"], ["Esc", "Pause"]],
    onChange: (s) => Object.assign(look, s),
    onToggle: (open) => openers.forEach((f) => f(open)),
  });
}
