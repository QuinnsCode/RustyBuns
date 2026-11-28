// The symbols where you sit or stand (#6551): switch the keys between piano and synth, put your mic or guitar in, your
// pedal board and your amp and cabinet while the guitar's in, and the Design desk when you're at it. One row of
// symbols, one small panel at a time. It only draws and reports presses; main.ts does the work.
import "./seat-bar.css";
import { CABS, HEADS } from "@rustybuns/gear/circuit";
import { addPedal, loopBack, MAX_BOARD, PEDAL_IDS, removePedal, type BoardRig, type PedalId } from "../amp/board-rig.ts";
import { PEDALS } from "../circuit/amps.ts";
import { DESIGNS } from "./design-desk.ts";

export interface SeatState {
  /** The keys' sound when you're sat at them, else null. */
  keys: "piano" | "synth" | null;
  /** What's plugged in, or null. */
  input: "mic" | "guitar" | null;
  /** Why the last try at an input didn't go, or "". */
  refused: string;
  board: BoardRig;
  /** Stood at the Design desk. */
  design: boolean;
}
export interface SeatActs {
  keys(): void;
  plug(input: "mic" | "guitar"): void;
  board(b: BoardRig): void;
}
type Panel = "pedals" | "amp" | "design" | null;

const svg = (inner: string, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
// Lucide (ISC)
const ICON = {
  piano: '<path d="M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8"/><path d="M2 14h20"/><path d="M6 14v4"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/>',
  synth: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h4"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M2 12h20"/><path d="M6 12v4"/><path d="M10 12v4"/><path d="M14 12v4"/><path d="M18 12v4"/>',
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  guitar: '<path d="m11.9 12.1 4.514-4.514"/><path d="M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z"/><path d="m6 16 2 2"/><path d="M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z"/>',
  pedals: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="16" r="3"/>',
  amp: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="7" cy="7.5" r="0.5"/><circle cx="12" cy="7.5" r="0.5"/><circle cx="17" cy="7.5" r="0.5"/>',
  design: '<path d="m12.99 6.74 1.93 3.44"/><path d="M19.136 12a10 10 0 0 1-14.271 0"/><path d="m21 21-2.16-3.84"/><path d="m3 21 8.02-14.26"/><circle cx="12" cy="5" r="2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  loop: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
};
const pedalName = (id: string) => PEDALS.find((p) => p.id === id)?.name ?? id;
const knobName = (id: string) => PEDALS.find((p) => p.id === id)?.knob ?? "Drive";

export function mountSeatBar(parent: HTMLElement, state: () => SeatState, acts: SeatActs) {
  const root = document.createElement("div"), bar = document.createElement("div"), panel = document.createElement("div"), note = document.createElement("p");
  root.id = "seat"; root.hidden = true;
  bar.id = "seat-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Where you are");
  panel.id = "seat-panel"; panel.hidden = true;
  note.id = "seat-note"; note.setAttribute("role", "status"); note.hidden = true;
  root.append(bar, note, panel);
  parent.append(root);
  let open: Panel = null, adding = false, drawn = "";

  const button = (id: string, label: string, inner: string, act: () => void) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.seat = id; b.title = label; b.setAttribute("aria-label", label); b.innerHTML = inner;
    // let go of the focus: Space and the arrows are the room's
    b.addEventListener("click", () => { b.blur(); act(); });
    return b;
  };
  const show = (p: Panel) => { open = open === p ? null : p; adding = false; draw(); };
  const change = (b: BoardRig) => { adding = false; acts.board(b); draw(); };

  /** The chain left to right: your pedals, a plus, the amp. A drag from one pedal to another loops it back. */
  function pedals(s: SeatState) {
    const row = document.createElement("div");
    row.className = "seat-chain";
    let from = -1;
    s.board.pedals.forEach((p, i) => {
      const tile = document.createElement("div");
      tile.className = "seat-pedal"; tile.dataset.pedal = String(i);
      const b = s.board.back, looped = !!b && (b.from === i || b.to === i);
      tile.toggleAttribute("data-looped", looped);
      const name = document.createElement("b");
      name.innerHTML = looped ? svg(ICON.loop, 14) : "";
      name.append(pedalName(p.pedal));
      const knob = document.createElement("input");
      knob.type = "range"; knob.min = "0"; knob.max = "10"; knob.step = "0.5"; knob.value = String(p.drive);
      knob.setAttribute("aria-label", `${pedalName(p.pedal)} ${knobName(p.pedal)}`); knob.title = knobName(p.pedal);
      knob.addEventListener("change", () => { knob.blur(); change({ ...state().board, pedals: state().board.pedals.map((q, k) => (k === i ? { ...q, drive: Number(knob.value) } : q)) }); });
      tile.append(name, knob, button(`remove-${i}`, `Take out ${pedalName(p.pedal)}`, svg(ICON.x, 14), () => change(removePedal(state().board, i))));
      // the name is the handle: drag it onto another pedal for the loop
      name.addEventListener("pointerdown", (e) => { from = i; name.releasePointerCapture?.(e.pointerId); });
      row.append(tile);
      row.insertAdjacentHTML("beforeend", svg(ICON.next, 14));
    });
    row.addEventListener("pointerup", (e) => {
      const to = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".seat-pedal")?.dataset.pedal;
      if (from >= 0 && to !== undefined && Number(to) !== from) change(loopBack(state().board, from, Number(to)));
      from = -1;
    });
    if (s.board.pedals.length < MAX_BOARD) row.append(button("add", "Add a pedal", svg(ICON.plus), () => { adding = !adding; draw(); }));
    row.append(button("to-amp", "Amp and cabinet", svg(ICON.amp), () => show("amp")));
    panel.append(row);
    if (adding) {
      const list = document.createElement("div");
      list.className = "seat-list";
      for (const id of PEDAL_IDS) list.append(button(`add-${id}`, pedalName(id), "", () => change(addPedal(state().board, id as PedalId))));
      for (const b of list.querySelectorAll("button")) b.textContent = b.title;
      panel.append(list);
    }
    if (s.board.pedals.length > 1) {
      const how = document.createElement("p");
      how.className = "seat-how";
      how.innerHTML = `${svg(ICON.loop, 14)} drag one name onto another`;
      panel.append(how);
    }
  }
  /** Heads and cabinets as pictures. */
  function amps(s: SeatState) {
    const row = (label: string, cards: HTMLButtonElement[]) => {
      const el = document.createElement("div");
      el.className = "seat-cards"; el.setAttribute("role", "group"); el.setAttribute("aria-label", label);
      el.append(...cards);
      panel.append(el);
    };
    const card = (id: string, name: string, picture: string, on: boolean, act: () => void) => {
      const b = button(id, name, `${picture}<span></span>`, act);
      const span = b.querySelector("span");
      if (span) span.textContent = name;
      b.setAttribute("aria-pressed", String(on));
      return b;
    };
    row("Amp head", HEADS.map((h, n) => card(`head-${h.id}`, h.name, headPicture(n, h.stages.length), s.board.amp === h.id, () => change({ ...state().board, amp: h.id as BoardRig["amp"] }))));
    row("Cabinet", (Object.keys(CABS) as (keyof typeof CABS)[]).map((id) => card(`cab-${id}`, CABS[id].name, cabPicture(CABS[id].speakers), s.board.cab === id, () => change({ ...state().board, cab: id }))));
  }
  function designs() {
    const el = document.createElement("div");
    el.className = "seat-cards";
    for (const d of DESIGNS) {
      const a = document.createElement("a");
      a.href = d.href; a.dataset.seat = `design-${d.id}`;
      a.innerHTML = `${svg(d.icon, 40)}<span>${d.say}</span>`;
      el.append(a);
    }
    panel.append(el);
  }

  function draw() {
    const s = state();
    if (open === "design" && !s.design) open = null;
    // the board and the amp wait while the guitar is on its way in (or the mic is on its way out)
    const shown = open === "design" || s.input === "guitar" ? open : null;
    drawn = JSON.stringify([s, open, adding]);
    bar.replaceChildren();
    if (s.keys) bar.append(button("keys", s.keys === "piano" ? "Piano: press for synth" : "Synth: press for piano", svg(ICON[s.keys]), acts.keys));
    const input = (id: "mic" | "guitar", say: string) => {
      const b = button(id, say, svg(ICON[id]), () => { open = id === "guitar" && s.input !== "guitar" ? "pedals" : null; acts.plug(id); draw(); });
      b.setAttribute("aria-pressed", String(s.input === id));
      return b;
    };
    bar.append(input("mic", s.input === "mic" ? "Mic is in: press to pull it out" : "Put your mic in"), input("guitar", s.input === "guitar" ? "Guitar is in: press to pull it out" : "Plug in a guitar"));
    if (s.input === "guitar") bar.append(button("pedals", "Pedal board", svg(ICON.pedals), () => show("pedals")), button("amp", "Amp and cabinet", svg(ICON.amp), () => show("amp")));
    if (s.design) bar.append(button("design", "Design", svg(ICON.design), () => show("design")));
    if (matchMedia("(pointer: fine)").matches) bar.insertAdjacentHTML("beforeend", '<kbd title="The ` key frees the mouse for these">`</kbd>');
    note.textContent = s.refused;
    note.hidden = !s.refused;
    panel.replaceChildren();
    panel.hidden = !shown;
    if (shown === "pedals") pedals(s); else if (shown === "amp") amps(s); else if (shown === "design") designs();
  }
  return {
    /** Called often: redraws only when what it shows has changed. */
    sync(visible: boolean) {
      root.hidden = !visible;
      if (visible && JSON.stringify([state(), open, adding]) !== drawn) draw();
    },
    /** Open the Design desk's choice (E at the desk, or its command). */
    design() { open = "design"; draw(); },
    isOpen: () => !panel.hidden && !root.hidden,
    close() { open = null; draw(); },
  };
}

