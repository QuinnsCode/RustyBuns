// The jam room's Settings (#6420): the only place a gathering's setup changes. Two tabs. The gathering is the owner's
// alone (a guest never sees it): the picked studio on a third of the width, then Studio and Speakers as plain text
// lists in their own scroll boxes (a gamepad walks them), what the tops sit on, and who can come in; a change goes on
// the sesh, so it reaches everyone in the room. You is everyone's: the font (this viewer only, kept in this browser),
// and Character, Controls, Plug in and Sound, which the entry panel's old buttons did.
import { SYSTEM_IDS, SYSTEMS, type SystemId } from "@rustybuns/gear";
import { DOORS, TOPS, type Door, type Tops } from "../project.ts";
import type { Studio } from "./door.ts";
import { shot } from "./picker.ts";

/** The 20 fonts on the owner's font board, Saira Condensed (the default) first. Small text stays Inter whichever is picked. */
export const FONTS = ["Saira Condensed", "Barlow Condensed", "Inter", "Space Grotesk", "Oswald", "Bebas Neue", "Anton", "Teko", "Rajdhani",
  "Archivo Narrow", "Chakra Petch", "Orbitron", "Righteous", "Bungee", "Press Start 2P", "Space Mono", "DM Sans", "Outfit", "Fraunces", "Permanent Marker"] as const;
export const DEFAULT_FONT = FONTS[0];
const FONT_KEY = "qollab-studio:font";

/** The font this browser picked for headings and buttons, or the default. */
export function loadFont(): string {
  try { const f = localStorage.getItem(FONT_KEY); return f && FONTS.some((x) => x === f) ? f : DEFAULT_FONT; } catch { return DEFAULT_FONT; }
}
/** Wear `font` on this page (the `--qs-head` the jam room's CSS reads) and keep it for next time. */
export function wearFont(font: string, keep = true) {
  document.documentElement.style.setProperty("--qs-head", `"${font}"`);
  if (keep) try { localStorage.setItem(FONT_KEY, font); } catch { /* worn for this page only */ }
}

export const TOPS_WORDS: Record<Tops, string> = { subs: "The subs", pole: "A pole over the subs", stands: "Their own stands" };
const TOPS_CHIP: Record<Tops, string> = { subs: "tops on the subs", pole: "tops on poles", stands: "tops on stands" };
export const DOOR_WORDS: Record<Door, string> = { link: "Anyone with the link", friends: "My friends", list: "Guest list only" };
/** One short line per rig, no spec sheet. */
const RIG_LINES: Record<SystemId, string> = {
  "dance-stack": "Punchy, forward, throws far", synergy: "Flat, coherent, very low", sculpted: "Deep floor, sweet open top",
  "tri-amp": "Mid-forward, long-throwing", "line-array": "Very wide and even",
};
/** One short line per studio, no paragraph: the mockup's for the rooms it named, else the first clause of its `about`. */
const STUDIO_LINES: Record<string, string> = {
  "desert-gathering": "Open air under a full moon: a booth on the sand, fire, vans, a crowd",
  "sound-stage": "Late-night TV studio: band riser, host desk, lights overhead",
  "live-room": "Our own room: wood floor, brick wall, tile ceiling",
  "console-room": "A big analog desk, racks of gear, monitors, a couch",
  "desk-concert": "A band crammed behind an office desk, shelves all round",
  "orchestra-room": "Huge wooden room, a balcony, a grand piano",
  "scoring-hall": "Tall wood hall for film scores, curtains for the ring",
  basement: "Concrete walls, a rug, a dry drum booth",
  "stone-room": "Stone and brick, a booming kit",
  barn: "Old wooden barn, high rafters, warm",
};
export const studioLine = (s: Pick<Studio, "id" | "about">) => STUDIO_LINES[s.id] ?? s.about.split(/[.:;]/)[0]?.trim() ?? "";

/** The gathering as it stands: the sesh's choices, with what the room shows when the owner hasn't picked yet. */
export interface Setup { studio: string; rig: SystemId | null; tops: Tops; door: Door }
export type Tab = "room" | "you";
export interface SettingsDeps {
  /** May this viewer change the gathering (the owner, or alone in an offline room)? */
  owner(): boolean;
  setup(): Setup;
  studios(): Studio[];
  pickStudio(id: string): void;
  pickRig(id: SystemId): void;
  pickSetup(s: { tops?: Tops; door?: Door }): void;
  /** Also yours: what each row does, and its line (Plug in says Unplug once plugged). */
  mine: { name: string; line(): string; act(): void }[];
  onClose(): void;
}

