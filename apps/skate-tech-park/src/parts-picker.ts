// The parts picker: a wrench button opens a panel of swatches for the deck, trucks, wheels and grip, and the
// board on the page is repainted as you choose. The choice is remembered between visits. Priced finishes show a lock
// and their price until bought (see shop.ts).
import { createElement, ImagePlus, Lock, Wrench } from "lucide";
import { CATALOG, DEFAULT_PARTS, type Part, type Parts } from "./parts.ts";
import { loadGraphic, saveGraphic, savedGraphic } from "./graphic.ts";
import { dollars, localWallet, priceOf, testCheckout } from "./shop.ts";

const KEY = "skate-tech-park.parts";
const LABELS: Record<Part, string> = { deck: "Deck", trucks: "Trucks", wheels: "Wheels", grip: "Grip tape" };

function saved(): Parts {
  try { return { ...DEFAULT_PARTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT_PARTS; }
}

/** Mounts the button into `.buttons`; `paint` is called now and on every choice. */
export function mountPartsPicker(paint: (p: Parts) => void, graphic: (source: TexImageSource | null) => void = () => {}) {
  const wallet = localWallet();
  const parts = wallet.allowed(saved());
  const panel = document.createElement("div"), button = document.createElement("button");
  panel.className = "parts";
  panel.hidden = true;
  button.type = "button";
  button.className = "icon-btn";
  button.title = "Parts: deck, trucks, wheels, grip";
  button.setAttribute("aria-label", "Pick parts");
  button.append(createElement(Wrench, { width: 18, height: 18 }));
  button.addEventListener("click", () => { panel.hidden = !panel.hidden; button.blur(); });
  const upload = document.createElement("label"), file = document.createElement("input");
  upload.className = "upload";
  upload.title = "Upload an image for the underside of your deck";
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  upload.append(createElement(ImagePlus, { width: 16, height: 16 }), file);
  file.addEventListener("change", async () => {
    const c = file.files?.[0] && (await loadGraphic(file.files[0]));
    file.value = "";
    if (c) { saveGraphic(c); graphic(c); }
  });
  const swatches = new Map<string, HTMLButtonElement>();
  const show = () => {
    for (const [k, b] of swatches) {
      const [part, id] = k.split(":") as [Part, string];
      b.setAttribute("aria-pressed", String(parts[part] === id));
      b.querySelector("svg")?.toggleAttribute("hidden", wallet.owns({ part, id }));
    }
    paint(parts);
    upload.hidden = parts.deck !== "custom";
    if (parts.deck !== "custom") graphic(null); else void savedGraphic().then(graphic);
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
      const item = { part, id: c.id }, cents = priceOf(item);
      if (cents) { b.title = `${c.name}, ${dollars(cents)}`; b.append(createElement(Lock, { width: 12, height: 12 })); }
      b.addEventListener("click", async () => {
        b.blur();
        if (!(await wallet.buy(item, testCheckout))) return;
        parts[part] = c.id;
        show();
      });
      swatches.set(`${part}:${c.id}`, b);
      row.append(b);
    }
    panel.append(row);
  }
  panel.append(upload);
  document.querySelector(".buttons")!.prepend(button);
  document.body.append(panel);
  show();
}
