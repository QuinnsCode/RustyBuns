// The escape menu: Esc (or the pause button on a touch screen) freezes the ride and offers resume, restart and
// the title screen. The game loop asks `paused()` each frame; a pause never changes the sim, only stops feeding it.
import { createElement, Pause, Play, RotateCcw, House } from "lucide";

const icon = (node: Parameters<typeof createElement>[0]) => createElement(node, { width: 22, height: 22 });

export type PauseMenu = { paused: () => boolean; toggle: (on?: boolean) => void };

export function mountPause(onRestart: () => void, home: () => void): PauseMenu {
  let on = false;
  const root = Object.assign(document.createElement("div"), { className: "pause", hidden: true });
  const panel = Object.assign(document.createElement("div"), { className: "pause-panel", role: "dialog", ariaLabel: "Paused" });
  panel.append(Object.assign(document.createElement("h2"), { textContent: "Paused" }));
  const button = (glyph: Parameters<typeof createElement>[0], text: string, run: () => void) => {
    const b = Object.assign(document.createElement("button"), { className: "choice", type: "button" });
    b.append(icon(glyph), text);
    b.addEventListener("click", run);
    panel.append(b);
    return b;
  };
  const toggle = (want = !on) => {
    on = want;
    root.hidden = !on;
    if (on) root.querySelector("button")?.focus();
  };
  button(Play, "Resume", () => toggle(false));
  button(RotateCcw, "Restart run", () => { onRestart(); toggle(false); });
  button(House, "Main menu", home);
  root.append(panel);
  const pauseButton = Object.assign(document.createElement("button"), { className: "pause-btn", type: "button", title: "Pause (Esc)", ariaLabel: "Pause" });
  pauseButton.append(createElement(Pause, { width: 18, height: 18 }));
  pauseButton.addEventListener("click", () => toggle(true));
  document.body.append(root, pauseButton);
  window.addEventListener("keydown", (e: KeyboardEvent) => { if (e.code === "Escape") { e.preventDefault(); toggle(); } });
  return { paused: () => on, toggle };
}
