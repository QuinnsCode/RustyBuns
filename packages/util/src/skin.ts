// The look of every surface eqosys mounts in a game: the account chip, the achievement toast, the report button and form,
// the party lobby and the spaces panel. Each is plain DOM under a `.eq` root, styled here from packages/ui's `--ui-*`
// tokens, so a game skins all of them at once with `eqosys({ ..., skin: { theme, css } })`: its tokens go on `.eq`, its
// own rules after these. No skin is the house look (packages/ui's TOKENS), light or dark as the system asks.
import { TOKENS, type Theme } from "@rustybuns/ui";

/** A game's look for the eqosys surfaces: `--ui-*` tokens (packages/ui `Theme`), and any rules of its own on the `eq-*` classes. */
export interface Skin { theme?: Theme; css?: string }

const decls = (t: Theme) => Object.entries(t).map(([k, v]) => `${k.startsWith("--") ? k : `--${k}`}:${v}`).join(";");

/** Every rule reads a token; the house values sit on `.eq` at zero weight so a skin's tokens win. */
const BASE = `
.eq{font:14px/1.4 var(--ui-font);color:var(--ui-ink);box-sizing:border-box}.eq *,.eq *::before,.eq *::after{box-sizing:inherit}
.eq-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;min-width:36px;padding:0 12px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius-sm);background:var(--ui-bg);color:var(--ui-ink);font:inherit;font-weight:600;cursor:pointer;transition:background .12s,transform .06s}
.eq-btn:hover{background:var(--ui-soft)}.eq-btn:active{transform:scale(.97)}.eq-btn:disabled{opacity:.45;cursor:default}
.eq-btn.primary{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-on-accent)}
.eq-btn.icon{padding:0}.eq-btn svg{width:18px;height:18px;flex:none}
.eq-btn:focus-visible,.eq input:focus-visible,.eq select:focus-visible,.eq textarea:focus-visible{outline:3px solid var(--ui-accent);outline-offset:2px}
.eq input,.eq select,.eq textarea{width:100%;min-height:36px;padding:7px 10px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius-sm);background:var(--ui-soft);color:var(--ui-ink);font:inherit}
.eq textarea{resize:vertical}.eq ::placeholder{color:var(--ui-dim);opacity:1}
.eq-chip{display:inline-flex;align-items:center;gap:8px}.eq-chip:has(.eq-note){flex-wrap:wrap}.eq-chip .eq-btn{min-height:30px;min-width:30px}
.eq-chip.in{padding:2px 2px 2px 10px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius-sm);background:var(--ui-bg)}
.eq-who{font-family:var(--ui-font-head);font-weight:700;max-width:12em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eq-note{flex-basis:100%;margin:0;color:var(--ui-dim);font-size:12px}
.rb-report{position:fixed;right:12px;bottom:12px;z-index:2147483000;display:grid;justify-items:end;gap:6px}
.eq-form{display:grid;gap:8px;width:min(320px,calc(100vw - 24px));padding:14px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);background:var(--ui-bg);box-shadow:var(--ui-shadow)}
.eq-form[hidden]{display:none}
.eq-title{margin:0;font:700 17px/1.2 var(--ui-font-head);color:var(--ui-ink)}
.eq-status{min-height:1em;color:var(--ui-dim);font-size:12px}
.eq-toasts{position:fixed;left:16px;right:16px;top:16px;z-index:2147483001;display:grid;gap:8px;justify-items:center;pointer-events:none}
.eq-toast{display:flex;align-items:center;gap:12px;max-width:min(420px,calc(100vw - 32px));padding:10px 18px 10px 12px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);background:var(--ui-toast-bg);color:var(--ui-toast-ink);box-shadow:var(--ui-shadow);animation:eq-in .3s ease-out}
.eq-toast svg{width:30px;height:30px;flex:none;color:var(--ui-accent)}
.eq-toast small{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ui-accent)}
.eq-toast b{display:block;font:700 16px/1.2 var(--ui-font-head)}.eq-toast span{display:block;font-size:13px;opacity:.8}
@keyframes eq-in{from{opacity:0;transform:translateY(-12px)}}
.eq-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.eq-toast .eq-badge{align-self:flex-start;margin-left:4px}
@media (prefers-reduced-motion:reduce){.eq-toast{animation:none}}
.rb-lobby{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);background:var(--ui-bg);box-shadow:var(--ui-shadow)}
.rb-lobby[hidden]{display:none}.rb-lobby-who{flex:1 1 200px;min-width:0}
.rb-spaces{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);background:var(--ui-bg);box-shadow:var(--ui-shadow)}
.rb-spaces[hidden]{display:none}
.rb-spaces h2{margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 16px/1.2 var(--ui-font-head)}
.rb-spaces .eq-btn{min-height:32px;min-width:32px;padding:0 8px}.rb-spaces .eq-btn.icon{padding:0}
.rb-spaces-head,.rb-spaces-line{display:flex;gap:6px;align-items:center}.rb-spaces-line input{flex:1;min-width:0}
.rb-spaces-list,.rb-spaces-log,.rb-spaces-online,.rb-spaces-speakers{list-style:none;margin:0;padding:0}
.rb-spaces-list li,.rb-spaces-online li{display:flex;gap:6px;align-items:center;padding:2px 0}
.rb-spaces-list .rb-spaces-row{flex:1;min-width:0;justify-content:flex-start}
.rb-spaces-tabs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.rb-spaces-tabs .rb-spaces-line{flex:1 1 140px}
.rb-spaces-tabs .eq-btn.on{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-on-accent)}
.rb-spaces-body{display:flex;gap:8px;min-height:0;flex:1}
.rb-spaces-chat{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.rb-spaces-log{overflow-y:auto;max-height:40dvh;min-height:80px;overflow-wrap:anywhere}.rb-spaces-log li{padding:2px 0}
.rb-spaces-online{width:110px;flex:none;border-left:var(--ui-border) solid var(--ui-line);padding-left:8px;font-size:13px}
.rb-spaces-online li{justify-content:space-between;overflow:hidden}
.rb-spaces-older{align-self:center}.rb-spaces-note,.rb-spaces-empty{margin:0;font-size:13px;color:var(--ui-dim)}.rb-spaces-note{color:var(--ui-accent)}
.rb-spaces-voice{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:80px}
.rb-spaces-speakers{display:flex;flex-wrap:wrap;gap:6px}
.rb-spaces-speakers li{display:flex;gap:4px;align-items:center;padding:3px 8px;border:var(--ui-border) solid var(--ui-line);border-radius:999px}
.rb-spaces-speakers li.talking{background:var(--ui-accent);color:var(--ui-on-accent)}.rb-spaces-speakers li.muted{opacity:.6}
.rb-spaces-voice-bar{display:flex;gap:6px}.rb-spaces-join,.rb-spaces-drop{align-self:flex-start}
.rb-spaces-in-voice{display:inline-flex;margin-left:auto;margin-right:4px}
@media (max-width:560px){.rb-spaces-body{flex-direction:column}.rb-spaces-online{width:auto;border-left:0;border-top:var(--ui-border) solid var(--ui-line);padding:6px 0 0;display:flex;flex-wrap:wrap;gap:4px 12px}}
`;

