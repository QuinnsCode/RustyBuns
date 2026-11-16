// The dial on the page: three stops in the menu (Cozy, Crew, Sim), remembered in this browser, and the clock to doors
// in the HUD (fixed width, counting down, red once doors have passed; an "i" tip says what being late costs).
import { DIALS, DIAL_NAMES, type Dial, currentDial, setDial } from "./assists.ts";
import { MOOD_PER_MIN, PAY_PER_MIN, clockText, doors } from "./clock.ts";

const KEY = "load-in.dial";
const TIPS: Record<Dial, string> = {
  cozy: "No clock, gear weighs half, cables coil themselves, ramps snap, jacks glow",
  crew: "A clock with two minutes' grace, gear at three quarters, ramps snap, jacks glow",
  sim: "Real weights, doors on time, breakers trip, a short cable is short",
};

/** The stop saved in this browser, if any (storage can be missing or blocked). */
export function savedDial(): Dial {
  try { return setDial(localStorage.getItem(KEY)); } catch { return currentDial(); }
}

/** Three buttons that turn the dial; `onChange` after each turn. */
export function mountDial(parent: HTMLElement, onChange: (d: Dial) => void = () => {}) {
  const box = document.createElement("div");
  box.className = "dial";
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", "Cozy to sim");
  const paint = () => { for (const b of box.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.dial === currentDial())); };
  for (const d of DIALS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.dial = d;
    b.textContent = DIAL_NAMES[d];
    b.title = TIPS[d];
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => {
      setDial(d);
      try { localStorage.setItem(KEY, d); } catch { /* the dial still turns for this visit */ }
      paint();
      onChange(d);
    });
    box.appendChild(b);
  }
  paint();
  parent.appendChild(box);
}

/** The clock in the HUD; `update(level, t)` each frame. Hidden when the stop runs no clock. */
export function mountClock(parent: HTMLElement) {
  const el = document.createElement("p");
  el.id = "clock";
  el.className = "clock";
  const tip = `Doors open when this reaches 0:00. Each minute late costs ${PAY_PER_MIN * 100}% of the pay and ${MOOD_PER_MIN} points of crowd mood.`;
  el.innerHTML = `<span class="time"></span><span class="tip" title="${tip}" aria-label="${tip}">i</span>`;
  parent.appendChild(el);
  const time = el.querySelector<HTMLElement>(".time")!;
  return {
    update(level: string, t: number) {
      const d = doors(level, t);
      el.hidden = d.left === null;
      if (d.left === null) return d;
      time.textContent = `Doors ${clockText(d.left)}`;
      el.classList.toggle("late", d.left < 0);
      return d;
    },
  };
}
