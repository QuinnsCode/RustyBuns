// The parts picker: a wrench button opens a panel of swatches for the deck, trucks, wheels and grip, and the
// board on the page is repainted as you choose. The choice is remembered between visits.
import { createElement, Wrench } from "lucide";
import { CATALOG, DEFAULT_PARTS, type Part, type Parts } from "./parts.ts";

const KEY = "skate-tech-park.parts";
const LABELS: Record<Part, string> = { deck: "Deck", trucks: "Trucks", wheels: "Wheels", grip: "Grip tape" };

function saved(): Parts {
  try { return { ...DEFAULT_PARTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT_PARTS; }
}

/** Mounts the button into `.buttons`; `paint` is called now and on every choice. */
export function mountPartsPicker(paint: (p: Parts) => void) {
  const parts = saved();
  const panel = document.createElement("div"), button = document.createElement("button");
  panel.className = "parts";
  panel.hidden = true;
  button.type = "button";
  button.className = "icon-btn";
  button.title = "Parts: deck, trucks, wheels, grip";
  button.setAttribute("aria-label", "Pick parts");
  button.append(createElement(Wrench, { width: 18, height: 18 }));
  button.addEventListener("click", () => { panel.hidden = !panel.hidden; button.blur(); });
  const swatches = new Map<string, HTMLButtonElement>();
  const show = () => {
    for (const [k, b] of swatches) b.setAttribute("aria-pressed", String(parts[k.split(":")[0] as Part] === k.split(":")[1]));
    paint(parts);
    try { localStorage.setItem(KEY, JSON.stringify(parts)); } catch { /* private window: it just isn't remembered */ }
  };
  for (const part of Object.keys(CATALOG) as Part[]) {
    const row = document.createElement("div"), label = document.createElement("span");
    row.className = "parts-row";
    label.textContent = LABELS[part];
    row.append(label);
    for (const c of CATALOG[part] as readonly { id: string; name: string; color: number }[]) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = c.name;
      b.setAttribute("aria-label", `${LABELS[part]}: ${c.name}`);
      b.style.background = `#${c.color.toString(16).padStart(6, "0")}`;
      b.addEventListener("click", () => { parts[part] = c.id; show(); b.blur(); });
      swatches.set(`${part}:${c.id}`, b);
      row.append(b);
    }
    panel.append(row);
  }
  document.querySelector(".buttons")!.prepend(button);
  document.body.append(panel);
  show();
}
