import { expect, test } from "bun:test";
import { THEME_SCRIPT } from "../src/app/Theme.tsx";

// Runs the sky switch's script against a stand-in page: a body whose clock is `t`, a sun at a spot, a store.
function page(stored: string | null, t: number, dark = false) {
  const style = new Map<string, string>([["--t", String(t)]]);
  const listeners: Record<string, (e: unknown) => void> = {};
  const body = { style: { animation: "", transition: "", setProperty: (k: string, v: string) => style.set(k, String(v)), removeProperty: (k: string) => style.delete(k) }, offsetWidth: 0 };
  const sun = { getBoundingClientRect: () => ({ left: 100, right: 160, top: 100, bottom: 160, width: 60 }) };
  const store = new Map<string, string>(stored ? [["eqosys-sky", stored]] : []);
  const document = {
    body, documentElement: { dataset: {} as Record<string, string> },
    addEventListener: (k: string, f: (e: unknown) => void) => { listeners[k] = f; },
    querySelector: (q: string) => (q === ".sky .sun" ? sun : null),
  };
  new Function("document", "matchMedia", "getComputedStyle", "localStorage", THEME_SCRIPT.replace(/\bd=document\b/, "d=document"))(
    document, () => ({ matches: dark, addEventListener() {} }),
    (n: unknown) => ({ getPropertyValue: (k: string) => (n === body ? style.get(k) ?? "" : ""), opacity: "1" }),
    { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  return { document, style, store, listeners, doubleClickSun: () => listeners.dblclick({ target: { closest: () => null }, clientX: 130, clientY: 130 }) };
}

test("double-clicking the sun turns the sky to night, lands on a night peak and is remembered; again brings the day back", () => {
  const p = page(null, 0.2);
  p.doubleClickSun();
  expect(p.store.get("eqosys-sky")).toBe("night");
  expect(p.document.documentElement.dataset.sky).toBe("night");
  expect(Number(p.style.get("--t"))).toBeCloseTo(0.75);
  p.doubleClickSun(); // the clock now reads night, so the sun is down; a double-click on the moon's spot is the same handler
  expect(p.store.get("eqosys-sky")).toBe("day");
  expect(Number(p.style.get("--t")) % 1).toBeCloseTo(0.25);
});

test("a saved choice is applied on load with no slide, and System follows the device", () => {
  const night = page("night", 0.2);
  expect(night.style.get("--t")).toBe("0.75");
  const sys = page("system", 0.6, false);
  expect(Number(sys.style.get("--t")) % 1).toBeCloseTo(0.25);
  expect(page("system", 0.2, true).style.get("--t")).toBe("0.75");
  expect(page(null, 0.2).style.get("--t")).toBe("0.2");
});