/**
 * eqosys's own mark, the same in every game whatever its skin: a badge tag, "eqosys" on black, then a punched strip of
 * oil-slick sunset that drifts like slow weather (three gradient blobs on registered properties, one long cycle each).
 * Kept after the skin's rules and off the `--ui-*` tokens on purpose; still under prefers-reduced-motion.
 */
const BADGE = `
@property --eq-ax{syntax:"<percentage>";inherits:false;initial-value:18%}@property --eq-ay{syntax:"<percentage>";inherits:false;initial-value:30%}
@property --eq-bx{syntax:"<percentage>";inherits:false;initial-value:78%}@property --eq-by{syntax:"<percentage>";inherits:false;initial-value:70%}
@property --eq-tilt{syntax:"<angle>";inherits:false;initial-value:200deg}
.eq .eq-badge{display:inline-flex;opacity:1;align-items:stretch;flex:none;height:20px;border-radius:5px;overflow:hidden;font:700 10px/20px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;color:#ecebf2;box-shadow:0 0 0 1px #0000004d,0 1px 2px #0000003d;user-select:none}
.eq .eq-badge b{display:block;text-transform:lowercase;letter-spacing:.16em;padding:0 6px 0 7px;background:linear-gradient(#1a1a1f,#050506);font:inherit;box-shadow:inset 0 1px 0 #ffffff21}
.eq .eq-badge i{display:block;position:relative;width:34px;background:radial-gradient(60% 80% at var(--eq-ax) var(--eq-ay),#ff8a5c,transparent 70%),radial-gradient(70% 90% at var(--eq-bx) var(--eq-by),#7d5bd6,transparent 70%),conic-gradient(from var(--eq-tilt) at 50% 50%,#f6b24e,#e2557b,#5a8fd8,#3ec7b6,#f6b24e);filter:saturate(.7) brightness(.92);animation:eq-drift 41s ease-in-out infinite alternate,eq-turn 67s linear infinite;-webkit-mask:radial-gradient(circle 2.6px at calc(100% - 7px) 50%,transparent 98%,#000);mask:radial-gradient(circle 2.6px at calc(100% - 7px) 50%,transparent 98%,#000)}
.eq .eq-badge i::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,#ffffff0d 0 1px,transparent 1px 3px),linear-gradient(90deg,#00000059,transparent 45%)}
@keyframes eq-drift{0%{--eq-ax:18%;--eq-ay:30%;--eq-bx:78%;--eq-by:70%}33%{--eq-ax:62%;--eq-ay:12%;--eq-bx:30%;--eq-by:88%}66%{--eq-ax:40%;--eq-ay:84%;--eq-bx:86%;--eq-by:22%}100%{--eq-ax:82%;--eq-ay:52%;--eq-bx:14%;--eq-by:40%}}
@keyframes eq-turn{to{--eq-tilt:560deg}}
@media (prefers-reduced-motion:reduce){.eq .eq-badge i{animation:none}}
@media (prefers-color-scheme:dark){.eq .eq-badge{box-shadow:0 0 0 1px #ffffff2e,0 1px 2px #0000007a}}
`;