/** A head: its box, its grille and one knob a gain stage plus the tone stack's three. */
function headPicture(n: number, stages: number): string {
  const face = ["#c9a04a", "#7d8791", "#3a3d42", "#4f8f8a"][n % 4], knobs = stages + 3;
  return `<svg viewBox="0 0 80 48" width="80" height="48" aria-hidden="true"><rect x="2" y="6" width="76" height="38" rx="5" fill="#1b1d21" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="11" width="64" height="17" rx="2" fill="#2d3036"/><rect x="8" y="30" width="64" height="10" rx="2" fill="${face}"/>${Array.from({ length: knobs }, (_, i) => `<circle cx="${12 + (i * 56) / (knobs - 1)}" cy="35" r="2.6" fill="#111"/>`).join("")}</svg>`;
}
/** A cabinet: its speakers, one, two or four. */
function cabPicture(speakers: number): string {
  const at = speakers === 1 ? [[40, 30, 17]] : speakers === 2 ? [[24, 30, 15], [56, 30, 15]] : [[28, 19, 11], [52, 19, 11], [28, 42, 11], [52, 42, 11]];
  const w = speakers === 1 ? 46 : speakers === 2 ? 72 : 56;
  return `<svg viewBox="0 0 80 60" width="80" height="60" aria-hidden="true"><rect x="${40 - w / 2}" y="4" width="${w}" height="52" rx="4" fill="#1b1d21" stroke="currentColor" stroke-width="1.5"/>${at.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#2d3036" stroke="#7d8791"/><circle cx="${x}" cy="${y}" r="${r / 3}" fill="#111"/>`).join("")}</svg>`;
}
