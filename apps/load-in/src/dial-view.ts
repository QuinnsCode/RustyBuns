// The dial on the page: three stops in the menu (Cozy, Crew, Sim), remembered in this browser, and the clock to doors
// in the HUD (fixed width, counting down, red once doors have passed; an "i" tip says what being late costs), and the
// jack glow (the jackGlow assist) while you hold a cable end.
import * as THREE from "three";
import { DIALS, DIAL_NAMES, type Dial, currentDial, setDial } from "./assists.ts";
import { MOOD_PER_MIN, PAY_PER_MIN, clockText, curfew, doors } from "./clock.ts";

const KEY = "load-in.dial";
const TIPS: Record<Dial, string> = {
  cozy: "No clock, gear weighs half, cables coil themselves, ramps snap, jacks glow",
  crew: "A clock with two minutes' grace, gear at three quarters, ramps snap, jacks glow",
  sim: "Real weights, doors on time, breakers trip, a short cable is short",
};

/** The stop saved in this browser, or Crew for a new player (storage can be missing or blocked). */
export function savedDial(): Dial {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* no storage: the default stop */ }
  return setDial(saved ?? "crew");
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
  const time = el.querySelector<HTMLElement>(".time")!, info = el.querySelector<HTMLElement>(".tip")!;
  const tips = { doors: tip, curfew: "Out with the truck shut when this reaches 0:00, or the venue fines you for each minute past curfew." };
  return {
    /** `since`: seconds into the load-out, once it has started; the clock counts to curfew then. */
    update(level: string, t: number, since: number | null = null) {
      if (since !== null) {
        const c = curfew(level, since);
        el.hidden = c.left === null;
        if (c.left === null) return;
        time.textContent = `Curfew ${clockText(c.left)}`;
        info.title = tips.curfew; info.ariaLabel = tips.curfew;
        el.classList.toggle("late", c.left < 0);
        return;
      }
      info.title = tips.doors; info.ariaLabel = tips.doors;
      const d = doors(level, t);
      el.hidden = d.left === null;
      if (d.left === null) return d;
      time.textContent = `Doors ${clockText(d.left)}`;
      el.classList.toggle("late", d.left < 0);
      return d;
    },
  };
}

/** The jackGlow assist on the page: a soft light on each free jack that would take the cable in your hand. */
export function mountGlow(scene: THREE.Scene, most = 64) {
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x6fdc8c, transparent: true, opacity: 0.85, depthTest: false }), most);
  dots.renderOrder = 2;
  dots.count = 0;
  scene.add(dots);
  const m = new THREE.Matrix4();
  return {
    update(points: readonly { x: number; y: number; z: number }[], t: number) {
      const s = 1 + 0.25 * Math.sin(t * 5);
      dots.count = Math.min(most, points.length);
      for (let i = 0; i < dots.count; i++) dots.setMatrixAt(i, m.makeScale(s, s, s).setPosition(points[i]!.x, points[i]!.y, points[i]!.z));
      dots.instanceMatrix.needsUpdate = true;
    },
  };
}
