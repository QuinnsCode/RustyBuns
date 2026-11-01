// A cog button that opens a Controls dialog: the key list, then look sensitivity (X, Y, touch), invert Y and Reset.
// Changes apply at once and are saved under `key`. The dialog is a bottom sheet on a narrow screen, a card on a
// wide one, and scrolls when the screen is short.
import { createElement, RotateCcw, Settings as Cog, Undo2, X } from "lucide";
import { type Action, type BindingSet, createBindings, keyName } from "./bindings.ts";
import { type Pad, buttonName } from "./gamepad.ts";
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
  /** Rebindable keys: make the set with `loadBindings`, read pressed keys through its `canon`. Each gets a row: click it, press a key. */
  bindings?: BindingSet;
  /** Rebindable gamepad buttons: make the pad with `loadPad`, poll it once a frame. Each gets a row: click it, press a button on the pad. */
  pad?: Pad;
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
  /** Three tabs (Controls, Audio, Account) in a clean paper-tile look, instead of one long dark list. */
  tabs?: boolean;
  /** The Account tab's body (needs `tabs`): sign in, sign out. Return `sync` to redraw it each time the dialog opens. */
  account?: (pane: HTMLElement) => void | { sync: () => void };
  /** Called when Reset to defaults is pressed, so a game can reset its own extras. */
  onReset?: () => void;
}

/** The game's key bindings, restored from what this browser saved under the same `key` the cog uses. */
export function loadBindings(key: string, actions: Action[]): BindingSet {
  try { return createBindings(actions, JSON.parse(localStorage.getItem(`${key}.keys`) ?? "null")); } catch { return createBindings(actions); }
}

