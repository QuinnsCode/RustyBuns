// The rows this game adds to the shared Controls cog: every setting in controls.ts plus the flick layout.
// Each change applies at once; the cog's Reset puts the defaults back.
import { type Controls, DEFAULT_CONTROLS } from "./controls.ts";
import type { Profile } from "./flick.ts";

type Opts = { controls: () => Controls; profiles: Profile[]; layout: () => string; onChange: (c: Controls) => void; onLayout: (name: string) => void };

export function controlsExtras(card: HTMLElement, o: Opts) {
  const c = { ...o.controls() };
  const syncs: (() => void)[] = [];
  const row = (label: string, input: HTMLElement) => {
    const l = document.createElement("label");
    l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
    card.append(l);
  };
  const change = () => { o.onChange({ ...c }); };
  const check = (label: string, key: "invertX" | "swap") => {
    const i = Object.assign(document.createElement("input"), { type: "checkbox" });
    i.addEventListener("change", () => { c[key] = i.checked; change(); });
    syncs.push(() => { i.checked = c[key]; });
    row(label, i);
  };
  const range = (label: string, key: "size" | "opacity" | "dead", min: number, max: number, step: number) => {
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
  range("Pad size", "size", 0.6, 1.5, 0.05);
  range("Controls opacity", "opacity", 0.15, 1, 0.05);
  range("Stick dead zone", "dead", 0.04, 0.45, 0.01);
  row("Trick labels", labels);
  return {
    sync: () => { Object.assign(c, o.controls()); syncs.forEach((f) => f()); },
    reset: () => { Object.assign(c, DEFAULT_CONTROLS); change(); },
  };
}
