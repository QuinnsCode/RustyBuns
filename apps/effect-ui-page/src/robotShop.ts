// The robot builder: rows of picture buttons along the bottom of the galaxy (their names are aria-labels), while the
// scene turns your robot to face you (land3d.ts). Each press changes the robot at once; the tick keeps it.
import { type Look, PAINTS, PARTS } from "./galaxy.ts";

type Part = keyof typeof PARTS;
/** Each choice's name and its picture, drawn on a 32 by 32 grid. */
const ART: { [K in Part]: Record<(typeof PARTS)[K][number], [string, string]> } = {
  head: {
    box: ["Box head", '<rect x="7" y="8" width="18" height="16" rx="2"/>'],
    dome: ["Dome head", '<path d="M7 25V16a9 9 0 0 1 18 0v9Z"/>'],
    screen: ["Screen head", '<rect x="4" y="9" width="24" height="15" rx="3"/><rect x="8" y="12" width="16" height="9" rx="1"/>'],
  },
  eyes: {
    two: ["Two eyes", '<circle cx="11" cy="16" r="3.5"/><circle cx="21" cy="16" r="3.5"/>'],
    visor: ["Visor", '<rect x="5" y="13" width="22" height="6" rx="3"/>'],
    one: ["One big eye", '<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3.5"/>'],
  },
  top: {
    antenna: ["Antenna", '<path d="M16 27V11"/><circle cx="16" cy="8" r="3"/>'],
    propeller: ["Propeller", '<path d="M16 27V13M5 10c4-4 7 3 11 3s7-7 11-3"/>'],
    ears: ["Ears", '<path d="M5 24 10 8l5 16M17 24l5-16 5 16"/>'],
  },
  feet: {
    wheels: ["Wheels", '<circle cx="9" cy="20" r="6"/><circle cx="23" cy="20" r="6"/>'],
    legs: ["Legs", '<path d="M11 6v19H6M21 6v19h5"/>'],
    hover: ["Hover", '<path d="M7 9h18L16 18Z"/><path d="M6 23h20M10 28h12"/>'],
  },
};
const PAINT_NAMES = ["Pink", "Teal", "Amber", "Green", "Violet", "White", "Red", "Slate"];
const svg = (d: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${d}</svg>`;

/** The builder, put in `parent`: `change` hears each new look, `done` the tick (and Escape). */
export function robotShop(parent: HTMLElement, from: Look, change: (look: Look) => void, done: () => void) {
  let look = from;
  const shop = document.createElement("div");
  shop.className = "robot-shop";
  shop.setAttribute("role", "dialog");
  shop.setAttribute("aria-label", "Build your robot");
  const marks: (() => void)[] = [];
  const row = () => shop.appendChild(Object.assign(document.createElement("div"), { className: "robot-row" }));
  const button = (into: HTMLElement, name: string, press: () => void) => {
    const b = into.appendChild(document.createElement("button"));
    b.type = "button";
    b.title = name;
    b.setAttribute("aria-label", name);
    b.addEventListener("click", press);
    return b;
  };
  const choice = (into: HTMLElement, name: string, on: () => boolean, next: () => Look) => {
    const b = button(into, name, () => { look = next(); for (const mark of marks) mark(); change(look); });
    marks.push(() => b.setAttribute("aria-pressed", String(on())));
    return b;
  };
  const paints = row();
  paints.classList.add("paints");
  PAINTS.forEach((color, paint) => { choice(paints, `${PAINT_NAMES[paint]} paint`, () => look.paint === paint, () => ({ ...look, paint })).style.background = color; });
  const part = <K extends Part>(k: K) => {
    const into = row();
    for (const v of PARTS[k]) {
      const [name, art] = ART[k][v as (typeof PARTS)[K][number]];
      choice(into, name, () => look[k] === v, () => ({ ...look, [k]: v })).innerHTML = svg(art);
    }
  };
  for (const k of ["head", "eyes", "top", "feet"] as const) part(k);
  const tick = button(shop, "Done", done);
  tick.className = "robot-done";
  tick.innerHTML = svg('<path d="m6 17 7 7 13-15"/>');
  for (const mark of marks) mark();
  parent.append(shop);
  shop.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  return { el: shop, look: () => look, close: () => shop.remove() };
}
export type RobotShop = ReturnType<typeof robotShop>;

/** The picture on the button that opens it. */
export const ROBOT_ICON = svg('<rect x="6" y="11" width="20" height="16" rx="4"/><path d="M16 11V6M2 17v6M30 17v6M12 22h8"/><circle cx="16" cy="5" r="1.5"/><path d="M12 17h.01M20 17h.01"/>');