const $ = (id: string) => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} is missing`); return e; };
function row(name: string, line: string, on: boolean, pick: () => void, font?: string) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "set-row"; b.setAttribute("aria-pressed", String(on));
  const n = document.createElement("b"); n.textContent = name;
  if (font) n.style.fontFamily = `"${font}", sans-serif`;
  b.append(n);
  if (line) { const l = document.createElement("small"); l.textContent = line; b.append(l); }
  b.addEventListener("click", pick);
  return b;
}
function chip(name: string, on: boolean, pick: () => void) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "set-chip"; b.setAttribute("aria-pressed", String(on)); b.textContent = name;
  b.addEventListener("click", pick);
  return b;
}
/** Fill `host` with `kids`, keeping its scroll (a pick redraws the list under the pointer). */
function fill(host: HTMLElement, kids: HTMLElement[]) { const top = host.scrollTop; host.replaceChildren(...kids); host.scrollTop = top; }

/** Settings over the room (the #settings section in jam.html): open, close, redraw when the sesh changes. */
export function mountSettings(d: SettingsDeps) {
  let tab: Tab = "you", font = loadFont();
  wearFont(font, false);
  const box = $("settings");
  const isOpen = () => !box.hidden;
  function render() {
    if (!isOpen()) return;
    const owner = d.owner();
    if (!owner) tab = "you";
    $("tab-room").hidden = !owner;
    for (const [id, t] of [["tab-room", "room"], ["tab-you", "you"]] as const) $(id).setAttribute("aria-selected", String(tab === t));
    $("set-room").hidden = tab !== "room";
    $("set-you").hidden = tab !== "you";
    if (tab === "room") room(); else you();
  }
  function room() {
    const s = d.setup(), list = d.studios(), here = list.find((x) => x.id === s.studio) ?? list[0];
    if (here) {
      $("set-shot").replaceChildren(shot(here.def));
      $("set-studio-name").textContent = here.name;
      $("set-studio-about").textContent = here.about;
    }
    const outdoor = !!here?.def.outdoor;
    $("set-chip-rig").hidden = !outdoor || !s.rig;
    $("set-chip-rig").textContent = s.rig ? `${SYSTEMS[s.rig].name}, ${TOPS_CHIP[s.tops]}` : "";
    $("set-chip-door").textContent = DOOR_WORDS[s.door];
    fill($("set-studios"), list.map((x) => row(x.name, studioLine(x), x.id === s.studio, () => d.pickStudio(x.id))));
    // speakers stand out of doors only: a room indoors has its own
    $("set-speakers").hidden = !outdoor;
    fill($("set-rigs"), SYSTEM_IDS.map((id) => row(SYSTEMS[id].name, RIG_LINES[id], id === s.rig, () => d.pickRig(id))));
    fill($("set-tops"), TOPS.map((t) => chip(TOPS_WORDS[t], t === s.tops, () => d.pickSetup({ tops: t }))));
    fill($("set-doors"), DOORS.map((x) => chip(DOOR_WORDS[x], x === s.door, () => d.pickSetup({ door: x }))));
  }
  function you() {
    $("set-font-name").textContent = font === DEFAULT_FONT ? `${font} (the default)` : font;
    fill($("set-fonts"), FONTS.map((f) => row(f, "", f === font, () => { font = f; wearFont(f); render(); }, f)));
    fill($("set-mine"), d.mine.map((m) => row(m.name, m.line(), false, m.act)));
  }
  function open(want: Tab = d.owner() ? "room" : "you") { tab = want; box.hidden = false; render(); ($(tab === "room" ? "tab-room" : "tab-you")).focus(); }
  function close() { if (!isOpen()) return; box.hidden = true; d.onClose(); }
  $("tab-room").addEventListener("click", () => { tab = "room"; render(); });
  $("tab-you").addEventListener("click", () => { tab = "you"; render(); });
  $("settings-done").addEventListener("click", close);
  return {
    open, close, isOpen, render,
    /** For the harness: which tabs show, the one open, and the picks as they stand. */
    state: () => ({ open: isOpen(), tab, tabs: d.owner() ? ["room", "you"] : ["you"], font, setup: d.setup() }),
  };
}
