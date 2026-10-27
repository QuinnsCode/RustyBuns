// The Controls panel: a gear in the corner of every screen opens a sheet of everything in settings.ts. Each change
// applies at once and is saved; Reset puts the defaults back. Click a key row, then press the key you want.
import { ACTIONS, type Action, keyName, onSettings, rebind, resetSettings, setSettings, settings, type Settings } from "../settings.ts";
import { icon } from "./icons.ts";

type Flag = "invertX" | "invertY" | "fireToggle" | "leftHanded";
type Level = "mouse" | "touch" | "fov";

export function mountControlsPanel() {
  const btn = Object.assign(document.createElement("button"), { type: "button", id: "controls-btn", title: "Controls", ariaLabel: "Controls" });
  btn.innerHTML = icon("settings", 18);
  const panel = Object.assign(document.createElement("div"), { id: "controls", hidden: true, role: "dialog", ariaLabel: "Controls" });
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

  check("Invert look up/down", "invertY");
  check("Invert look left/right", "invertX");
  range("Mouse sensitivity", "mouse", 0.2, 3, 0.05);
  range("Touch look sensitivity", "touch", 0.2, 3, 0.05);
  range("Field of view", "fov", 50, 100, 1);
  check("Click to start and stop firing", "fireToggle");
  check("Left-handed (touch)", "leftHanded");

  let waiting: Action | null = null;
  const keyBtns = new Map<Action, HTMLButtonElement>();
  const paintKeys = () => { for (const a of ACTIONS) keyBtns.get(a.id)!.textContent = waiting === a.id ? "press a key…" : keyName(settings.keys[a.id]); };
  const stop = () => { waiting = null; paintKeys(); };
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

  const reset = Object.assign(document.createElement("button"), { type: "button", id: "controls-reset", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => { stop(); note.textContent = ""; resetSettings(); });
  panel.append(reset);

  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && document.pointerLockElement) document.exitPointerLock();
    stop(); btn.blur();
  });
  document.body.append(btn, panel);
  onSettings(() => { syncs.forEach((f) => f()); paintKeys(); document.body.classList.toggle("lefty", settings.leftHanded); });
}
