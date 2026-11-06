// Headless: this file builds the DOM and the behaviour; every colour lives in skins.ts (or in the game).
// A cog button that opens a Controls dialog. Rows sit in foldable sections (keyboard, X axis, Y axis, mouse, touch,
// gamepad, vision, audio...) with collapse-all and expand-all at the top and bottom, and four saved profiles
// ("controller personalities") swap everything at once. A row the game doesn't have is shown greyed out
// (schema.ts lists them all; `enable` turns one on). Changes apply at once and are saved under `key`. The dialog is a bottom sheet on a narrow screen, a card on a
// wide one, and scrolls when the screen is short.
import { createElement, RotateCcw, Settings as Cog, Undo2, X } from "lucide";
import { ICONS, type IconName } from "./icons.ts";
import { type Extra, EXTRAS, section } from "./schema.ts";
import { type Book, type Profile, SLOTS, parseBook, remember, switchTo } from "./profiles.ts";
import { type Action, type BindingSet, createBindings, keyName } from "./bindings.ts";
import { type Pad, buttonName } from "./gamepad.ts";
import { type Skin, type Theme, applyTheme, installStyles } from "./skins.ts";
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
  /** Optional rows (ids from `SECTIONS` in schema.ts, e.g. "fov", "rumble") this game honours; the rest show greyed out. */
  enable?: string[];
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
  /**
   * The look. "classic" (the default, dark card) keeps what the games had; "house" is the soft, bold kit look;
   * "none" injects no CSS at all, so the game styles the `gc-*` classes itself.
   */
  skin?: Skin;
  /** Design tokens (`--ui-*`, see `TOKENS`) set on the cog and the dialog, to re-theme a skin without a fork. */
  theme?: Theme;
  /** Extra CSS appended after the skin, for a game's own touches. */
  css?: string;
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
  const icon = (n: IconName, size = 16) => createElement(ICONS[n], { width: size, height: size });

  // Foldable sections. A section with no live row (everything greyed out) starts folded; what the player folds is remembered.
  interface Sec { id: string; el: HTMLElement; head: HTMLButtonElement; live: number }
  const secs: Sec[] = [];
  let cur: Sec | undefined;
  const foldKey = `${o.key}.fold`;
  const shut = (sc: Sec) => sc.el.classList.contains("shut");
  const fold = (sc: Sec, on: boolean) => { sc.el.classList.toggle("shut", !on); sc.head.setAttribute("aria-expanded", String(on)); };
  const saveFold = () => { try { localStorage.setItem(foldKey, JSON.stringify(secs.filter(shut).map((x) => x.id))); } catch {} };
  const foldAll = (on: boolean) => { secs.forEach((x) => fold(x, on)); saveFold(); };
  const foldBar = () => {
    const bar = Object.assign(document.createElement("div"), { className: "gc-fold" });
    for (const [on, ic, tip] of [[false, "ChevronsDownUp", "Collapse all sections"], [true, "ChevronsUpDown", "Expand all sections"]] as const) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "gc-icon", title: tip, ariaLabel: tip });
      b.setAttribute("data-fold", on ? "expand" : "collapse");
      b.append(icon(ic, 18));
      b.addEventListener("click", () => foldAll(on));
      bar.append(b);
    }
    return bar;
  };
  /** Start a section (by its id in schema.ts) in its tab; rows added next go inside it. */
  const begin = (id: string, title?: string, ic?: IconName): HTMLElement => {
    const def = section(id);
    const el = Object.assign(document.createElement("section"), { className: "gc-sec" });
    el.setAttribute("data-sec", id);
    const head = Object.assign(document.createElement("button"), { type: "button", className: "gc-sec-h" });
    head.append(icon(ic ?? def.icon, 18), Object.assign(document.createElement("span"), { textContent: title ?? def.title }), Object.assign(document.createElement("span"), { className: "gc-chev" }));
    head.lastElementChild!.append(icon("ChevronDown", 16));
    const body = Object.assign(document.createElement("div"), { className: "gc-sec-b" });
    el.append(head, body);
    const sc: Sec = { id, el, head, live: 0 };
    head.addEventListener("click", () => { fold(sc, shut(sc)); saveFold(); });
    secs.push(sc);
    cur = sc;
    panes[def.tab].append(el);
    return (into = body);
  };

  // Four profiles. The active slot always mirrors what the player has; picking another loads it.
  const bookKey = `${o.key}.profiles`;
  let book: Book = (() => { try { return parseBook(JSON.parse(localStorage.getItem(bookKey) ?? "null")); } catch { return parseBook(null); } })();
  const snapshot = (): Profile => ({ settings: { ...s }, keys: o.bindings?.toJSON() ?? {}, pad: o.pad?.binds.toJSON() ?? {} });
  const persist = () => { book = remember(book, snapshot()); try { localStorage.setItem(bookKey, JSON.stringify(book)); } catch {} };
  const profBar = Object.assign(document.createElement("div"), { className: "gc-profiles", role: "group", ariaLabel: "Profiles" });
  const profBtns = (["Gamepad2", "Keyboard", "Mouse", "Smartphone"] as const).map((ic, i) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "gc-tab gc-prof", name: `profile-${i + 1}`, title: `Profile ${i + 1}`, ariaLabel: `Profile ${i + 1}` });
    b.append(icon(ic, 18), String(i + 1));
    b.addEventListener("click", () => pick(i));
    profBar.append(b);
    return b;
  });
  const paintProfiles = () => profBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === book.active)));
  const pick = (i: number) => {
    if (i === book.active || i >= SLOTS) return;
    const r = switchTo(book, snapshot(), i);
    book = r.book;
    s = parseSettings(r.load.settings);
    o.bindings?.apply(r.load.keys);
    o.pad?.binds.apply(r.load.pad);
    saveKeys(); savePad(); say("");
    syncs.forEach((f) => f());
    save();
    paintProfiles();
  };
  card.append(profBar);
  if (!o.tabs) card.append(foldBar());
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
    card.append(nav, foldBar(), panes.controls, panes.audio, panes.account);
    show("controls");
    into = panes.controls;
  }

  begin("keys");
  if (o.keys?.length) {
    cur!.live++;
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
  /** A heading across the whole binding grid: a group of actions ("Fighting"), or the gamepad's block. */
  const subHead = (text: string) => {
    const h = Object.assign(document.createElement("h3"), { className: "gc-sub", textContent: text });
    h.setAttribute("style", "grid-column:1/-1");
    return h;
  };
  const saveKeys = () => { try { localStorage.setItem(`${o.key}.keys`, JSON.stringify(bind?.toJSON() ?? {})); } catch {} persist(); };
  const padBinds = o.pad?.binds;
  const savePad = () => { if (padBinds) { try { localStorage.setItem(`${o.key}.pad`, JSON.stringify(padBinds.toJSON())); } catch {} persist(); } };
  if (bind) {
    cur!.live++;
    const list = document.createElement("div");
    list.className = "gc-binds";
    const cells: (() => void)[] = [];
    const changed = () => { cells.forEach((f) => f()); undoBtn.disabled = !bind.canUndo(); o.onChange?.({ ...s }); };
    let group: string | undefined;
    for (const a of bind.actions) {
      if (a.group && a.group !== group) list.append(subHead(a.group));
      group = a.group;
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
  const buildPad = () => {
    if (!padBinds) return;
    cur!.live++;
    const list = document.createElement("div");
    list.className = "gc-binds";
    list.append(subHead("Gamepad buttons"));
    let waiting: string | null = null, raf = 0;
    const cells: (() => void)[] = [];
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
    let group: string | undefined;
    for (const a of padBinds.actions) {
      if (a.group && a.group !== group) list.append(subHead(a.group));
      group = a.group;
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
  };
  const save = () => {
    try { localStorage.setItem(o.key, JSON.stringify(s)); } catch {}
    persist();
    o.onChange?.({ ...s });
  };
  /** One row: [icon] label, the input, then its read-out. Greyed out and inert when the game doesn't have it. */
  const row = (label: string, input: HTMLInputElement, ic: IconName, off: boolean, out?: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { className: "gc-lab" }), input);
    l.firstElementChild!.append(icon(ic, 16), label);
    if (out) l.append(out);
    input.disabled = off;
    if (off) { l.classList.add("gc-off"); l.title = "Not in this game yet"; } else cur!.live++;
    into.append(l);
  };
  const text = (r: { min: number; unit: "x" | "%" | "deg" }, v: number) => (r.unit === "%" ? `${Math.round(v * 100)}%` : r.unit === "deg" ? `${v > 0 && r.min < 0 ? "+" : ""}${Math.round(v * 10) / 10}\u00b0` : `${v.toFixed(2)}x`);
  const slide = (label: string, name: string, r: { min: number; max: number; step: number; unit: "x" | "%" | "deg" }, ic: IconName, off: boolean, get: () => number, put: (v: number) => void) => {
    const i = Object.assign(document.createElement("input"), { type: "range", name, min: String(r.min), max: String(r.max), step: String(r.step) });
    const out = document.createElement("output");
    i.addEventListener("input", () => { put(Number(i.value)); out.textContent = text(r, get()); save(); });
    syncs.push(() => { i.value = String(get()); out.textContent = text(r, get()); });
    row(label, i, ic, off, out);
  };
  const flag = (label: string, name: string, ic: IconName, off: boolean, get: () => boolean, put: (v: boolean) => void) => {
    const c = Object.assign(document.createElement("input"), { type: "checkbox", name });
    c.addEventListener("change", () => { put(c.checked); save(); });
    syncs.push(() => { c.checked = get(); });
    row(label, c, ic, off);
  };
  const slider = (label: string, k: NumKey, ic: IconName, off = false) => {
    if (o.hide?.includes(k)) return;
    slide(label, k, RANGES[k], ic, off, () => s[k], (v) => { s = { ...s, [k]: v }; });
  };
  const check = (label: string, k: "musicOn" | "sfxOn" | "invertY", ic: IconName, off = false) => {
    if (o.hide?.includes(k)) return;
    flag(label, k, ic, off, () => s[k], (v) => { s = { ...s, [k]: v }; });
  };
  const piece = (id: string, label: string) => flag(label, `sound-${id}`, "Volume2", false, () => !s.muted.includes(id), (on) => { s = { ...s, muted: on ? s.muted.filter((m) => m !== id) : [...s.muted.filter((m) => m !== id), id] }; });
  /** The section's optional rows: live when the game enabled them, greyed out otherwise. */
  const more = (id: string) => {
    for (const x of section(id).rows as Extra[]) {
      const off = !o.enable?.includes(x.id);
      if (x.kind === "slider") slide(x.label, `more-${x.id}`, x, x.icon, off, () => Number(s.more[x.id] ?? x.def), (v) => { s = { ...s, more: { ...s.more, [x.id]: v } }; });
      else flag(x.label, `more-${x.id}`, x.icon, off, () => Boolean(s.more[x.id] ?? x.def), (v) => { s = { ...s, more: { ...s.more, [x.id]: v } }; });
    }
  };
  const view = !!o.show?.includes("view"), audio = !!o.show?.includes("audio"), axes = !!o.show?.includes("touchAxes");
  more("keys");
  begin("lookX");
  slider(o.labels?.lookX ?? "Look X sensitivity", "lookX", "MoveHorizontal");
  begin("lookY");
  slider(o.labels?.lookY ?? "Look Y sensitivity", "lookY", "MoveVertical");
  check("Invert Y", "invertY", "MoveVertical");
  begin("mouse");
  more("mouse");
  begin("touch");
  slider(o.labels?.touch ?? "Touch sensitivity", "touch", "Smartphone");
  slider(o.labels?.touchX ?? "Touch X sensitivity", "touchX", "MoveHorizontal", !axes);
  slider(o.labels?.touchY ?? "Touch Y sensitivity", "touchY", "MoveVertical", !axes);
  more("touch");
  begin("gamepad");
  buildPad();
  more("gamepad");
  begin("vision");
  slider(o.labels?.brightness ?? "Brightness", "brightness", "Sun", !view);
  slider(o.labels?.zoom ?? "Camera zoom", "zoom", "Camera", !view);
  slider(o.labels?.tilt ?? "Camera tilt", "tilt", "Camera", !view);
  more("vision");
  if (o.extras) {
    const body = begin("game");
    cur!.live++;
    const extra = o.extras(body);
    if (extra) syncs.push(extra.sync);
  }
  begin("music");
  slider(o.labels?.music ?? "Music volume", "music", "Music", !audio);
  check("Music on", "musicOn", "Music", !audio);
  begin("fx");
  slider(o.labels?.sfx ?? "Effects volume", "sfx", "Volume2", !audio);
  check("Effects on", "sfxOn", "Volume2", !audio);
  begin("mix");
  if (audio) for (const [id, label] of o.sounds ?? []) piece(id, label);
  more("mix");
  // Folded: what the player left folded, else every section with nothing live in it.
  let folded: string[] | null = null;
  try { const v: unknown = JSON.parse(localStorage.getItem(foldKey) ?? "null"); if (Array.isArray(v)) folded = v.filter((x): x is string => typeof x === "string"); } catch {}
  // Sections that came out empty (nothing to show at all) don't get a header.
  for (const sc of [...secs]) if (!sc.el.querySelector(".gc-sec-b")!.childElementCount) { sc.el.remove(); secs.splice(secs.indexOf(sc), 1); }
  for (const sc of secs) fold(sc, folded ? !folded.includes(sc.id) : sc.live > 0);
  if (o.tabs && o.account) { const acct = o.account(panes.account); if (acct) syncs.push(acct.sync); }
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "gc-reset", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => { s = { ...DEFAULTS }; bind?.resetAll(); resets.forEach((f) => f()); saveKeys(); say(""); o.onReset?.(); syncs.forEach((f) => f()); save(); });
  card.append(foldBar());
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
  installStyles(o.skin ?? "classic", o.css);
  applyTheme(o.theme, btn, dlg);
  if (o.skin === "house") { btn.classList.add("ui-house"); dlg.classList.add("ui-house"); }
  syncs.forEach((f) => f());
  paintProfiles();
  o.onChange?.({ ...s });
  return { get: () => ({ ...s }), /** Repaint every row, after the game changed the bindings itself (a preset). */ refresh: () => syncs.forEach((f) => f()), open: () => toggle(true), close: () => toggle(false), isOpen: () => !dlg.hidden, destroy: () => { btn.remove(); dlg.remove(); } };
}
