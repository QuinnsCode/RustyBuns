// What you can do in the jam room, as data (#5395): the "What you can do here" card (help.ts), the key strip by the
// hint, and the menu's keys table all read this one list, so they can't disagree. Pure: no DOM, no three.
import type { SpotKind } from "./room.ts";

/** Where you are in the room: walking about, seated at an instrument (or a seat), or seated at the desk. */
export type Where = "walk" | "seat" | "desk";
export const WHERE: Record<Where, string> = { walk: "Walking", seat: "Seated at an instrument", desk: "At the desk, or anywhere" };

export type Action = {
  /** The key or keys, as the strip and the card print them. */
  key: string;
  /** What it does, in a few words. */
  does: string;
  /** A lucide icon's name (src/amp/icons.ts). */
  icon: string;
  where: Where;
  /** Seated: only at these kinds of spot (left out: every one). */
  at?: SpotKind[];
  /** On the key strip, in this order (left out: only on the card), as `short`. */
  strip?: number;
  short?: string;
  /** The menu's keys table words, when they differ from `does`. */
  table?: string;
};

const PLAYED: SpotKind[] = ["keys", "bass"];
export const ACTIONS: Action[] = [
  { key: "WASD", does: "Walk (or the left stick)", icon: "move", where: "walk", table: "Walk" },
  { key: "Mouse", does: "Look (or the right stick)", icon: "eye", where: "walk", table: "Look" },
  { key: "Space", does: "Sit at the instrument or seat in front of you", icon: "armchair", where: "walk", strip: 1, short: "sit", table: "Sit at a spot, stand up" },
  { key: "I", does: "Plug in your guitar (in the vocal booth, your mic)", icon: "guitar", where: "walk", strip: 2, short: "guitar" },
  { key: "Q", does: "Picture quality, high or low", icon: "monitor", where: "walk" },
  { key: "Tab", does: "The instrument's panel: patch, EQ, mixer strip, notes", icon: "sliders-horizontal", where: "seat", at: [...PLAYED, "drums"], strip: 1, short: "the instrument's panel" },
  { key: "A to '", does: "Play notes; Shift plays louder", icon: "keyboard-music", where: "seat", at: PLAYED },
  { key: "A to L", does: "The drums, kick first", icon: "keyboard-music", where: "seat", at: ["drums"] },
  { key: "Z / X", does: "Octave down, up", icon: "arrow-up-down", where: "seat", at: PLAYED, strip: 2, short: "octave" },
  { key: "/", does: "Show or hide the keys' notes", icon: "eye", where: "seat", at: PLAYED, strip: 3, short: "the keys' notes" },
  { key: "Up / Down", does: "Pitch bend", icon: "activity", where: "seat", at: PLAYED },
  { key: "[ / ]", does: "Mod wheel: vibrato", icon: "waves", where: "seat", at: PLAYED },
  { key: "I", does: "Plug in your mic: your voice, straight to everyone", icon: "mic", where: "seat", at: ["booth"], strip: 1, short: "mic" },
  { key: "Space", does: "Stand up", icon: "armchair", where: "seat", strip: 9, short: "stand up" },
  { key: "Enter", does: "The groove and its click, for everyone", icon: "play", where: "desk", strip: 1, short: "groove" },
  { key: "C", does: "Hear the band a loop late, as it comes, or (the leader) at the desk", icon: "headphones", where: "desk", strip: 2, short: "how you hear it" },
  { key: "H", does: "Raise your hand to play", icon: "hand", where: "desk" },
  { key: "N", does: "Mute the room, for you", icon: "volume-x", where: "desk" },
  { key: "B", does: "Mute who you look at, for you", icon: "volume-x", where: "desk" },
  { key: "M", does: "Speakers up", icon: "volume-2", where: "desk" },
  { key: "V", does: "Over the shoulder or first person", icon: "switch-camera", where: "desk" },
  { key: "?", does: "This card", icon: "circle-help", where: "desk", strip: 8, short: "help" },
  { key: "Esc", does: "The menu: who's here, the studio (the leader switches it), the invite link", icon: "door-open", where: "desk", strip: 9, short: "menu", table: "Let go of the mouse: the menu" },
];

/** Things you'd look for here that aren't built in the jam room yet: where they are today, and the issue. */
export const NOT_YET: { what: string; today: string; issue: number }[] = [
  { what: "Pedals, amps and cables", today: "In the gear room for now (Gear room, top of the page)", issue: 5393 },
  { what: "The full mixer", today: "Tab at an instrument has its one strip; the whole desk is on Desk (top of the page)", issue: 5394 },
];

/** Where a seat puts you: nowhere (walking), at the desk, or at an instrument or seat. */
export const whereAt = (seat: SpotKind | null): Where => (seat === null ? "walk" : seat === "desk" ? "desk" : "seat");

const fits = (a: Action, seat: SpotKind | null) => !a.at || seat === null || a.where !== "seat" || a.at.includes(seat);

/** The key strip by the hint: the few keys for what you're doing now, then ? and Esc (Space at the end when seated). */
export function strip(seat: SpotKind | null): Action[] {
  const here = whereAt(seat);
  // strip 8 and up are always on: ? and Esc anywhere, Stand up wherever you sit (the desk too)
  const on = (a: Action, n: number) => fits(a, seat) && (a.where === here || (n >= 8 && (a.where === "desk" || here !== "walk")));
  return ACTIONS.filter((a) => a.strip !== undefined && on(a, a.strip)).sort((a, b) => (a.strip ?? 0) - (b.strip ?? 0));
}

/** The card: every group, the one you're in first and marked, its lines fitted to the spot you sit at. */
export function card(seat: SpotKind | null): { where: Where; title: string; here: boolean; actions: Action[] }[] {
  const here = whereAt(seat), order: Where[] = [here, ...(["walk", "seat", "desk"] as const).filter((w) => w !== here)];
  return order.map((w) => ({ where: w, title: WHERE[w], here: w === here, actions: ACTIONS.filter((a) => a.where === w && (w !== "seat" || fits(a, here === "seat" ? seat : null))) }));
}

/** The menu's keys table (game-controls' Controls): every key once, with where it works. */
export function keysTable(): [string, string][] {
  const seen = new Set<string>(), rows: [string, string][] = [];
  for (const a of ACTIONS) {
    const key = a.where === "seat" ? `${a.key} (seated)` : a.key;
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    rows.push([key, a.table ?? a.does]);
  }
  return rows;
}