/** The whole stylesheet for one skin: house tokens, the skin's tokens, the rules, then the skin's own rules. */
/** The house look in the dark, for a page whose system asks for it (a game's own skin still wins: it sits on `.eq`). */
export const DARK: Theme = {
  "--ui-bg": "#17171a", "--ui-ink": "#f2f1ee", "--ui-dim": "#a3a3aa", "--ui-line": "#e9e7e2", "--ui-soft": "#242428",
  "--ui-accent": "#ff7a2e", "--ui-accent-soft": "#3a2416", "--ui-on-accent": "#141414", "--ui-scrim": "#000000aa",
  "--ui-shadow": "0 10px 28px -12px #000000d9",
};

export const skinCss = (skin: Skin = {}) => `:where(.eq){${decls(TOKENS)}}\n@media (prefers-color-scheme:dark){:where(.eq){${decls(DARK)}}}\n.eq{${decls(skin.theme ?? {})}}\n${BASE}\n${skin.css ?? ""}\n${BADGE}`;

let worn: Skin = {};
/**
 * Put the eqosys stylesheet on the page: `skin` replaces the one worn, nothing just makes sure it is there (every
 * surface calls this as it mounts). One `<style id="eq-skin">`, rewritten in place, so a later skin wins outright.
 */
export function wearSkin(skin?: Skin): void {
  if (skin) worn = skin;
  if (typeof document === "undefined") return;
  let s = document.getElementById("eq-skin");
  if (s && !skin) return;
  if (!s) { s = Object.assign(document.createElement("style"), { id: "eq-skin" }); document.head.append(s); }
  s.textContent = skinCss(worn);
}

// Lucide icons the surfaces draw for themselves (log-in, log-out, trophy, flag), so this package keeps no dependencies.
const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  "log-in": svg('<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>'),
  "log-out": svg('<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'),
  trophy: svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
  flag: svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
} as const;

/** eqosys's badge tag (see BADGE): the word on black and a slow oil-slick strip, the same in every game. */
export function eqBadge(): HTMLElement {
  const b = Object.assign(document.createElement("span"), { className: "eq-badge", title: "eqosys" });
  b.setAttribute("aria-label", "eqosys");
  b.append(Object.assign(document.createElement("b"), { textContent: "eqosys" }), document.createElement("i"));
  return b;
}

/** A skinned button: an icon with its word as the title, a word, or both. */
export function eqButton(o: { text: string; icon?: keyof typeof ICONS; show?: boolean; primary?: boolean; type?: "button" | "submit"; onClick?: () => void }): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = o.type ?? "button";
  b.className = `eq-btn${o.primary ? " primary" : ""}${o.icon && !o.show ? " icon" : ""}`;
  if (o.icon) { b.innerHTML = ICONS[o.icon]; b.title = o.text; b.setAttribute("aria-label", o.text); }
  if (!o.icon || o.show) b.append(o.text);
  if (o.onClick) b.addEventListener("click", o.onClick);
  return b;
}
