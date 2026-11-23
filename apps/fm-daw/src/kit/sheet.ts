// A pedal's or a sound wall module's build sheet: its schematic and board (Q Amp's BoardView), its parts list with the player's swaps, the
// Gerber layers, a tolerance band (how far a build may sound from the sim, tolerance.ts), and one button for the zip a builder needs. Opened from a pedal on the gear room's wall or in hand
// (room/main.ts), from a module in the sound wall's case (B on it, the same), and from Q Amp's board view (amp/main.ts). Kits are found by folder: whatever `circuits/<kit>/`
// holds is loaded only when its sheet opens, so a new kit shows up with no change here.
import "./sheet.css";
import { check, num, obj, or, rec, str } from "@rustybuns/util/guard";
import type { PedalDef } from "../circuit/amps.ts";
import type { Swaps } from "../circuit/circuits.ts";
import { BoardView, svgOf, type Side } from "../amp/board.ts";
import { h, iconButton } from "../amp/dom.ts";
import { icon } from "../amp/icons.ts";
import type { Panel } from "../../circuits/wall-panels.ts";
import { kitZip, moduleKit, moduleSheetOf, sheetOf, type KitFiles, type Sheet } from "./kit.ts";
import { bandText, toleranceBand, widest, type Band } from "./tolerance.ts";

// Every file under a kit folder, as text, fetched only when asked for.
const KITS = import.meta.glob<string>("../../circuits/*/**/*", { query: "?raw", import: "default" });
const ROOT = "../../circuits/";

/** The files in `circuits/<kit>/`, by path inside it; none if the folder isn't there. */
export async function kitFiles(kit: string): Promise<KitFiles> {
  const at = `${ROOT}${kit}/`, out: KitFiles = {};
  await Promise.all(Object.entries(KITS).filter(([p]) => p.startsWith(at)).map(async ([p, load]) => { out[p.slice(at.length)] = await load(); }));
  return out;
}

/** Q Amp keeps each pedal's part swaps and Drive in its saved state ("q-amp"): read them, and nothing else, through a guard. */
const AmpSaved = obj({ swaps: or(rec(rec(str(12), 40), 10), {}), drive: or(rec(num(0, 10), 32), {}) });
function saved() {
  try {
    const raw = localStorage.getItem("q-amp");
    return (raw && check(AmpSaved, JSON.parse(raw))) || null;
  } catch { return null; }
}
export const savedSwaps = (pedal: string): Swaps => saved()?.swaps[pedal] ?? {};
/** The pedal's Drive knob as Q Amp last left it, 0 to 10 (5 if never turned). */
export const savedDrive = (pedal: string): number => saved()?.drive[pedal] ?? 5;

type Tab = Side | "panel" | "parts" | "files" | "band";
/** Each tab, and whether a pedal's sheet and a module's have it: a module has its front panel, no tolerance band yet. */
const TABS: { id: Tab; label: string; icon: string; pedal: boolean; module: boolean }[] = [
  { id: "schematic", label: "Schematic", icon: "workflow", pedal: true, module: true },
  { id: "pcb", label: "Circuit board", icon: "circuit-board", pedal: true, module: true },
  { id: "panel", label: "Front panel: a board of its own", icon: "square", pedal: false, module: true },
  { id: "parts", label: "Parts list", icon: "list", pedal: true, module: true },
  { id: "files", label: "Board files (Gerbers)", icon: "folder", pedal: true, module: true },
  { id: "band", label: "Tolerance: how far a build may sound from the sim", icon: "activity", pedal: true, module: false },
];

