// Battery: the 3D office's frame loop is patched (scripts/rustybunsify.ts) to ask globalThis.__rbFrame(now) first and
// skip the frame on false. This answers from policy.ts, keeps the renderer's pixel ratio in step, and adds a
// Graphics setting to Settings › You, kept in this browser like the time zone.
import { KEY, fps, gate, parseMode, pixelRatio, type Mode } from "./policy.ts";

const saved = (): Mode => { try { return parseMode(localStorage.getItem(KEY)); } catch { return "auto"; } };
const save = (m: Mode) => { try { m === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, m); } catch {} };

let mode = saved(), onBattery = false, lastInput = performance.now();
for (const e of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"])
  addEventListener(e, () => (lastInput = performance.now()), { capture: true, passive: true });
(navigator as { getBattery?: () => Promise<{ charging: boolean } & EventTarget> }).getBattery?.().then((b) => {
  const read = () => (onBattery = !b.charging);
  read();
  b.addEventListener("chargingchange", read);
}, () => {});

const due = gate();
(globalThis as { __rbFrame?: (now: number) => boolean }).__rbFrame = (now) =>
  due(now, fps({ mode, focused: document.hasFocus(), idleMs: performance.now() - lastInput, onBattery }));

type Renderer = { getPixelRatio(): number; setPixelRatio(r: number): void };
((globalThis as { __rbOfficeTicks?: unknown[] }).__rbOfficeTicks ??= []).push((app: { renderer?: Renderer }) => {
  const want = pixelRatio(mode, onBattery, devicePixelRatio);
  if (app.renderer && app.renderer.getPixelRatio() !== want) app.renderer.setPixelRatio(want);
});

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const NOTES: Record<Mode, string> = {
  auto: "Up to 60 frames a second while you play, 30 while you watch, 15 in the background; less, and fewer pixels, on battery.",
  smooth: "Every frame your display offers while the office has focus, at full resolution.",
  saver: "30 frames a second at most, 5 in the background, at standard resolution.",
};

function setting() {
  const select = el("select", { className: "provider-select", ariaLabel: "Graphics" },
    el("option", { value: "auto" }, "Automatic"), el("option", { value: "smooth" }, "Smooth"), el("option", { value: "saver" }, "Battery saver"));
  select.value = mode;
  const note = el("p", { className: "setting-note" }, NOTES[mode]);
  select.addEventListener("change", () => {
    mode = select.value as Mode;
    save(mode);
    note.textContent = NOTES[mode];
  });
  const scope = el("span", { className: "scope you", title: "Only for you, kept in this browser" }, "Just you");
  return el("div", { className: "setting rb-power" }, el("div", { className: "setting-head" }, el("h4", {}, "Graphics"), scope), select, note);
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-power")) pane.append(setting());
}

function watch() {
  document.querySelectorAll(".modal.settings").forEach(addTo);
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(".modal.settings")) addTo(n);
      else n.querySelectorAll(".modal.settings").forEach(addTo);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.body) watch();
else document.addEventListener("DOMContentLoaded", watch, { once: true });

