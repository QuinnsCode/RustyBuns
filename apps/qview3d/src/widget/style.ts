// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The default look: codeSplitter's. Ink on white, hairline borders, paper panels, one orange. Every colour, radius
// and font is a custom property the host page may set on <qview-3d>, and every piece is a ::part() it may restyle;
// controls="none" hides them all for a page that brings its own.
//
// Accessible by default: text and filled buttons pass WCAG AA contrast (the bright orange marks things, the deeper
// --qv-accent-ink carries text and fills), every control is 32 px or more with a visible focus ring, and motion
// stops for people who ask the system for less.
export const css = `
:host {
  --qv-bg: #ffffff;
  --qv-stage: radial-gradient(120% 90% at 50% 30%, #ffffff 0%, #f6f5f2 60%, #eceae5 100%);
  --qv-fg: #0a0a0a;
  --qv-muted: #6b6b6b;
  --qv-line: #e6e6e6;
  --qv-paper: #fcfbf8;
  --qv-accent: #e8590c;
  --qv-accent-ink: #c2410c;
  --qv-accent-soft: #fff4ec;
  --qv-on-accent: #ffffff;
  --qv-on-fg: #ffffff;
  --qv-radius: 12px;
  --qv-radius-sm: 8px;
  --qv-font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --qv-shadow: 0 1px 2px rgba(10, 10, 10, 0.06), 0 8px 24px -12px rgba(10, 10, 10, 0.18);
  display: block; position: relative; height: 520px; min-height: 320px;
  font: 500 13px/1.3 var(--qv-font); color: var(--qv-fg);
  border: 1px solid var(--qv-line); border-radius: var(--qv-radius); overflow: hidden; isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
:host([theme="dark"]) {
  --qv-bg: #0d1117;
  --qv-stage: radial-gradient(120% 90% at 50% 30%, #1c222b 0%, #11151b 60%, #0d1117 100%);
  --qv-fg: #e6edf3; --qv-muted: #9198a1; --qv-line: #30363d; --qv-paper: #161b22;
  --qv-accent: #f26b1d; --qv-accent-ink: #ff8a4c; --qv-accent-soft: #2a1a10; --qv-on-accent: #0d1117; --qv-on-fg: #0d1117;
  --qv-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.stage { position: absolute; inset: 0; background: var(--qv-stage); }
.gl { position: absolute; inset: 0; }
.gl canvas:focus-visible { outline: 2px solid var(--qv-accent-ink); outline-offset: -4px; border-radius: var(--qv-radius); }
.loading { position: absolute; inset: 0; display: grid; place-items: center; }
.loading i { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--qv-line); border-top-color: var(--qv-accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.panel { background: var(--qv-paper); border: 1px solid var(--qv-line); border-radius: var(--qv-radius); box-shadow: var(--qv-shadow); }

button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
  white-space: nowrap; font: inherit; color: var(--qv-fg); border-radius: var(--qv-radius-sm); transition: background 0.12s, color 0.12s, border-color 0.12s; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--qv-accent-ink); outline-offset: 2px; }
button[disabled] { opacity: 0.45; pointer-events: none; }
button.busy svg { animation: spin 0.9s linear infinite; }

.models { position: absolute; top: 10px; left: 10px; display: flex; padding: 3px; gap: 2px; }
.models button { height: 34px; padding: 0 12px; color: var(--qv-muted); font-weight: 600; }
.models button:hover { color: var(--qv-fg); background: var(--qv-bg); }
.models button[aria-pressed="true"] { background: var(--qv-fg); color: var(--qv-on-fg); }

.corner { position: absolute; top: 10px; right: 10px; display: flex; align-items: center; padding: 3px; gap: 2px; }

.toolbar { position: absolute; left: 10px; right: 10px; bottom: 10px; width: fit-content; margin-inline: auto; display: flex; align-items: center; gap: 2px;
  padding: 4px; flex-wrap: wrap; justify-content: center; }
.sep { width: 1px; align-self: stretch; margin: 6px 4px; background: var(--qv-line); }

.icon { width: 40px; height: 40px; }
.icon:hover { background: var(--qv-bg); color: var(--qv-accent-ink); }
.icon svg { width: 18px; height: 18px; stroke-width: 1.75; }
.primary { height: 34px; padding: 0 12px 0 10px; background: var(--qv-accent-ink); color: var(--qv-on-accent); font-weight: 600; }
.primary:hover { background: var(--qv-accent); }
.primary svg { width: 16px; height: 16px; stroke-width: 2; }

.swatches { display: flex; gap: 4px; padding: 0 4px; }
.swatch { width: 32px; height: 32px; border-radius: 50%; position: relative; }
.swatch::before { content: ""; position: absolute; inset: 5px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.14); }
.swatch:hover::before { inset: 4px; }
.swatch[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--qv-accent-ink); }

.tune { display: flex; align-items: center; gap: 2px; }
label.slider { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 8px; color: var(--qv-muted); }
label.slider svg { width: 16px; height: 16px; stroke-width: 1.75; }
input[type="range"] { -webkit-appearance: none; appearance: none; width: 88px; height: 4px; border-radius: 4px; background: var(--qv-line); outline-offset: 6px; cursor: pointer; }
input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--qv-bg); border: 1.5px solid var(--qv-fg); box-shadow: var(--qv-shadow); }
input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--qv-bg); border: 1.5px solid var(--qv-fg); }

.hint { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); height: 44px; padding: 0 16px 0 12px; font-weight: 600; }
.hint:hover { border-color: var(--qv-accent); color: var(--qv-accent-ink); }
.hint svg { width: 18px; height: 18px; color: var(--qv-accent-ink); }

.keys { position: absolute; left: 10px; bottom: 72px; padding: 6px 10px; font-size: 12px; color: var(--qv-muted); pointer-events: none; }
.keys kbd { font: 600 11px/1 ui-monospace, "Geist Mono", monospace; padding: 2px 5px; border: 1px solid var(--qv-line); border-bottom-width: 2px; border-radius: 4px; background: var(--qv-bg); color: var(--qv-fg); }

.drop { position: absolute; inset: 8px; border-radius: calc(var(--qv-radius) - 4px); border: 1.5px dashed var(--qv-accent);
  background: var(--qv-accent-soft); display: none; place-items: center; font-weight: 600; color: var(--qv-accent-ink); pointer-events: none; }
:host([dragover]) .drop { display: grid; }
.toast { position: absolute; left: 50%; top: 56px; transform: translate(-50%, -6px); padding: 8px 14px; opacity: 0; pointer-events: none;
  transition: opacity 0.18s, transform 0.18s; max-width: calc(100% - 24px); text-align: center; white-space: normal; }
.toast.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.toast a { color: var(--qv-accent-ink); font-weight: 600; }

@media (max-width: 520px) {
  .models button { padding: 0 10px; }
  input[type="range"] { width: 64px; }
  .primary span { display: none; }
  .primary { width: 40px; height: 40px; padding: 0; }
  .keys { display: none; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (forced-colors: active) { .panel, .swatch[aria-pressed="true"] { border: 1px solid CanvasText; } }
`;
