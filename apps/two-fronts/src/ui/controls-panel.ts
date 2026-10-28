// The Controls cog is the shared one (@rustybuns/game-controls: look speeds, invert Y, saved). This adds the rows only this
// game has: invert left/right, field of view, click-to-fire, left-handed touch and rebinding. Click a key row, then press the key.
import { mountControls } from "@rustybuns/game-controls";
import { ACTIONS, type Action, keyName, onSettings, rebind, resetSettings, setLook, setSettings, settings, type Settings } from "../settings.ts";

type Flag = "invertX" | "fireToggle" | "leftHanded";
type Level = "fov";

/** Once: carry an older save's mouse and touch speeds and invert Y over to the shared cog's key. */
function migrate() {
  try {
    if (localStorage.getItem(KEY) !== null) return;
    const old: unknown = JSON.parse(localStorage.getItem("two-fronts-controls") ?? "null");
    if (typeof old !== "object" || old === null) return;
    const o = Object.fromEntries(Object.entries(old));
    const n = (v: unknown) => (typeof v === "number" ? v : 1);
    localStorage.setItem(KEY, JSON.stringify({ lookX: n(o.mouse), lookY: n(o.mouse), touch: n(o.touch), invertY: o.invertY === true }));
  } catch { /* no storage: the defaults */ }
}
const KEY = "two-fronts.controls";

export function mountControlsPanel() {
  migrate();
  const host = Object.assign(document.createElement("div"), { id: "controls-host" });
  document.body.append(host);
  mountControls({
    key: KEY, parent: host,
    keys: [["Mouse", "Look (click the field first)"], ["Click", "Fire"], ["1 to 4, F", "Squad orders"], ["Esc", "Let go of the mouse"]],
    onChange: setLook,
    onToggle: (open) => { if (open && document.pointerLockElement) document.exitPointerLock(); },
    extras,
    onReset: () => { stop(); resetSettings(); },
  });
  onSettings(() => { document.body.classList.toggle("lefty", settings.leftHanded); });
}

let stop = () => {};
function extras(panel: HTMLElement) {
  const syncs: (() => void)[] = [];
  const row = (label: string, input: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
    panel.append(l);
  };
  const check = (label: string, key: Flag) => {
    const i = Object.assign(document.createElement("input"), { type: "checkbox", name: key });
    i.addEventListener("change", () => setSettings({ [key]: i.checked }));
    syncs.push(() => { i.checked = settings[key]; });
    row(label, i);
  };
  const range = (label: string, key: Level, min: number, max: number, step: number) => {
    const i = Object.assign(document.createElement("input"), { type: "range", name: key, min: String(min), max: String(max), step: String(step) });
    i.addEventListener("input", () => setSettings({ [key]: Number(i.value) } as Partial<Settings>));
    syncs.push(() => { i.value = String(settings[key]); });
    row(label, i);
  };
  const note = Object.assign(document.createElement("p"), { className: "controls-note" });

  check("Invert look left/right", "invertX");
  range("Field of view", "fov", 50, 100, 1);
  check("Click to start and stop firing", "fireToggle");
  check("Left-handed (touch)", "leftHanded");

  let waiting: Action | null = null;
  const keyBtns = new Map<Action, HTMLButtonElement>();
  const paintKeys = () => { for (const a of ACTIONS) keyBtns.get(a.id)!.textContent = waiting === a.id ? "press a key…" : keyName(settings.keys[a.id]); };
  stop = () => { waiting = null; paintKeys(); };
  for (const a of ACTIONS) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "keycap", name: a.id });
    b.addEventListener("click", () => { waiting = waiting === a.id ? null : a.id; note.textContent = ""; paintKeys(); });
    keyBtns.set(a.id, b);
    row(a.label, b);
  }
  panel.append(note);
  // While a row waits for a key, the key goes to it and nowhere else (not to the battle underneath).
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!waiting) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") return stop();
    const bad = rebind(waiting, e.key);
    note.textContent = !bad ? "" : "clash" in bad ? `${keyName(e.key)} already does "${ACTIONS.find((a) => a.id === bad.clash)!.label}"` : `${keyName(e.key)} is kept for the game`;
    if (!bad) stop();
  }, true);

  onSettings(() => { syncs.forEach((f) => f()); paintKeys(); });
}
