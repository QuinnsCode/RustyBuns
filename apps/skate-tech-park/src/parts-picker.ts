// The parts picker: a wrench button opens a panel of swatches for the deck, trucks, wheels and grip, and the
// board on the page is repainted as you choose. The choice is remembered between visits. Priced finishes show a lock
// and their price until bought (see shop.ts).
import { createElement, Lock, Wrench } from "lucide";
import { CATALOG, DEFAULT_PARTS, type Part, type Parts } from "./parts.ts";
import { dollars, fetchOwned, localWallet, priceOf, stripeCheckout, takePending } from "./shop.ts";

/** The feature flag: priced finishes stay locked and faded ("coming soon") until the build sets `VITE_PAYMENTS=1`.
 * Kept here, not in shop.ts, because the Worker bundles shop.ts and has no `import.meta.env`. */
const PAYMENTS_ON = import.meta.env.VITE_PAYMENTS === "1";

const KEY = "skate-tech-park.parts";
const LABELS: Record<Part, string> = { deck: "Deck", trucks: "Trucks", wheels: "Wheels", grip: "Grip tape" };

function saved(): Parts {
  try { return { ...DEFAULT_PARTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT_PARTS; }
}

/** Mounts the button into `.buttons`; `paint` is called now and on every choice. */
export function mountPartsPicker(paint: (p: Parts) => void) {
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
  const swatches = new Map<string, HTMLButtonElement>();
  const show = () => {
    for (const [k, b] of swatches) {
      const [part, id] = k.split(":") as [Part, string];
      b.setAttribute("aria-pressed", String(parts[part] === id));
      const owned = wallet.owns({ part, id });
      b.querySelector("svg")?.toggleAttribute("hidden", owned);
      b.classList.toggle("soon", !owned && !PAYMENTS_ON);
      b.disabled = !owned && !PAYMENTS_ON;
    }
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
      const item = { part, id: c.id }, cents = priceOf(item);
      if (cents) { b.title = PAYMENTS_ON ? `${c.name}, ${dollars(cents)}` : `${c.name}, coming soon`; b.append(createElement(Lock, { width: 12, height: 12 })); }
      b.addEventListener("click", async () => {
        b.blur();
        if (!(await wallet.buy(item, stripeCheckout))) return;
        parts[part] = c.id;
        show();
      });
      swatches.set(`${part}:${c.id}`, b);
      row.append(b);
    }
    panel.append(row);
  }
  document.querySelector(".buttons")!.prepend(button);
  document.body.append(panel);
  show();
  // Back from Stripe, or on another device: take what the server says was paid, and wear what was just bought.
  void fetchOwned().then((owned) => {
    wallet.sync(owned);
    const was = takePending();
    if (was && wallet.owns(was)) parts[was.part] = was.id;
    show();
  });
}
