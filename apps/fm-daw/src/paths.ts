// Qollab Studio's three words and seven sectors (PATHWAYS.md), as the front door (/door.html) names them: LEARN,
// BUILD and PLAY, and under each its sectors with an icon, a short name, what you do there, and the page it opens on,
// at that sector's first step. Pure: the page is src/front.ts.

export type SectorId = "learn" | "build" | "play";
export interface Sector {
  id: SectorId;
  /** The word over its row of cards. */
  word: string;
  /** What that word is for, in one line. */
  line: string;
}

/** The front door's three words, in the order it shows them. */
export const SECTORS: readonly Sector[] = [
  { id: "learn", word: "Learn", line: "How to set it up and how to use it, checked on the real gear as you go." },
  { id: "build", word: "Build", line: "Plan the event, make the track, play the instruments, build the amp and its circuit." },
  { id: "play", word: "Play", line: "Take what you built live: a place your friends walk into and hear." },
];

export type PathId = "learn" | "planner" | "daw" | "instruments" | "amps" | "builder" | "event";
export interface Path {
  id: PathId;
  /** The word it sits under. */
  sector: SectorId;
  /** The short name on its card (one line at every size). */
  name: string;
  /** What you do there, in one line. */
  does: string;
  /** The page it opens on: the path's first step. */
  href: string;
  /** What that first step is, for the card's title and the journey test. */
  first: string;
  /** Asks you to sign in (with eqosys) before you can start: only the event, which is a room you share. */
  signIn: boolean;
  /** A Lucide icon's inner SVG (ISC). */
  icon: string;
}

/** The front door's address, which every page's way back opens. */
export const DOOR = "/door.html";

// lucide (ISC): graduation-cap, tent, audio-lines, piano, speaker, circuit-board, users
export const PATHS: readonly Path[] = [
  {
    id: "learn", sector: "learn", name: "Learn the setup", does: "Plug a guitar into an amp, patch a synth, set up a PA, and hear what each cable and knob does.",
    href: "/studio.html", first: "The gear room: the guitar on its stand, the amps on the rack", signIn: false,
    icon: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  },
  {
    id: "planner", sector: "build", name: "Event Planner", does: "Draw the room or the field, place and aim the stacks, see the coverage, the power and the gear list.",
    href: "/rooms.html", first: "The studio builder", signIn: false,
    icon: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  },
  {
    id: "daw", sector: "build", name: "QDAW", does: "Press Space and the beat plays: play notes, record, mix, bounce it to a file.",
    href: "/", first: "The desk with the demo beat loaded", signIn: false,
    icon: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  },
  {
    id: "instruments", sector: "build", name: "Q Instruments", does: "Two decks and a mixer with demo tracks on them: sync, cue, loop, scratch.",
    href: "/decks.html", first: "The decks with the demo tracks", signIn: false,
    icon: '<path d="M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8"/><path d="M2 14h20"/><path d="M6 14v4"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/>',
  },
  {
    id: "amps", sector: "build", name: "Q Amps", does: "Play an amp and pedals solved as real circuits as you play.",
    href: "/amp.html", first: "Q Amp", signIn: false,
    icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>',
  },
  {
    id: "builder", sector: "build", name: "Q Builder", does: "Open a pedal's board, swap its parts, scope any net, remake it in tscircuit and retest it.",
    href: "/builder.html", first: "Q Builder: the fuzz's board with a scope on it", signIn: false,
    icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M11 9h4a2 2 0 0 0 2-2V3"/><circle cx="9" cy="9" r="2"/><path d="M7 21v-4a2 2 0 0 1 2-2h4"/><circle cx="15" cy="15" r="2"/>',
  },
  {
    id: "event", sector: "play", name: "The Event", does: "Make a room, send the link, and play together through the room's PA.",
    href: "/jam.html", first: "The jam room's lobby: make a room", signIn: true,
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  },
];

/** A Lucide icon as an inline SVG at `size` px. */
export const iconSvg = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// lucide (ISC): door-open
export const DOOR_OPEN = '<path d="M10 21H2"/><path d="M10 3H7a2 2 0 0 0-2 2v16"/><path d="M14 12h.01"/><path d="M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992z"/><path d="M22 21h-3"/>';
