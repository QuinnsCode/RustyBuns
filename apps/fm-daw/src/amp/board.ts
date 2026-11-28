// Q Amp's board view: the schematic and PCB of the board you are playing (the
// pedal that's on, or the amp's first tube stage), drawn by tscircuit
// (`bun scripts/boards.ts`), with the parts that bend the signal glowing with it.
// The diode pairs and capacitors are sockets, the way kit builders socket parts
// to try them, and each fixed resistor takes another value: click one, pick another
// part, and hear it while you play (once the bench has found it still plays).
import type { Edit } from "../circuit/edits.ts";
import { redraw } from "../circuit/redraw.ts";
import { BOARDS, STEPS, CLIPPERS, stepValue, farads, ohms, sockets, type BoardId, type Socket, type Swaps } from "../circuit/circuits.ts";
import "./board.css";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";

// The SVGs come with the page only once someone opens the board view.
const SVGS = import.meta.glob<string>("../../circuits/*.svg", { query: "?raw", import: "default" });
/** A board's schematic or PCB drawing as SVG text, loaded when first asked for ("" if it has none). */
export const svgOf = (board: string, side: Side): Promise<string> => SVGS[`../../circuits/${board}.${side}.svg`]?.() ?? Promise.resolve("");

/** A board's schematic with the circuit `edits` drawn into it (#6445): the stock drawing while there are none. */
export const schematicOf = (board: string, edits: readonly Edit[] = []): Promise<string> =>
  svgOf(board, "schematic").then((svg) => (isBoard(board) ? redraw(svg, board, edits) : svg));

export type Side = "schematic" | "pcb";
const SIDES: { id: Side; label: string; icon: string }[] = [
  { id: "schematic", label: "Schematic", icon: "workflow" },
  { id: "pcb", label: "Circuit board", icon: "circuit-board" },
];

const isBoard = (b: string): b is BoardId => Object.hasOwn(BOARDS, b);

/** What a socket holds now, in a word. */
export function holding(s: Socket, swaps: Swaps): string {
  const v = swaps[s.id];
  if (s.kind === "clipper") return v && Object.hasOwn(CLIPPERS, v) ? CLIPPERS[v as keyof typeof CLIPPERS].label : CLIPPERS.silicon.label;
  return valueAt(s, STEPS.some((x) => x === v) ? Number(v) : 1);
}

/** A capacitor's or resistor's printed value at one of `STEPS`. */
const valueAt = (s: Exclude<Socket, { kind: "clipper" }>, step: number): string =>
  s.kind === "cap" ? farads(stepValue(s.farads, step)) : `${ohms(stepValue(s.ohms, step))}Ω`;

