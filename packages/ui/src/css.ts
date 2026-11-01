import { TOKENS } from "./tokens.ts";

/** The kit's stylesheet: default tokens on `:root` at zero weight, so a page re-themes by setting any token on `:root` or a parent, then one rule set per component. Every colour is a token. */
export const uiCss = `
:where(:root){${Object.entries(TOKENS).map(([k, v]) => `${k}:${v}`).join(";")}}
.ui{font:15px/1.5 var(--ui-font);color:var(--ui-ink)}
.ui-btn,.ui-chip,.ui-tab{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius-sm);background:var(--ui-bg);color:var(--ui-ink);font:inherit;font-weight:600;cursor:pointer;transition:background .12s,transform .06s}
.ui-btn:hover,.ui-chip:hover,.ui-tab:hover{background:var(--ui-soft)}.ui-btn:active,.ui-chip:active,.ui-tab:active{transform:scale(.97)}
.ui-btn:disabled{opacity:.4;cursor:default}
.ui-btn.primary{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-bg)}
.ui-btn.icon{width:44px;padding:0}
.ui-chip{min-height:36px;border-radius:999px}
.ui-chip[aria-pressed=true],.ui-tab[aria-selected=true]{border-color:var(--ui-accent);background:var(--ui-accent-soft)}
.ui-tabs{display:flex;gap:6px}.ui-tabs .ui-tab{flex:1}
.ui-panel{background:var(--ui-bg);color:var(--ui-ink);border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);padding:20px;display:grid;gap:14px}
.ui-toggle{appearance:none;width:52px;height:30px;margin:0;border:var(--ui-border) solid var(--ui-line);border-radius:999px;background:var(--ui-bg);position:relative;cursor:pointer;transition:background .12s}
.ui-toggle::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--ui-line);transition:transform .12s}
.ui-toggle:checked{background:var(--ui-accent-soft);border-color:var(--ui-accent)}.ui-toggle:checked::after{transform:translateX(22px);background:var(--ui-accent)}
.ui-slider{width:100%;accent-color:var(--ui-accent)}
.ui-scrim{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:var(--ui-scrim);padding:12px}.ui-scrim[hidden]{display:none}
.ui-dialog{width:min(480px,100%);max-height:100%;overflow:auto}
.ui-toasts{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1100;display:grid;gap:8px;justify-items:center;pointer-events:none}
.ui-toast{padding:10px 18px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-toast-radius);background:var(--ui-toast-bg);color:var(--ui-toast-ink);font-weight:600}
.ui :focus-visible,.ui-btn:focus-visible,.ui-chip:focus-visible,.ui-tab:focus-visible,.ui-toggle:focus-visible{outline:3px solid var(--ui-accent);outline-offset:2px}
@media (max-width:520px){.ui-scrim{align-items:end;padding:0}.ui-dialog{border-radius:var(--ui-radius) var(--ui-radius) 0 0;border-bottom:0}}
`;

/** Inject the stylesheet once per page. */
export function installUi(): void {
  if (document.getElementById("ui-style")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "ui-style", textContent: uiCss }));
}