export class BuildSheet {
  readonly el = h("section", "build-sheet");
  private readonly title = h("span", "sheet-title");
  private readonly note = h("span", "sheet-note");
  private readonly board = new BoardView(() => {});
  private readonly parts = h("div", "sheet-parts");
  private readonly files = h("div", "sheet-files");
  private readonly band = h("div", "sheet-band");
  private readonly tabs: HTMLButtonElement[];
  private readonly save: HTMLButtonElement;
  private tab: Tab = "schematic";
  private sheet: Sheet | null = null;
  private kit: KitFiles = {};
  private def: PedalDef | null = null;
  /** The sound wall module whose sheet is open, when it is one (def is then null). */
  private module: Panel | null = null;
  private swaps: Swaps = {};
  private drive = 5;
  private asked = 0;
  /** The band for the pedal as it is now (its swaps and Drive), and which pedal and setting that was. */
  private tolerance: { key: string; band: Promise<Band>; done: Band | null } | null = null;

  constructor(private readonly onClose: () => void) {
    this.el.hidden = true;
    this.el.tabIndex = -1;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Build sheet");
    this.tabs = TABS.map((t) => iconButton(t.icon, t.label, () => this.show(t.id)));
    this.save = iconButton("download", "Download the kit: Gerbers, parts list, drill template and build sheet, as one zip", () => void this.download());
    const close = iconButton("x", "Close", () => this.close());
    this.el.append(
      h("header", "sheet-top", icon("file-text", 16), this.title, this.note, h("nav", "sheet-tabs", ...this.tabs), this.save, close),
      this.board.el, this.parts, this.files, this.band,
    );
    this.el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } });
  }

  /** Open `pedal`'s sheet with the player's `swaps` on it and its Drive at `drive` (0 to 10); resolves once its kit has loaded. */
  async open(pedal: PedalDef, swaps: Swaps, drive = 5): Promise<Sheet> {
    const ask = this.opening(pedal.name, null);
    this.def = pedal; this.swaps = swaps; this.drive = drive;
    const kit = await kitFiles(sheetOf(pedal, {}).kit);
    const sheet = sheetOf(pedal, kit, swaps);
    if (ask !== this.asked) return sheet; // opened another while this loaded
    const swapped = sheet.parts.filter((p) => p.swapped).length;
    return this.opened(kit, sheet, !sheet.made ? "fab files not made yet" : swapped ? `your version · ${swapped} part${swapped > 1 ? "s" : ""} swapped` : "stock parts");
  }

  /** Open a sound wall module's sheet (`circuits/wall-<id>/`): its board, front panel, parts to order and files. */
  async openModule(p: Panel): Promise<Sheet> {
    const ask = this.opening(p.name, p);
    const kit = await kitFiles(moduleKit(p)), sheet = moduleSheetOf(p, kit);
    if (ask !== this.asked) return sheet;
    const known = sheet.parts.filter((x) => x.mpn).length;
    return this.opened(kit, sheet, sheet.made ? `${p.what}, ${p.hp} HP · ${known} of ${sheet.parts.length} parts with a part number` : "fab files not made yet");
  }

  private opening(title: string, module: Panel | null): number {
    this.def = null; this.module = module;
    this.el.hidden = false;
    this.title.textContent = title;
    this.note.textContent = "loading";
    this.tabs.forEach((b, i) => { b.hidden = !(module ? TABS[i].module : TABS[i].pedal); });
    if (this.tabs[TABS.findIndex((t) => t.id === this.tab)]?.hidden) this.tab = "schematic";
    return ++this.asked;
  }

  private opened(kit: KitFiles, sheet: Sheet, note: string): Sheet {
    this.kit = kit; this.sheet = sheet;
    this.note.textContent = note;
    this.save.disabled = !sheet.made;
    this.save.title = sheet.made ? "Download the kit: Gerbers, parts list, drill template and build sheet, as one zip" : "No fab files for this pedal yet";
    this.drawParts(sheet); this.drawFiles(sheet);
    this.show(this.tab);
    this.el.focus();
    return sheet;
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.asked++;
    this.sheet = null; this.module = null;
    this.onClose();
  }

  /** What an agent reads: the open sheet, its tab, its parts and layers, and the tolerance band once it has run. */
  state(): { open: string | null; tab: Tab; made: boolean; parts: Sheet["lines"]; layers: string[]; band: { widest: number; level: Band["level"]; runs: number } | null } | null {
    const s = this.sheet, b = this.tolerance?.done;
    return s && !this.el.hidden ? { open: s.pedal, tab: this.tab, made: s.made, parts: s.lines, layers: s.layers, band: b ? { widest: widest(b), level: b.level, runs: b.runs } : null } : null;
  }

  /** The open pedal's tolerance band, run once per pedal, swaps and Drive (a few seconds, yielding to the page between builds). */
  bandOf(): Promise<Band> | null {
    const def = this.def;
    if (!def) return null;
    const key = JSON.stringify([def.id, this.swaps, this.drive]);
    if (this.tolerance?.key !== key) {
      const mine = () => this.tolerance?.key === key;
      const band = toleranceBand(def.net(this.drive, this.swaps), {
        pause: () => new Promise((r) => setTimeout(r, 0)),
        onRun: (done, of) => { if (mine() && this.tab === "band") this.band.replaceChildren(h("p", "sheet-empty", `Building it ${of} times with parts off their printed values: ${done} of ${of}`)); },
      }).then((b) => { if (mine() && this.tolerance) this.tolerance.done = b; return b; });
      this.tolerance = { key, band, done: null };
    }
    return this.tolerance.band;
  }

  /** The kit as a zip, saved as `<kit>-kit.zip`; its name and the paths in it. */
  async download(): Promise<{ name: string; bytes: number } | null> {
    const s = this.sheet, def = this.def;
    if (!s?.made || (!def?.board && !this.module)) return null;
    const schematic = def?.board ? await svgOf(def.board, "schematic") : this.kit["schematic.svg"] ?? "";
    const zipped = kitZip(this.kit, s.text, schematic, s.parts);
    const name = `${s.kit}-kit.zip`, url = URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));
    const a = h("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { name, bytes: zipped.length };
  }

  show(tab: Tab): void {
    this.tab = tab;
    this.tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(TABS[i].id === tab)));
    const def = this.def, m = this.module, drawing = tab === "schematic" || tab === "pcb" || tab === "panel";
    this.board.el.hidden = !drawing; this.parts.hidden = tab !== "parts"; this.files.hidden = tab !== "files"; this.band.hidden = tab !== "band";
    if (tab === "band") { void this.drawBand(); return; }
    if (drawing && m) { this.drawModule(m, tab === "panel" ? "panel" : tab === "pcb" ? "pcb" : "schematic"); return; }
    if (!drawing || !def) return;
    if (!def.board) { this.board.blank(def.name, "this pedal has no board drawn yet"); return; }
    const pcb = this.kit["pcb.svg"];
    this.board.show(def.board, def.name, this.swaps, {
      readOnly: true, hint: pcb ? "the fab board" : "the circuit as played",
      pcb: pcb ? () => Promise.resolve(pcb) : undefined,
    });
    this.board.view(tab === "pcb" ? "pcb" : "schematic");
  }

  /** A module's drawings are its kit's own: the schematic, the board, and the front panel (drawn as a PCB). */
  private drawModule(m: Panel, what: "schematic" | "pcb" | "panel"): void {
    const svg = what === "panel" ? this.kit["panel/pcb.svg"] : this.kit[`${what}.svg`];
    if (!svg) { this.board.blank(m.name, "not made yet: bun scripts/pcb.ts wall"); return; }
    const load = () => Promise.resolve(svg);
    // The panel is shown as the view's PCB side, under a key of its own so it doesn't stand in for the board's.
    this.board.show(what === "panel" ? `${moduleKit(m)}-panel` : moduleKit(m), m.name, null, {
      readOnly: true, hint: what === "panel" ? "the front panel, a board of its own" : "the fab board",
      pcb: load, schematic: load,
    });
    this.board.view(what === "schematic" ? "schematic" : "pcb");
  }

  private async drawBand(): Promise<void> {
    const def = this.def, run = this.bandOf();
    if (!def || !run) return;
    if (!this.tolerance?.done) this.band.replaceChildren(h("p", "sheet-empty", "Building it with parts off their printed values"));
    const b = await run;
    if (this.def !== def || this.tab !== "band" || this.el.hidden) return;
    this.band.replaceChildren(bandChart(b), h("p", "sheet-band-text", bandText(b)),
      h("p", "sheet-empty", "The line is the sim; the shaded band is every build's lowest to highest, played quietly so the diodes stay out of it. A part swap moves it further than any of these: that is what the sockets are for."));
  }

  private drawParts(s: Sheet): void {
    if (!s.made) { this.parts.replaceChildren(h("p", "sheet-empty", "The fab files are not made yet, so there is no parts list. The schematic and board are in the other tabs.")); return; }
    const row = (...cells: (string | Node)[]) => h("tr", "", ...cells.map((c) => h("td", "", c)));
    const head = h("tr", "", ...["Part", "Value", "Count", "Footprint", "Part number", "Where"].map((t) => h("th", "", t)));
    this.parts.replaceChildren(h("table", "sheet-bom", h("thead", "", head), h("tbody", "", ...s.lines.map((l) => {
      const tr = row(l.part, l.value, String(l.count), l.footprint, l.mpn ? Object.assign(h("span", "", l.mpn), { title: l.maker }) : "", l.refs.join(" "));
      tr.classList.toggle("socketed", l.socketed); tr.classList.toggle("swapped", l.swapped);
      if (l.socketed) tr.title = l.swapped ? "In a socket: your swap" : "In a socket";
      return tr;
    }))));
  }

  private drawFiles(s: Sheet): void {
    if (!s.made) { this.files.replaceChildren(h("p", "sheet-empty", "The fab files are not made yet.")); return; }
    this.files.replaceChildren(h("ul", "sheet-layers", ...s.layers.map((l) => h("li", "", icon("file-text", 14), h("span", "", l)))));
  }
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (Node | string)[]) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};