/** Crops an SVG to what's drawn on it (tscircuit leaves a wide margin), less its background. */
export function fit(svg: SVGSVGElement | null): void {
  if (!svg) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of svg.children) {
    if (!(el instanceof SVGGraphicsElement) || el.classList.contains("boundary")) continue;
    const b = el.getBBox();
    if (!b.width && !b.height) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0)) return;
  const pad = 12;
  svg.setAttribute("viewBox", `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
}

export class BoardView {
  readonly el = h("section", "board-view");
  private readonly title = h("span", "board-title");
  private readonly hint = h("span", "board-hint");
  private readonly art = h("div", "board-art");
  private readonly menu = h("div", "socket-menu");
  private readonly tabs: HTMLButtonElement[];
  private readonly reset: HTMLButtonElement;
  private side: Side = "schematic";
  /** A pedal's board, or a sound wall module's kit (`wall-vco`), whose drawings come in `show`'s options. */
  private board: string | null = null;
  private swaps: Swaps | null = null;
  private sockets: Socket[] = [];
  private drawn = "";
  private readOnly = false;
  private pcb: (() => Promise<string>) | null = null;
  private schematic: (() => Promise<string>) | null = null;
  private probed: string | null = null;
  /** The last changed circuit drawn, so it is worked out once however often the board is shown. */
  private changed: { of: string; load: () => Promise<string> } | null = null;

  /**
   * `onSwap(socket, choice)`: a choice of null puts the stock part back; socket null resets the whole board. With `onNet`,
   * a click on a schematic trace that isn't on a socket hands over its net's connectivity key (Q Builder's scope).
   */
  constructor(private readonly onSwap: (socket: string | null, choice: string | null) => void, private readonly onNet?: (key: string) => void) {
    this.el.classList.toggle("nets", !!onNet);
    this.menu.hidden = true;
    this.menu.setAttribute("role", "menu");
    this.tabs = SIDES.map((s) => {
      const b = h("button", "icon-btn", icon(s.icon, 16));
      b.type = "button"; b.title = s.label; b.setAttribute("aria-label", s.label);
      b.addEventListener("click", () => { this.side = s.id; void this.draw(); });
      return b;
    });
    this.reset = h("button", "icon-btn", icon("rotate-ccw", 16));
    this.reset.type = "button"; this.reset.title = "Back to the stock parts"; this.reset.setAttribute("aria-label", "Back to the stock parts");
    this.reset.addEventListener("click", () => this.onSwap(null, null));
    this.el.append(h("div", "board-top", icon("circuit-board", 16), this.title, this.hint, h("nav", "modes", ...this.tabs, this.reset)), this.art, this.menu);
    this.art.addEventListener("click", (e) => this.pick(e));
    document.addEventListener("pointerdown", (e) => { if (!this.menu.hidden && e.target instanceof Node && !this.menu.contains(e.target) && !this.art.contains(e.target)) this.menu.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.menu.hidden = true; });
  }

  /**
   * Show `board`. With `swaps`, its sockets take clicks; null shows it read-only. `o.readOnly` shows the swaps
   * without taking clicks, `o.pcb` and `o.schematic` draw another PCB or schematic (a kit's own) in place of the board's.
   * `o.edits` are changes to the circuit: the schematic is redrawn with them.
   */
  show(board: string, title: string, swaps: Swaps | null, o: { readOnly?: boolean; hint?: string; pcb?: () => Promise<string>; schematic?: () => Promise<string>; edits?: readonly Edit[] } = {}): void {
    this.title.textContent = title;
    this.swaps = swaps;
    this.readOnly = !!o.readOnly;
    const pcb = o.pcb ?? null, schematic = o.schematic ?? (o.edits?.length ? this.edited(board, o.edits) : null);
    if (pcb !== this.pcb || schematic !== this.schematic || board !== this.board) { this.pcb = pcb; this.schematic = schematic; this.drawn = ""; }
    this.sockets = swaps && isBoard(board) ? sockets(board) : [];
    const changed = swaps ? this.sockets.filter((s) => swaps[s.id] !== undefined).length : 0;
    this.hint.textContent = swaps ? (changed ? `your version · ${changed} part${changed > 1 ? "s" : ""} changed` : "click a diode, capacitor or resistor to change it") : "set by the amp · switch a pedal on to swap parts";
    if (o.hint) this.hint.textContent = o.hint;
    this.reset.hidden = !swaps || this.readOnly;
    this.reset.disabled = !changed;
    if (board !== this.board) { this.board = board; this.menu.hidden = true; }
    void this.draw();
  }

  private edited(board: string, edits: readonly Edit[]): () => Promise<string> {
    const of = `${board} ${JSON.stringify(edits)}`;
    if (this.changed?.of !== of) {
      let svg: Promise<string> | null = null;
      this.changed = { of, load: () => (svg ??= schematicOf(board, edits)) };
    }
    return this.changed.load;
  }

  /** No drawing to show: just a title and why. */
  blank(title: string, why: string): void {
    this.title.textContent = title;
    this.hint.textContent = why;
    this.board = null; this.swaps = null; this.sockets = []; this.drawn = ""; this.pcb = null; this.schematic = null;
    this.reset.hidden = true;
    this.menu.hidden = true;
    this.art.replaceChildren();
  }

  /** A button of the page's own at the end of the view's bar. */
  tool(el: HTMLElement): void {
    this.reset.after(el);
  }

  /** Which drawing to show: the schematic or the PCB. */
  view(side: Side): void {
    this.side = side;
    void this.draw();
  }

  /** Lights the net with this connectivity key (the scope's), or none. */
  probe(key: string | null): void {
    this.probed = key;
    void this.draw();
  }

  /** How hard the board is working, 0 to 1: the parts that bend the signal glow with it. */
  glow(level: number): void {
    this.el.style.setProperty("--signal", level.toFixed(3));
  }

  private async draw(): Promise<void> {
    const board = this.board;
    if (!board) return;
    this.tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(SIDES[i].id === this.side)));
    const key = `${board}.${this.side}`;
    if (key !== this.drawn) {
      const own = this.side === "pcb" ? this.pcb : this.schematic;
      const svg = await (own ? own() : svgOf(board, this.side));
      if (board !== this.board || `${board}.${this.side}` !== key || own !== (this.side === "pcb" ? this.pcb : this.schematic)) return; // moved on while it loaded
      this.art.innerHTML = svg; // our own file, from circuits/
      this.art.dataset.side = this.side;
      this.drawn = key;
      fit(this.art.querySelector("svg"));
    }
    const swaps = this.swaps ?? {};
    for (const g of this.art.querySelectorAll<SVGElement>("[data-part]")) {
      const part = g.dataset.part ?? "";
      const s = this.sockets.find((x) => x.parts.includes(part));
      g.classList.toggle("bends", /^(D|U|V)\d/.test(part));
      g.classList.toggle("socket", !!s);
      g.classList.toggle("swapped", !!s && swaps[s.id] !== undefined);
      g.classList.toggle("empty", !!s && swaps[s.id] === "none");
      if (s) g.setAttribute("aria-label", `${s.parts.join(" ")}: ${holding(s, swaps)}`);
    }
    for (const t of this.art.querySelectorAll<SVGElement>("[data-subcircuit-connectivity-map-key]")) t.classList.toggle("probed", !!this.probed && t.dataset.subcircuitConnectivityMapKey === this.probed);
  }

  private pick(e: MouseEvent): void {
    const g = e.target instanceof Element ? e.target.closest<SVGElement>("[data-part]") : null;
    const s = g && this.sockets.find((x) => x.parts.includes(g.dataset.part ?? ""));
    const net = !s && this.onNet && e.target instanceof Element ? e.target.closest<SVGElement>("[data-subcircuit-connectivity-map-key]") : null;
    if (net) { this.menu.hidden = true; this.onNet?.(net.dataset.subcircuitConnectivityMapKey ?? ""); return; }
    if (!g || !s || !this.swaps || this.readOnly) { this.menu.hidden = true; return; }
    const now = this.swaps[s.id];
    const item = (label: string, note: string, choice: string, on: boolean) => {
      const b = h("button", "socket-item", h("span", "socket-label", label), h("span", "socket-note", note));
      b.type = "button"; b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", String(on));
      b.addEventListener("click", () => { this.menu.hidden = true; this.onSwap(s.id, choice); });
      return b;
    };
    const items = s.kind === "clipper"
      ? Object.entries(CLIPPERS).map(([id, c]) => item(c.label, c.note, id, (now ?? "silicon") === id))
      : STEPS.map((step) => item(valueAt(s, Number(step)), step === "1" ? "stock" : Number(step) < 1 ? "smaller" : "bigger", step, (now ?? "1") === step));
    this.menu.replaceChildren(h("div", "socket-head", s.kind === "clipper" ? `Clipper ${s.parts.join(" ")}` : `${s.kind === "cap" ? "Capacitor" : "Resistor"} ${s.id}`), ...items);
    // Under the part, inside the view.
    const box = g.getBoundingClientRect(), view = this.el.getBoundingClientRect();
    this.menu.hidden = false;
    const w = this.menu.offsetWidth;
    this.menu.style.left = `${Math.max(8, Math.min(view.width - w - 8, box.left - view.left + box.width / 2 - w / 2))}px`;
    this.menu.style.top = `${box.bottom - view.top + 6}px`;
    this.menu.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
  }
}
