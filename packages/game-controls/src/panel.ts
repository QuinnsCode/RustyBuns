// A cog button that opens a Controls dialog: the key list, then look sensitivity (X, Y, touch), invert Y and Reset.
// Changes apply at once and are saved under `key`. The dialog is a bottom sheet on a narrow screen, a card on a
// wide one, and scrolls when the screen is short.
import { createElement, Settings as Cog, X } from "lucide";
import { DEFAULTS, RANGES, type NumKey, type Settings, parseSettings } from "./settings.ts";

export interface Opts {
  /** localStorage key, one per game. */
  key: string;
  /** Where the cog goes: a top bar or the HUD. The dialog itself goes on the body. */
  parent: HTMLElement;
  /** The dialog title; "Controls" if left out. */
  title?: string;
  /** Key and gesture rows, e.g. ["WASD", "Move"]. */
  keys?: [string, string][];
  /** Rows that make no sense for the game (no vertical look, say); their saved values stay in the settings. */
  hide?: (keyof Settings)[];
  /** Optional groups of rows a game opts into: per-axis touch trims, audio (loudness, on/off, `sounds`), view (brightness, zoom, tilt). */
  show?: ("touchAxes" | "audio" | "view")[];
  /** Sound pieces the player can switch off one by one, e.g. ["steps", "Footsteps"]; needs `show: ["audio"]`. */
  sounds?: [string, string][];
  /** Row names for a game whose look is not a look ("Stick sensitivity" for a slide game). */
  labels?: Partial<Record<NumKey, string>>;
  /** Called with the saved settings on mount and after every change. */
  onChange?: (s: Settings) => void;
  /** Called when the dialog opens or closes, so a game can pause or let go of the mouse. */
  onToggle?: (open: boolean) => void;
  /** Game-specific rows (rebinding, field of view...), appended after Invert Y and before Reset. */
  extras?: (card: HTMLElement) => void | { sync: () => void };
  /** Called when Reset to defaults is pressed, so a game can reset its own extras. */
  onReset?: () => void;
}

