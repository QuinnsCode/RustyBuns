// A pedal's build sheet: its schematic and board (Q Amp's BoardView), its parts list with the player's swaps, the
// Gerber layers, and one button for the zip a builder needs. Opened from a pedal on the gear room's wall or in hand
// (room/main.ts) and from Q Amp's board view (amp/main.ts). Kits are found by folder: whatever `circuits/<kit>/`
// holds is loaded only when its sheet opens, so a new kit shows up with no change here.
import "./sheet.css";
import { check, obj, or, rec, str } from "@rustybuns/util/guard";
import type { PedalDef } from "../circuit/amps.ts";
import type { Swaps } from "../circuit/circuits.ts";
import { BoardView, svgOf, type Side } from "../amp/board.ts";
import { h, iconButton } from "../amp/dom.ts";
import { icon } from "../amp/icons.ts";
import { kitZip, sheetOf, type KitFiles, type Sheet } from "./kit.ts";

// Every file under a kit folder, as text, fetched only when asked for.
const KITS = import.meta.glob<string>("../../circuits/*/**/*", { query: "?raw", import: "default" });
const ROOT = "../../circuits/";

/** The files in `circuits/<kit>/`, by path inside it; none if the folder isn't there. */
export async function kitFiles(kit: string): Promise<KitFiles> {
  const at = `${ROOT}${kit}/`, out: KitFiles = {};
  await Promise.all(Object.entries(KITS).filter(([p]) => p.startsWith(at)).map(async ([p, load]) => { out[p.slice(at.length)] = await load(); }));
  return out;
}

/** Q Amp keeps each pedal's part swaps in its saved state ("q-amp"): read them, and nothing else, through a guard. */
const AmpSwaps = obj({ swaps: or(rec(rec(str(12), 40), 10), {}) });
export function savedSwaps(pedal: string): Swaps {
  try {
    const raw = localStorage.getItem("q-amp");
    return (raw && check(AmpSwaps, JSON.parse(raw))?.swaps[pedal]) || {};
  } catch { return {}; }
}

type Tab = Side | "parts" | "files";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "schematic", label: "Schematic", icon: "workflow" },
  { id: "pcb", label: "Circuit board", icon: "circuit-board" },
  { id: "parts", label: "Parts list", icon: "list" },
  { id: "files", label: "Board files (Gerbers)", icon: "folder" },
];

export class BuildSheet {
  readonly el = h("section", "build-sheet");
  private readonly title = h("span", "sheet-title");
  private readonly note = h("span", "sheet-note");
  private readonly board = new BoardView(() => {});
  private readonly parts = h("div", "sheet-parts");
  private readonly files = h("div", "sheet-files");
  private readonly tabs: HTMLButtonElement[];
  private readonly save: HTMLButtonElement;
  private tab: Tab = "schematic";
  private sheet: Sheet | null = null;
  private kit: KitFiles = {};
  private def: PedalDef | null = null;
  private swaps: Swaps = {};
  private asked = 0;

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
      this.board.el, this.parts, this.files,
    );
    this.el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } });
  }

  /** Open `pedal`'s sheet with the player's `swaps` on it; resolves once its kit has loaded. */
  async open(pedal: PedalDef, swaps: Swaps): Promise<Sheet> {
    const ask = ++this.asked;
    this.def = pedal; this.swaps = swaps;
    this.el.hidden = false;
    this.title.textContent = pedal.name;
    this.note.textContent = "loading";
    const kit = await kitFiles(sheetOf(pedal, {}).kit);
    const sheet = sheetOf(pedal, kit, swaps);
    if (ask !== this.asked) return sheet; // opened another while this loaded
    this.kit = kit; this.sheet = sheet;
    const swapped = sheet.parts.filter((p) => p.swapped).length;
    this.note.textContent = !sheet.made ? "fab files not made yet" : swapped ? `your version · ${swapped} part${swapped > 1 ? "s" : ""} swapped` : "stock parts";
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
    this.sheet = null;
    this.onClose();
  }

  /** What an agent reads: the open sheet, its tab, its parts and layers. */
  state(): { open: string | null; tab: Tab; made: boolean; parts: Sheet["lines"]; layers: string[] } | null {
    const s = this.sheet;
    return s && !this.el.hidden ? { open: s.pedal, tab: this.tab, made: s.made, parts: s.lines, layers: s.layers } : null;
  }

  /** The kit as a zip, saved as `<kit>-kit.zip`; its name and the paths in it. */
  async download(): Promise<{ name: string; bytes: number } | null> {
    const s = this.sheet, def = this.def;
    if (!s?.made || !def?.board) return null;
    const zipped = kitZip(this.kit, s.text, await svgOf(def.board, "schematic"), s.parts);
    const name = `${s.kit}-kit.zip`, url = URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));
    const a = h("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { name, bytes: zipped.length };
  }

  show(tab: Tab): void {
    this.tab = tab;
    this.tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(TABS[i].id === tab)));
    const def = this.def, drawing = tab === "schematic" || tab === "pcb";
    this.board.el.hidden = !drawing; this.parts.hidden = tab !== "parts"; this.files.hidden = tab !== "files";
    if (!drawing || !def) return;
    if (!def.board) { this.board.blank(def.name, "this pedal has no board drawn yet"); return; }
    const pcb = this.kit["pcb.svg"];
    this.board.show(def.board, def.name, this.swaps, {
      readOnly: true, hint: pcb ? "the fab board" : "the circuit as played",
      pcb: pcb ? () => Promise.resolve(pcb) : undefined,
    });
    this.board.view(tab);
  }

  private drawParts(s: Sheet): void {
    if (!s.made) { this.parts.replaceChildren(h("p", "sheet-empty", "This pedal's fab files are not made yet, so there is no parts list. Its schematic and board are in the other tabs.")); return; }
    const row = (...cells: (string | Node)[]) => h("tr", "", ...cells.map((c) => h("td", "", c)));
    const head = h("tr", "", ...["Part", "Value", "Count", "Footprint", "Where"].map((t) => h("th", "", t)));
    this.parts.replaceChildren(h("table", "sheet-bom", h("thead", "", head), h("tbody", "", ...s.lines.map((l) => {
      const tr = row(l.part, l.value, String(l.count), l.footprint, l.refs.join(" "));
      tr.classList.toggle("socketed", l.socketed); tr.classList.toggle("swapped", l.swapped);
      if (l.socketed) tr.title = l.swapped ? "In a socket: your swap" : "In a socket";
      return tr;
    }))));
  }

  private drawFiles(s: Sheet): void {
    if (!s.made) { this.files.replaceChildren(h("p", "sheet-empty", "This pedal's fab files are not made yet.")); return; }
    this.files.replaceChildren(h("ul", "sheet-layers", ...s.layers.map((l) => h("li", "", icon("file-text", 14), h("span", "", l)))));
  }
}
