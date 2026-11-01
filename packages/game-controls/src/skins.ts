// The looks for the Controls panel. The panel itself (panel.ts) is headless: it only sets `gc-*` classes.
// "classic" is the dark card the first nine games shipped with, "house" is the soft, bold kit look driven by
// `--ui-*` tokens, and "none" adds nothing so a game can style the classes itself.
export type Skin = "classic" | "house" | "none";
/** Token name (with or without the leading `--`) to CSS value. */
export type Theme = Record<string, string>;

/** The house tokens and their defaults: one accent, ink on white, fat rounded tiles with one strong outline. */
export const TOKENS = {
  "--ui-bg": "#ffffff",
  "--ui-ink": "#141414",
  "--ui-dim": "#6e6e73",
  "--ui-line": "#141414",
  "--ui-soft": "#f4f3f0",
  "--ui-accent": "#e8590c",
  "--ui-accent-soft": "#fff1e8",
  "--ui-scrim": "#14141466",
  "--ui-radius": "16px",
  "--ui-radius-sm": "12px",
  "--ui-border": "2px",
  "--ui-font": "ui-rounded,'SF Pro Rounded',system-ui,sans-serif",
} as const;

const classic = `
.gc-cog,.gc-close{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;line-height:0;box-sizing:border-box;border:1px solid #fff4;border-radius:10px;background:#0009;color:#fff;cursor:pointer;pointer-events:auto}
.gc-dialog{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#0008;padding:12px;font:14px system-ui,sans-serif}
.gc-dialog[hidden]{display:none}
.gc-card{box-sizing:border-box;width:min(420px,100%);max-height:100%;overflow:auto;background:#15171c;color:#eee;border:1px solid #fff3;border-radius:14px;padding:16px;display:grid;gap:12px}
.gc-head{display:flex;justify-content:space-between;align-items:center}.gc-head h2{margin:0;font-size:18px}
.gc-keys{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}.gc-keys dt{font-weight:600}.gc-keys dd{margin:0;opacity:.8}
.gc-card label{display:grid;grid-template-columns:1fr 1.4fr 3.5em;align-items:center;gap:8px;min-height:44px}
.gc-card input[type=range]{width:100%;min-width:0}.gc-card input[type=checkbox]{width:22px;height:22px;justify-self:start}
.gc-card output{text-align:right;opacity:.8}
.gc-binds{display:grid;grid-template-columns:1fr 1.4fr auto;align-items:center;gap:6px 8px}
.gc-key{min-height:36px;padding:0 8px;justify-content:center;border:1px solid #fff4;border-radius:8px;background:#222;color:#fff;cursor:pointer;font:inherit}.gc-key.on{border-color:#f90;color:#f90}
.gc-icon{display:inline-grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid #fff4;border-radius:8px;background:#222;color:#fff;cursor:pointer}.gc-icon:disabled{opacity:.35;cursor:default}
.gc-note{margin:0;color:#f90}.gc-bar{display:grid;grid-template-columns:auto 1fr;gap:8px}.gc-bar .gc-icon{width:44px;height:44px}
.gc-reset{min-height:44px;border:1px solid #fff4;border-radius:10px;background:#222;color:#fff;cursor:pointer}
.gc-pane{display:grid;gap:10px}.gc-sub{margin:8px 0 0;font-size:13px;font-weight:600;opacity:.8}.gc-pane[hidden]{display:none}
.gc-tabs{display:flex;gap:6px}.gc-tab{flex:1;min-height:38px;padding:0 10px;justify-content:center;border:1px solid #fff4;border-radius:8px;background:#222;color:#fff;cursor:pointer;font:inherit}.gc-tab[aria-selected=true]{border-color:#f90;color:#f90}
/* Infinite Craft's look: warm paper tiles with a faint grain, thin grey edges, ink-black text, one orange accent. */
.gc-craft{--gc-paper:#fcfbf8;--gc-ink:#0a0a0a;--gc-dim:#6b6b6b;--gc-rule:#e6e6e6;--gc-edge:#cfcfcf;--gc-acc:#e8590c;--gc-soft:#fff4ec;
--gc-grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .32 0 0 0 0 .28 0 0 0 0 .2 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.gc-dialog.gc-craft{background:#0a0a0a55;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--gc-ink)}
.gc-craft .gc-card{background:#fff;color:var(--gc-ink);border:1px solid var(--gc-rule);border-radius:10px;box-shadow:0 24px 64px -16px #0003;padding:20px 22px;width:min(520px,100%);min-height:min(560px,100%);align-content:start}
.gc-craft .gc-head h2{font-size:24px;font-weight:600;letter-spacing:-.04em}
.gc-craft button{color:var(--gc-ink)}
.gc-craft.gc-cog,.gc-craft .gc-close,.gc-craft .gc-icon,.gc-craft .gc-key,.gc-craft .gc-tab,.gc-craft .gc-reset{border:1px solid var(--gc-edge);border-radius:5px;background:var(--gc-grain),var(--gc-paper);color:var(--gc-ink);transition:border-color .12s,background .12s,transform .06s}
.gc-craft.gc-cog:hover,.gc-craft .gc-close:hover,.gc-craft .gc-icon:hover:not(:disabled),.gc-craft .gc-key:hover,.gc-craft .gc-tab:hover,.gc-craft .gc-reset:hover{background:var(--gc-grain),linear-gradient(0deg,var(--gc-soft),var(--gc-paper) 85%);border-color:#a8a8a8}
.gc-craft .gc-tab[aria-selected=true],.gc-craft .gc-key.on{border-color:var(--gc-acc);color:var(--gc-ink);background:var(--gc-grain),var(--gc-soft);box-shadow:inset 0 -2px 0 var(--gc-acc)}
.gc-craft .gc-tab{font-weight:500}
.gc-craft .gc-keys dd,.gc-craft .gc-card output{color:var(--gc-dim);opacity:1}
.gc-craft .gc-note{color:var(--gc-acc)}
.gc-craft .gc-card input[type=range],.gc-craft .gc-card input[type=checkbox]{accent-color:var(--gc-acc)}
.gc-craft .gc-card label{border-bottom:1px solid var(--gc-rule)}
.gc-craft .gc-binds{padding-bottom:4px}
.gc-craft .gc-key{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.gc-craft .gc-acct{display:grid;gap:10px;justify-items:start}
.gc-craft .gc-acct button{padding:9px 14px;justify-content:center;border:1px solid var(--gc-edge);border-radius:5px;background:var(--gc-grain),var(--gc-paper);font:500 13px ui-sans-serif,system-ui,sans-serif;cursor:pointer;display:inline-flex;gap:7px;align-items:center}
.gc-craft .gc-acct button.primary{background:var(--gc-grain),var(--gc-ink);border-color:var(--gc-ink);color:#fff}
.gc-craft .gc-acct p{margin:0;color:var(--gc-dim)}
.gc-craft .gc-acct b{color:var(--gc-ink);font-size:16px}
@media (max-width:520px){.gc-dialog{align-items:end}.gc-card{border-radius:14px 14px 0 0}}
`;

