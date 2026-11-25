// Qollab Studio's six paths (PATHWAYS.md), as the front door (/door.html) names them: each one's icon, short name,
// what you do there, and the page it opens on, at that path's first step. Pure: the page is src/front.ts.

export type PathId = "learn" | "track" | "jam" | "dj" | "plan" | "circuit";
export interface Path {
  id: PathId;
  /** The short name on its card (one line at every size). */
  name: string;
  /** What you do there, in one line. */
  does: string;
  /** The page it opens on: the path's first step. */
  href: string;
  /** What that first step is, for the card's title and the journey test. */
  first: string;
  /** Asks you to sign in (with eqosys) before you can start: only the jam room, which is a room you share. */
  signIn: boolean;
  /** A Lucide icon's inner SVG (ISC). */
  icon: string;
}

/** The front door's address, which every page's way back opens. */
export const DOOR = "/door.html";

// lucide (ISC): graduation-cap, audio-lines, users, disc-3, speaker, circuit-board
export const PATHS: readonly Path[] = [
  {
    id: "learn", name: "Learn the setup", does: "Plug a guitar into an amp and hear what each cable and knob does.",
    href: "/studio.html", first: "The gear room: the guitar on its stand, the amps on the rack", signIn: false,
    icon: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  },
  {
    id: "track", name: "Make a track", does: "Press Space and the beat plays: play notes, record, bounce it to a file.",
    href: "/", first: "The desk with the demo beat loaded", signIn: false,
    icon: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  },
  {
    id: "jam", name: "Jam with friends", does: "Make a room, send the link, and play together on the same beat.",
    href: "/jam.html", first: "The jam room's lobby: make a room", signIn: true,
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  },
  {
    id: "dj", name: "DJ a set", does: "Two decks and a mixer with two demo tracks on them: sync, cue, loop, scratch.",
    href: "/decks.html", first: "The decks with the demo tracks", signIn: false,
    icon: '<circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>',
  },
  {
    id: "plan", name: "Plan a sound system", does: "Draw the room, pick its walls and rig, and hear it ring from every seat.",
    href: "/rooms.html", first: "The studio builder", signIn: false,
    icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>',
  },
  {
    id: "circuit", name: "Build the circuit", does: "Play an amp and pedals solved as real circuits, swap parts, download the kit.",
    href: "/amp.html", first: "Q Amp", signIn: false,
    icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M11 9h4a2 2 0 0 0 2-2V3"/><circle cx="9" cy="9" r="2"/><path d="M7 21v-4a2 2 0 0 1 2-2h4"/><circle cx="15" cy="15" r="2"/>',
  },
];

/** A Lucide icon as an inline SVG at `size` px. */
export const iconSvg = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// lucide (ISC): door-open
export const DOOR_OPEN = '<path d="M10 21H2"/><path d="M10 3H7a2 2 0 0 0-2 2v16"/><path d="M14 12h.01"/><path d="M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992z"/><path d="M22 21h-3"/>';
