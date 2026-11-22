// The full desk over the jam room (#5394): the gear room's desk view (src/room/desk.ts `drawDesk`, its look in
// src/room/studio.css) in a panel, and a button that opens it. Its moves go through desk-model.ts.
import { drawDesk } from "../room/desk.ts";
import { shapeName } from "../mixer.ts";
import { closeShape, openShape, refreshShape } from "../ui/shape-overlay.tsx";
import { deskModel, type DeskHost, type DeskModel } from "./desk-model.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = "") => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};
// lucide's sliders-vertical (ISC)
const SLIDERS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/></svg>';

/** Mount the desk on the page: its button and its panel. */
export function mountDesk(host: DeskHost): DeskModel {
  const m = deskModel(host);
  const btn = el("button", { id: "desk-open", type: "button", title: "The mixer: every track and player (Tab standing)", "aria-label": "Open the mixer" });
  btn.innerHTML = `${SLIDERS}<span>Mixer</span>`;
  btn.addEventListener("click", () => m.open());
  const panel = el("section", { id: "desk", "aria-label": "The mixer", role: "dialog" });
  const close = el("button", { id: "desk-close", type: "button" }, "Back to the room");
  close.addEventListener("click", () => m.close());
  const head = el("header");
  head.append(el("h2", {}, "Mixer"), close);
  const note = el("p", { class: "desk-note" });
  const strips = el("div", { id: "desk-strips" });
  panel.append(head, note, strips);
  document.body.append(btn, panel);

  let drawn = "";
  const draw = () => {
    const s = m.state();
    panel.hidden = !s.open;
    btn.hidden = s.open || host.ready?.() === false;
    panel.classList.toggle("ro", s.readOnly);
    note.hidden = !s.readOnly && !s.refused;
    note.textContent = s.readOnly ? "Read only: the leader hasn't let you mix. H raises your hand" : s.refused ?? "";
    if (!s.open) { drawn = ""; closeShape(); return; }
    const cabled = s.desk.returns.map((r) => host.cabled?.(r.aux) ?? "");
    const key = JSON.stringify([s.desk, cabled, m.host.project().eq]);
    if (key === drawn) return;
    drawn = key;
    drawDesk(strips, s.desk, cabled, (d) => void m.set(d), {
      spaceMute: false, master: m.host.project().eq,
      shape: (at) => openShape({ title: shapeName(m.desk(), at), sampleRate: host.sampleRate?.() ?? 48000, doc: () => m.shapeDoc(at), onChange: (eq) => void m.shape(at, eq), readOnly: () => m.state().readOnly }),
    });
    refreshShape();
  };
  m.subscribe(draw);
  draw();
  // sitting, standing and the sesh's ops happen in many places: look a few times a second, as the lane does
  setInterval(() => m.refresh(), 250);
  return m;
}