const house = `
.ui-house{${Object.entries(TOKENS).map(([k, v]) => `${k}:${v}`).join(";")}}
.gc-dialog.ui-house{background:var(--ui-scrim);font:15px/1.5 var(--ui-font);color:var(--ui-ink)}
.ui-house .gc-card{background:var(--ui-bg);color:var(--ui-ink);border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);padding:20px;gap:14px;width:min(480px,100%)}
.ui-house .gc-head h2{font-size:24px;font-weight:700;letter-spacing:-.02em}
.gc-cog.ui-house,.ui-house .gc-close,.ui-house .gc-icon,.ui-house .gc-key,.ui-house .gc-tab,.ui-house .gc-reset{border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius-sm);background:var(--ui-bg);color:var(--ui-ink);font:inherit;font-weight:600;transition:background .12s,transform .06s}
.gc-cog.ui-house{font-family:var(--ui-font)}
.gc-cog.ui-house:hover,.ui-house .gc-close:hover,.ui-house .gc-icon:hover:not(:disabled),.ui-house .gc-key:hover,.ui-house .gc-tab:hover,.ui-house .gc-reset:hover{background:var(--ui-soft)}
.gc-cog.ui-house:active,.ui-house .gc-key:active,.ui-house .gc-tab:active,.ui-house .gc-reset:active{transform:scale(.97)}
.ui-house .gc-key,.ui-house .gc-tab{min-height:44px}
.ui-house .gc-tab[aria-selected=true],.ui-house .gc-key.on{border-color:var(--ui-accent);background:var(--ui-accent-soft);color:var(--ui-ink)}
.ui-house .gc-keys dd,.ui-house .gc-card output{color:var(--ui-dim);opacity:1}
.ui-house .gc-note{color:var(--ui-accent)}
.ui-house .gc-card input[type=range],.ui-house .gc-card input[type=checkbox]{accent-color:var(--ui-accent)}
.ui-house .gc-card label{border-bottom:1px solid var(--ui-soft)}
.ui-house .gc-key{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.ui-house :focus-visible{outline:3px solid var(--ui-accent);outline-offset:2px}
@media (max-width:520px){.gc-dialog.ui-house{align-items:end;padding:0}.ui-house .gc-card{border-radius:var(--ui-radius) var(--ui-radius) 0 0;border-bottom:0}}
`;

const SKINS: Record<Skin, string> = { classic, house: classic + house, none: "" };

/** The CSS a skin adds (the house skin sits on top of the classic layout rules), then the game's own. */
export const skinCss = (skin: Skin, extra = ""): string => (skin === "none" ? "" : SKINS[skin]) + extra;

/** Inject the skin once per page. `none` with no extra CSS injects nothing. */
export function installStyles(skin: Skin, extra?: string): void {
  const css = skinCss(skin, extra);
  if (!css || document.getElementById("gc-style")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "gc-style", textContent: css }));
}

/** Set a game's tokens on the elements that carry the skin (the cog sits in the HUD, the dialog on the body). */
export function applyTheme(theme: Theme | undefined, ...els: HTMLElement[]): void {
  for (const [k, v] of Object.entries(theme ?? {})) for (const el of els) el.style.setProperty(k.startsWith("--") ? k : `--${k}`, v);
}
