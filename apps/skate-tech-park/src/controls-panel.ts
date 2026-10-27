// The Controls panel: a gear in the top bar opens a small sheet of every setting in controls.ts plus the flick layout.
// Each change applies at once and is saved; Reset puts the defaults back.
import { createElement, Settings } from "lucide";
import { type Controls, DEFAULT_CONTROLS } from "./controls.ts";
import type { Profile } from "./flick.ts";

type Opts = { controls: Controls; profiles: Profile[]; layout: () => string; onChange: (c: Controls) => void; onLayout: (name: string) => void };

export function mountControlsPanel(parent: HTMLElement, o: Opts) {
  const c = { ...o.controls };
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn", title: "Controls", ariaLabel: "Controls" });
  btn.append(createElement(Settings, { width: 18, height: 18 }));
  const panel = Object.assign(document.createElement("div"), { className: "controls", hidden: true, role: "dialog", ariaLabel: "Controls" });
  const syncs: (() => void)[] = [];
  const row = (label: string, input: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
    panel.append(l);
  };
  const change = () => { o.onChange({ ...c }); };
  const check = (label: string, key: "invertX" | "invertY" | "swap") => {
    const i = Object.assign(document.createElement("input"), { type: "checkbox" });
    i.addEventListener("change", () => { c[key] = i.checked; change(); });
    syncs.push(() => { i.checked = c[key]; });
    row(label, i);
  };
  const range = (label: string, key: "size" | "opacity" | "dead" | "sens", min: number, max: number, step: number) => {
    const i = Object.assign(document.createElement("input"), { type: "range", min: String(min), max: String(max), step: String(step) });
    i.addEventListener("input", () => { c[key] = Number(i.value); change(); });
    syncs.push(() => { i.value = String(c[key]); });
    row(label, i);
  };
  const layout = document.createElement("select");
  for (const p of o.profiles) layout.add(new Option(p.name, p.name));
  layout.addEventListener("change", () => o.onLayout(layout.value));
  syncs.push(() => { layout.value = o.layout(); });
  const labels = document.createElement("select");
  for (const [v, t] of [["first", "first few seconds"], ["always", "always"], ["never", "never"]] as const) labels.add(new Option(t, v));
  labels.addEventListener("change", () => { c.labels = labels.value as Controls["labels"]; change(); });
  syncs.push(() => { labels.value = c.labels; });

  row("Flick layout", layout);
  check("Left-handed (swap sides)", "swap");
  check("Invert stick left/right", "invertX");
  check("Invert stick up/down", "invertY");
  range("Pad size", "size", 0.6, 1.5, 0.05);
  range("Controls opacity", "opacity", 0.15, 1, 0.05);
  range("Stick dead zone", "dead", 0.04, 0.45, 0.01);
  range("Flick sensitivity", "sens", 0.5, 2, 0.05);
  row("Trick labels", labels);
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "controls-reset", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => { Object.assign(c, DEFAULT_CONTROLS); syncs.forEach((f) => f()); change(); });
  panel.append(reset);

  btn.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) syncs.forEach((f) => f()); btn.blur(); });
  parent.append(btn);
  document.body.append(panel);
  return { sync: () => syncs.forEach((f) => f()) };
}