const read = (key: string): Settings => {
  try { return parseSettings(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { return { ...DEFAULTS }; }
};

export function mountControls(o: Opts) {
  let s = read(o.key);
  let keyHook: (e: KeyboardEvent) => boolean = () => false;
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
  if (o.tabs) { dlg.classList.add("gc-craft"); btn.classList.add("gc-craft"); }
  // With `tabs`, rows land in the pane for their tab; without, everything goes straight into the card.
  const panes: Record<"controls" | "audio" | "account", HTMLElement> = { controls: card, audio: card, account: card };
  let into: HTMLElement = card;
  if (o.tabs) {
    const nav = Object.assign(document.createElement("div"), { className: "gc-tabs", role: "tablist" });
    const names = { controls: "Controls", audio: "Audio", account: "Account" } as const;
    const show = (id: keyof typeof names) => {
      for (const k of Object.keys(names) as (keyof typeof names)[]) { panes[k].hidden = k !== id; nav.querySelector(`[data-tab="${k}"]`)?.setAttribute("aria-selected", String(k === id)); }
    };
    for (const k of Object.keys(names) as (keyof typeof names)[]) {
      panes[k] = Object.assign(document.createElement("div"), { className: "gc-pane", role: "tabpanel" });
      nav.append(Object.assign(document.createElement("button"), { type: "button", className: "gc-tab", role: "tab", textContent: names[k] }));
      nav.lastElementChild!.setAttribute("data-tab", k);
      nav.lastElementChild!.addEventListener("click", () => show(k));
    }
    card.append(nav, panes.controls, panes.audio, panes.account);
    show("controls");
    into = panes.controls;
  }

  if (o.keys?.length) {
    const dl = document.createElement("dl");
    dl.className = "gc-keys";
    for (const [k, v] of o.keys) dl.append(Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v }));
    into.append(dl);
  }

  const syncs: (() => void)[] = [];
  const resets: (() => void)[] = [];
  /** The first button newly down on the pad since the last look, if any; the dialog keeps its own memory so the game's polling doesn't eat the edge. */
  let seen = new Set<number>();
  const pollRaw = (): number | undefined => {
    const now = o.pad?.down() ?? [];
    const fresh = now.find((b) => !seen.has(b));
    seen = new Set(now);
    return fresh;
  };
  let listening: string | null = null;
  const note = Object.assign(document.createElement("p"), { className: "gc-note", hidden: true });
  const undoBtn = Object.assign(document.createElement("button"), { type: "button", title: "Undo the last key change", ariaLabel: "Undo the last key change", className: "gc-icon" });
  undoBtn.append(createElement(Undo2, { width: 18, height: 18 }));
  const say = (t: string) => { note.textContent = t; note.hidden = !t; };
  const bind = o.bindings;
  const saveKeys = () => { try { localStorage.setItem(`${o.key}.keys`, JSON.stringify(bind?.toJSON() ?? {})); } catch {} };
  if (bind) {
    const list = document.createElement("div");
    list.className = "gc-binds";
    const cells: (() => void)[] = [];
    const changed = () => { cells.forEach((f) => f()); undoBtn.disabled = !bind.canUndo(); o.onChange?.({ ...s }); };
    for (const a of bind.actions) {
      const name = Object.assign(document.createElement("span"), { textContent: a.label });
      const cap = Object.assign(document.createElement("button"), { type: "button", className: "gc-key", name: `bind-${a.id}` });
      const def = Object.assign(document.createElement("button"), { type: "button", className: "gc-icon", title: `${a.label}: back to ${a.keys.map(keyName).join(" / ")}`, ariaLabel: `${a.label}: back to default` });
      def.append(createElement(RotateCcw, { width: 16, height: 16 }));
      const paint = () => {
        cap.textContent = listening === a.id ? "Press a key..." : bind.get(a.id).map(keyName).join(" / ");
        cap.classList.toggle("on", listening === a.id);
        def.disabled = bind.isDefault(a.id);
      };
      cap.addEventListener("click", () => { listening = listening === a.id ? null : a.id; say(listening ? `Press the new key for ${a.label}, or Esc to cancel.` : ""); cells.forEach((f) => f()); });
      def.addEventListener("click", () => {
        const r = bind.resetOne(a.id);
        say(r.ok ? "" : `${keyName(a.keys[0])} is ${a.label}'s own key, but ${r.why === "clash" ? r.with : "another action"} uses it now. Move that first.`);
        saveKeys(); changed();
      });
      cells.push(paint);
      list.append(name, cap, def);
    }
    undoBtn.addEventListener("click", () => { if (bind.undo()) { say(""); saveKeys(); } changed(); });
    syncs.push(() => { listening = null; cells.forEach((f) => f()); undoBtn.disabled = !bind.canUndo(); });
    // The next key pressed while a row waits becomes its key.
    keyHook = (e) => {
      if (!listening) return false;
      e.preventDefault();
      if (e.code === "Escape") { listening = null; say(""); changed(); return true; }
      const r = bind.set(listening, e.code);
      if (r.ok) { listening = null; say(""); saveKeys(); }
      else say(r.why === "reserved" ? "Esc can't be a game key." : `${keyName(e.code)} is already ${r.with}. Pick another key, or change ${r.with} first.`);
      changed();
      return true;
    };
    into.append(list, note);
  }
  const padBinds = o.pad?.binds;
  if (padBinds) {
    const list = document.createElement("div");
    list.className = "gc-binds";
    list.append(Object.assign(document.createElement("h3"), { className: "gc-sub", textContent: "Gamepad buttons" }));
    list.lastElementChild!.setAttribute("style", "grid-column:1/-1");
    let waiting: string | null = null, raf = 0;
    const cells: (() => void)[] = [];
    const savePad = () => { try { localStorage.setItem(`${o.key}.pad`, JSON.stringify(padBinds.toJSON())); } catch {} };
    const repaint = () => cells.forEach((f) => f());
    // While a row waits, watch the pad ourselves: the next button down becomes its button.
    const watch = () => {
      raf = 0;
      if (!waiting || dlg.hidden) return;
      const b = pollRaw();
      if (b !== undefined) {
        const r = padBinds.set(waiting, b);
        if (r.ok) { waiting = null; say(""); savePad(); } else say(`${buttonName(b)} is already ${r.with}. Pick another button, or change ${r.with} first.`);
        repaint();
      }
      if (waiting) raf = requestAnimationFrame(watch);
    };
    for (const a of padBinds.actions) {
      const name = Object.assign(document.createElement("span"), { textContent: a.label });
      const cap = Object.assign(document.createElement("button"), { type: "button", className: "gc-key", name: `pad-${a.id}` });
      const def = Object.assign(document.createElement("button"), { type: "button", className: "gc-icon", title: `${a.label}: back to ${buttonName(a.button)}`, ariaLabel: `${a.label}: back to default` });
      def.append(createElement(RotateCcw, { width: 16, height: 16 }));
      cells.push(() => {
        cap.textContent = waiting === a.id ? "Press a button..." : buttonName(padBinds.get(a.id));
        cap.classList.toggle("on", waiting === a.id);
        def.disabled = padBinds.isDefault(a.id);
      });
      cap.addEventListener("click", () => {
        waiting = waiting === a.id ? null : a.id;
        say(waiting ? `Press the new button on the pad for ${a.label}.` : "");
        // Whatever is held right now is not the answer.
        pollRaw();
        repaint();
        if (waiting && !raf) raf = requestAnimationFrame(watch);
      });
      def.addEventListener("click", () => { padBinds.resetOne(a.id); savePad(); repaint(); });
      list.append(name, cap, def);
    }
    syncs.push(() => { waiting = null; repaint(); });
    resets.push(() => { padBinds.resetAll(); savePad(); });
    into.append(list);
    if (!bind) into.append(note);
  }
  const save = () => {
    try { localStorage.setItem(o.key, JSON.stringify(s)); } catch {}
    o.onChange?.({ ...s });
  };
  const row = (label: string, input: HTMLElement, out?: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
    if (out) l.append(out);
    into.append(l);
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
    into = panes.audio;
    slider(o.labels?.music ?? "Music volume", "music");
    check("Music on", "musicOn");
    slider(o.labels?.sfx ?? "Effects volume", "sfx");
    check("Effects on", "sfxOn");
    for (const [id, label] of o.sounds ?? []) piece(id, label);
  }
  into = panes.controls;
  if (o.show?.includes("view")) {
    slider(o.labels?.brightness ?? "Brightness", "brightness");
    slider(o.labels?.zoom ?? "Camera zoom", "zoom");
    slider(o.labels?.tilt ?? "Camera tilt", "tilt");
  }
  const extra = o.extras?.(panes.controls);
  if (extra) syncs.push(extra.sync);
  if (o.tabs && o.account) { const acct = o.account(panes.account); if (acct) syncs.push(acct.sync); }
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "gc-reset", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => { s = { ...DEFAULTS }; bind?.resetAll(); resets.forEach((f) => f()); saveKeys(); say(""); o.onReset?.(); syncs.forEach((f) => f()); save(); });
  if (bind) {
    const bar = document.createElement("div");
    bar.className = "gc-bar";
    bar.append(undoBtn, reset);
    card.append(bar);
  } else card.append(reset);

  const toggle = (open: boolean) => {
    if (dlg.hidden !== open) return;
    dlg.hidden = !open;
    if (open) syncs.forEach((f) => f());
    o.onToggle?.(open);
  };
  btn.addEventListener("click", () => { toggle(dlg.hidden); btn.blur(); });
  close.addEventListener("click", () => toggle(false));
  dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) toggle(false); });
  dlg.addEventListener("keydown", (e) => { e.stopPropagation(); if (keyHook(e)) return; if (e.code === "Escape") toggle(false); });
  dlg.append(card);
  o.parent.append(btn);
  document.body.append(dlg);
  addStyle();
  syncs.forEach((f) => f());
  o.onChange?.({ ...s });
  return { get: () => ({ ...s }), /** Repaint every row, after the game changed the bindings itself (a preset). */ refresh: () => syncs.forEach((f) => f()), open: () => toggle(true), close: () => toggle(false), isOpen: () => !dlg.hidden, destroy: () => { btn.remove(); dlg.remove(); } };
}

function addStyle() {
  if (document.getElementById("gc-style")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "gc-style", textContent: `
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
` }));
}