/** The band as a chart: frequency (log) across, gain in dB up, the builds' band shaded and the sim as a line. */
function bandChart(b: Band): SVGSVGElement {
  const W = 640, H = 220, L = 44, R = 12, T = 10, B = 26;
  const top = Math.ceil((Math.max(...b.hi) + 1) / 6) * 6, bottom = Math.floor((Math.min(...b.lo) - 1) / 6) * 6;
  const x = (hz: number) => L + ((Math.log(hz) - Math.log(b.hz[0])) / (Math.log(b.hz.at(-1)!) - Math.log(b.hz[0]))) * (W - L - R);
  const y = (dB: number) => T + ((top - dB) / (top - bottom)) * (H - T - B);
  const pts = (v: number[]) => v.map((d, i) => `${x(b.hz[i]).toFixed(1)},${y(d).toFixed(1)}`);
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "band-chart", role: "img", "aria-label": `Frequency response, the sim and its tolerance band: within ${widest(b).toFixed(1)} dB` });
  for (let dB = bottom; dB <= top; dB += 6) chart.append(svg("line", { x1: L, x2: W - R, y1: y(dB), y2: y(dB), class: "grid" }), svg("text", { x: L - 6, y: y(dB) + 4, "text-anchor": "end" }, `${dB}`));
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) chart.append(svg("line", { x1: x(hz), x2: x(hz), y1: T, y2: H - B, class: "grid" }), svg("text", { x: x(hz), y: H - 8, "text-anchor": "middle" }, hz >= 1000 ? `${hz / 1000}k` : `${hz}`));
  chart.append(
    svg("polygon", { points: [...pts(b.hi), ...pts(b.lo).reverse()].join(" "), class: "band" }),
    svg("polyline", { points: pts(b.sim).join(" "), class: "sim" }),
    svg("text", { x: L, y: H - 8, "text-anchor": "start", class: "unit" }, "Hz"),
    svg("text", { x: 4, y: T + 8, class: "unit" }, "dB"),
  );
  return chart;
}
