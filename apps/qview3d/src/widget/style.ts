// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The default look. Every colour, radius and font is a custom property the host page may set on <qview-3d>,
// and every piece is a ::part() it may restyle; controls="none" hides them all for a page that brings its own.
export const css = `
:host {
  --qv-bg: radial-gradient(120% 90% at 50% 35%, #ffffff 0%, #eef0f3 55%, #dfe3e8 100%);
  --qv-fg: #15181d;
  --qv-muted: #6b7280;
  --qv-on-fg: #ffffff;
  --qv-surface: rgba(255, 255, 255, 0.78);
  --qv-border: rgba(15, 23, 42, 0.08);
  --qv-accent: #ff5a1f;
  --qv-accent-fg: #ffffff;
  --qv-radius: 16px;
  --qv-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --qv-shadow: 0 8px 28px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  display: block; position: relative; height: 520px; min-height: 320px;
  font: 500 13px/1.2 var(--qv-font); color: var(--qv-fg);
  border-radius: var(--qv-radius); overflow: hidden; isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
:host([theme="dark"]) {
  --qv-bg: radial-gradient(120% 90% at 50% 35%, #2a2f37 0%, #181b20 60%, #0f1114 100%);
  --qv-fg: #f3f4f6; --qv-muted: #9ca3af; --qv-on-fg: #111318;
  --qv-surface: rgba(24, 27, 32, 0.72); --qv-border: rgba(255, 255, 255, 0.08);
  --qv-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
* { box-sizing: border-box; }
.stage { position: absolute; inset: 0; background: var(--qv-bg); }
.gl { position: absolute; inset: 0; }
.loading { position: absolute; inset: 0; display: grid; place-items: center; color: var(--qv-muted); }
.loading i { width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid var(--qv-border); border-top-color: var(--qv-accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.glass { background: var(--qv-surface); backdrop-filter: blur(14px) saturate(1.4); -webkit-backdrop-filter: blur(14px) saturate(1.4);
  border: 1px solid var(--qv-border); box-shadow: var(--qv-shadow); border-radius: 999px; }

.models { position: absolute; top: 12px; left: 12px; display: flex; padding: 3px; gap: 2px; }
.models button { padding: 0 12px; height: 30px; border-radius: 999px; color: var(--qv-muted); }
.models button[aria-pressed="true"] { background: var(--qv-fg); color: var(--qv-on-fg); }
.corner { position: absolute; top: 12px; right: 12px; display: flex; padding: 3px; gap: 2px; }

.toolbar { position: absolute; left: 12px; right: 12px; bottom: 12px; width: fit-content; margin-inline: auto; display: flex; align-items: center; gap: 4px;
  padding: 5px; flex-wrap: wrap; justify-content: center; border-radius: 22px; }
.sep { width: 1px; align-self: stretch; margin: 6px 4px; background: var(--qv-border); }

button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
  white-space: nowrap; font: inherit; transition: background 0.15s, color 0.15s, transform 0.1s; }
button:focus-visible { outline: 2px solid var(--qv-accent); outline-offset: 2px; }
button:active { transform: scale(0.96); }
.icon { width: 36px; height: 36px; border-radius: 999px; color: var(--qv-fg); }
.icon:hover { background: var(--qv-border); }
.icon svg { width: 18px; height: 18px; stroke-width: 1.9; }
.primary { height: 36px; padding: 0 14px 0 11px; border-radius: 999px; background: var(--qv-accent); color: var(--qv-accent-fg); font-weight: 600; }
.primary:hover { filter: brightness(1.06); }
.primary svg { width: 17px; height: 17px; stroke-width: 2.1; }
button[disabled] { opacity: 0.45; pointer-events: none; }
button.busy svg { animation: spin 0.9s linear infinite; }

.swatches { display: flex; gap: 5px; padding: 0 4px; }
.swatch { width: 24px; height: 24px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); }
.swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--qv-surface), 0 0 0 4px var(--qv-accent); }

.tune { display: flex; align-items: center; gap: 2px; }
.tune[hidden] { display: none; }
label.slider { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; color: var(--qv-muted); }
label.slider svg { width: 16px; height: 16px; }
input[type="range"] { -webkit-appearance: none; appearance: none; width: 84px; height: 4px; border-radius: 4px; background: var(--qv-border); outline: none; }
input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--qv-fg); border: 2px solid var(--qv-surface); }
input[type="range"]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--qv-fg); border: 2px solid var(--qv-surface); }

.hint { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 10px 16px 10px 12px; color: var(--qv-fg); font-weight: 600; }
.hint svg { width: 18px; height: 18px; color: var(--qv-accent); }
.hint[hidden], .toolbar[hidden], .models[hidden], .corner[hidden] { display: none; }

.drop { position: absolute; inset: 10px; border-radius: calc(var(--qv-radius) - 4px); border: 2px dashed var(--qv-accent);
  background: color-mix(in srgb, var(--qv-accent) 8%, transparent); display: none; place-items: center; font-weight: 600; color: var(--qv-accent); pointer-events: none; }
:host([dragover]) .drop { display: grid; }
.toast { position: absolute; left: 50%; top: 56px; transform: translate(-50%, -8px); padding: 8px 14px; opacity: 0; pointer-events: none;
  transition: opacity 0.2s, transform 0.2s; max-width: calc(100% - 24px); text-align: center; white-space: normal; border-radius: 14px; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.toast a { color: var(--qv-accent); }

@media (max-width: 520px) {
  .models button { padding: 0 10px; }
  input[type="range"] { width: 64px; }
  .primary span { display: none; }
  .primary { padding: 0 10px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