const read = (key: string): Settings => {
  try { return parseSettings(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { return { ...DEFAULTS }; }
};

export function mountControls(o: Opts) {
  let s = read(o.key);
  const btn = Object.assign(document.createElement("button"), { type: "button", title: "Controls", ariaLabel: "Controls", className: "gc-cog" });
  btn.append(createElement(Cog, { width: 20, height: 20 }));
  const dlg = Object.assign(document.createElement("div"), { className: "gc-dialog", hidden: true, role: "dialog", ariaLabel: "Controls" });
  const card = document.createElement("div");
  card.className = "gc-card";
  const head = document.createElement("div");
  head.className = "gc-head";
  const close = Object.assign(document.createElement("button"), { type: "button", title: "Close", ariaLabel: "Close", className: "gc-close" });
  close.append(createElement(X, { width: 18, height: 18 }));
  head.append(Object.assign(document.createElement("h2"), { textContent: o.title ?? "Controls" }), close);
  card.append(head);

  if (o.keys?.length) {
    const dl = document.createElement("dl");
    dl.className = "gc-keys";
    for (const [k, v] of o.keys) dl.append(Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v }));
    card.append(dl);
  }

  const syncs: (() => void)[] = [];
  const save = () => {
    try { localStorage.setItem(o.key, JSON.stringify(s)); } catch {}
    o.onChange?.({ ...s });
  };
  const row = (label: string, input: HTMLElement, out?: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
    if (out) l.append(out);
    card.append(l);
  };
  const slider = (label: string, k: NumKey) => {
    if (o.hide?.includes(k)) return;
    const r = RANGES[k];
    const text = (v: number) => (r.unit === "%" ? `${Math.round(v * 100)}%` : r.unit === "deg" ? `${v > 0 ? "+" : ""}${v}\u00b0` : `${v.toFixed(2)}x`);
    const i = Object.assign(document.createElement("input"), { type: "range", name: k, min: String(r.min), max: String(r.max), step: String(r.step) });
    const out = document.createElement("output");
    i.addEventListener("input", () => { s = { ...s, [k]: Number(i.value) }; out.textContent = text(s[k]); save(); });
    syncs.push(() => { i.value = String(s[k]); out.textContent = text(s[k]); });
    row(label, i, out);
  };
  const check = (label: string, k: "musicOn" | "sfxOn") => {
    if (o.hide?.includes(k)) return;
    const c = Object.assign(document.createElement("input"), { type: "checkbox", name: k });
    c.addEventListener("change", () => { s = { ...s, [k]: c.checked }; save(); });
    syncs.push(() => { c.checked = s[k]; });
    row(label, c);
  };
  const piece = (id: string, label: string) => {
    const c = Object.assign(document.createElement("input"), { type: "checkbox", name: `sound-${id}` });
    c.addEventListener("change", () => { s = { ...s, muted: c.checked ? s.muted.filter((m) => m !== id) : [...s.muted.filter((m) => m !== id), id] }; save(); });
    syncs.push(() => { c.checked = !s.muted.includes(id); });
    row(label, c);
  };
  slider(o.labels?.lookX ?? "Look X sensitivity", "lookX");
  slider(o.labels?.lookY ?? "Look Y sensitivity", "lookY");
  slider(o.labels?.touch ?? "Touch sensitivity", "touch");
  if (o.show?.includes("touchAxes")) {
    slider(o.labels?.touchX ?? "Touch X sensitivity", "touchX");
    slider(o.labels?.touchY ?? "Touch Y sensitivity", "touchY");
  }
  const inv = Object.assign(document.createElement("input"), { type: "checkbox", name: "invertY" });
  inv.addEventListener("change", () => { s = { ...s, invertY: inv.checked }; save(); });
  syncs.push(() => { inv.checked = s.invertY; });
  if (!o.hide?.includes("invertY")) row("Invert Y", inv);
  if (o.show?.includes("audio")) {
    slider(o.labels?.music ?? "Music volume", "music");
    check("Music on", "musicOn");
    slider(o.labels?.sfx ?? "Effects volume", "sfx");
    check("Effects on", "sfxOn");
    for (const [id, label] of o.sounds ?? []) piece(id, label);
  }
  if (o.show?.includes("view")) {
    slider(o.labels?.brightness ?? "Brightness", "brightness");
    slider(o.labels?.zoom ?? "Camera zoom", "zoom");
    slider(o.labels?.tilt ?? "Camera tilt", "tilt");
  }
  const extra = o.extras?.(card);
  if (extra) syncs.push(extra.sync);
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "gc-reset", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => { s = { ...DEFAULTS }; o.onReset?.(); syncs.forEach((f) => f()); save(); });
  card.append(reset);

  const toggle = (open: boolean) => {
    if (dlg.hidden !== open) return;
    dlg.hidden = !open;
    if (open) syncs.forEach((f) => f());
    o.onToggle?.(open);
  };
  btn.addEventListener("click", () => { toggle(dlg.hidden); btn.blur(); });
  close.addEventListener("click", () => toggle(false));
  dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) toggle(false); });
  dlg.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.code === "Escape") toggle(false); });
  dlg.append(card);
  o.parent.append(btn);
  document.body.append(dlg);
  addStyle();
  syncs.forEach((f) => f());
  o.onChange?.({ ...s });
  return { get: () => ({ ...s }), open: () => toggle(true), close: () => toggle(false), isOpen: () => !dlg.hidden, destroy: () => { btn.remove(); dlg.remove(); } };
}

function addStyle() {
  if (document.getElementById("gc-style")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "gc-style", textContent: `
.gc-cog,.gc-close{display:inline-grid;place-items:center;width:44px;height:44px;border:1px solid #fff4;border-radius:10px;background:#0009;color:#fff;cursor:pointer;pointer-events:auto}
.gc-dialog{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#0008;padding:12px;font:14px system-ui,sans-serif}
.gc-dialog[hidden]{display:none}
.gc-card{box-sizing:border-box;width:min(420px,100%);max-height:100%;overflow:auto;background:#15171c;color:#eee;border:1px solid #fff3;border-radius:14px;padding:16px;display:grid;gap:12px}
.gc-head{display:flex;justify-content:space-between;align-items:center}.gc-head h2{margin:0;font-size:18px}
.gc-keys{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}.gc-keys dt{font-weight:600}.gc-keys dd{margin:0;opacity:.8}
.gc-card label{display:grid;grid-template-columns:1fr 1.4fr 3.5em;align-items:center;gap:8px;min-height:44px}
.gc-card input[type=range]{width:100%;min-width:0}.gc-card input[type=checkbox]{width:22px;height:22px;justify-self:start}
.gc-card output{text-align:right;opacity:.8}
.gc-reset{min-height:44px;border:1px solid #fff4;border-radius:10px;background:#222;color:#fff;cursor:pointer}
@media (max-width:520px){.gc-dialog{align-items:end}.gc-card{border-radius:14px 14px 0 0}}
` }));
}
