// Qollab Studio's three lanes and their apps (PATHWAYS.md), as the front door (/door.html) names them: LEARN, STUDIO
// (everything before an event) and EVENT (the live show), and under each its apps with an icon, a short name, what you
// do there, and the page it opens on, at that app's first step. Pure: the page is src/front.ts.

export type SectorId = "learn" | "studio" | "event";
export interface Sector {
  id: SectorId;
  /** The word over its row of cards. */
  word: string;
  /** What that word is for, in one line. */
  line: string;
  /** The words a "Build your ___" line rolls through, each with the app that builds it. */
  rolls?: readonly (readonly [string, PathId])[];
  /** The word of `line` given weight. */
  weigh?: string;
  /** The lane's one way in for someone new: two or three words, an icon, and where it lands. */
  start: { say: string; href: string; icon: string };
}

/** Studio's way in: a room of your own in the live room, sat at the keys (src/studio/main.ts reads `start`). */
export const STUDIO_START = "/jam.html?start=keys";
// lucide (ISC): play, piano, ticket
const PLAY = '<polygon points="6 3 20 12 6 21 6 3"/>';
const PIANO = '<path d="M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8"/><path d="M2 14h20"/><path d="M6 14v4"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/>';
const TICKET = '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>';

/** The front door's three lanes, in the order it shows them. */
export const SECTORS: readonly Sector[] = [
  { id: "learn", word: "Learn", line: "How to set it up and how to use it, checked on the real gear as you go.", start: { say: "First lesson", href: "/studio.html", icon: PLAY } },
  // the owner's copy (#6527): Studio's line is a console prompt whose last word rolls through what you build, each word
  // opening the app that builds it; `line` is the one still sentence a screen reader gets
  { id: "studio", word: "Studio", line: "Build your set, speaker, signal, pedal, song or plugin.", rolls: [["set", "instruments"], ["speaker", "speakers"], ["signal", "planner"], ["pedal", "amps"], ["song", "daw"], ["plugin", "builder"]], start: { say: "Walk in and play", href: STUDIO_START, icon: PIANO } },
  { id: "event", word: "Event", line: "Take your studio pieces to a 3D hangout and experience the sound and the worlds.", weigh: "experience", start: { say: "Host or join", href: "/rooms.html#party", icon: TICKET } },
];

export type PathId = "learn" | "planner" | "daw" | "instruments" | "amps" | "builder" | "speakers" | "playground" | "event";
export interface Path {
  id: PathId;
  /** The lane it sits under. */
  sector: SectorId;
  /** The short name on its card (one line at every size). */
  name: string;
  /** What's in it, a few words each, under its name on the lane's card. */
  features: string;
  /** What you do there, in one line. */
  does: string;
  /** The page it opens on: the path's first step. */
  href: string;
  /** What that first step is, for the card's title and the journey test. */
  first: string;
  /** Asks you to sign in (with eqosys) before you can start: the Playground and The Event, each a room you share. */
  signIn: boolean;
  /** A Lucide icon's inner SVG (ISC). */
  icon: string;
}

/** The front door's address, which every page's way back opens. */
export const DOOR = "/door.html";

// lucide (ISC): graduation-cap, tent, audio-lines, disc-3, speaker, circuit-board, volume-2, users, ticket
export const PATHS: readonly Path[] = [
  {
    id: "learn", sector: "learn", name: "Learn the setup", features: "Guitar into an amp · patch a synth · set up a PA · know your plugs", does: "Plug a guitar into an amp, patch a synth, set up a PA, and hear what each cable and knob does.",
    href: "/studio.html", first: "The gear room: the guitar on its stand, the amps on the rack", signIn: false,
    icon: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  },
  {
    id: "planner", sector: "studio", name: "Event Planner", features: "Coverage and aim · delay · power · gear list", does: "Draw the room or the field, place and aim the stacks, see the coverage, the power and the gear list.",
    href: "/rooms.html", first: "The studio builder", signIn: false,
    icon: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  },
  {
    id: "daw", sector: "studio", name: "QDAW", features: "Play · record · mix · bounce to a file", does: "Press Space and the beat plays: play notes, record, mix, bounce it to a file.",
    href: "/desk", first: "The desk with the demo beat loaded", signIn: false,
    icon: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  },
  {
    id: "instruments", sector: "studio", name: "Q Instruments", features: "Two decks and a mixer · sync, cue, loop, scratch", does: "Two decks and a mixer with demo tracks on them: sync, cue, loop, scratch.",
    href: "/decks.html", first: "The decks with the demo tracks", signIn: false,
    icon: '<circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>',
  },
  {
    id: "amps", sector: "studio", name: "Q Amps", features: "Amp and pedals solved as real circuits", does: "Play an amp and pedals solved as real circuits as you play.",
    href: "/amp.html", first: "Q Amp", signIn: false,
    icon: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>',
  },
  {
    id: "builder", sector: "studio", name: "Q Builder", features: "Swap parts · scope any net · remake and retest", does: "Open a pedal's board, swap its parts, scope any net, remake it in tscircuit and retest it.",
    href: "/builder.html", first: "Q Builder: the fuzz's board with a scope on it", signIn: false,
    icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M11 9h4a2 2 0 0 0 2-2V3"/><circle cx="9" cy="9" r="2"/><path d="M7 21v-4a2 2 0 0 1 2-2h4"/><circle cx="15" cy="15" r="2"/>',
  },
  {
    id: "speakers", sector: "studio", name: "Speakers", features: "Makers' drawings · sizes, drivers, cut sheets", does: "Speaker boxes from the makers' drawings: their sizes, drivers and cut sheets.",
    href: "/speakers.html", first: "Speaker Plans", signIn: false,
    icon: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  },
  {
    id: "playground", sector: "studio", name: "Playground", features: "Your own room · invite link · jam with friends", does: "Your own sesh: make a room in your studio, send the link, and friends drop in to jam.",
    href: "/jam.html", first: "The jam room's lobby: make a room", signIn: true,
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  },
  {
    id: "event", sector: "event", name: "The Event", features: "Guest list · performers on the stacks · a listen link for the crowd", does: "The live show: take a planned party live, with its guest list and a listen link for the crowd.",
    href: "/rooms.html#party", first: "The Event Planner's Party panel: open as event", signIn: true,
    icon: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  },
];

/** A Lucide icon as an inline SVG at `size` px. */
export const iconSvg = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// lucide (ISC): door-open
export const DOOR_OPEN = '<path d="M10 21H2"/><path d="M10 3H7a2 2 0 0 0-2 2v16"/><path d="M14 12h.01"/><path d="M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992z"/><path d="M22 21h-3"/>';

/** The landing page's pedal-to-show chain (#6019): one idea carried through the apps, each step a path's door. */
export const CHAIN: readonly { step: string; does: string; path: PathId }[] = [
  { step: "Build it", does: "Swap the parts on a pedal's board in Q Builder.", path: "builder" },
  { step: "Play it", does: "Plug in and play it through Q Amp, solved as a circuit.", path: "amps" },
  { step: "Record it", does: "Lay the take down in QDAW and loop it.", path: "daw" },
  { step: "Plan the stage", does: "Place the stacks on the field and see who hears what.", path: "planner" },
  { step: "Play it live", does: "Take the planned party live; the crowd walks in and hears it.", path: "event" },
];

/** What works end to end today (PATHWAYS.md's table), a line an app. */
export const LIVE: readonly { path: PathId; line: string }[] = [
  { path: "planner", line: "Coverage, delay, power and the gear list, indoors and out over the night's air, the ground and banks." },
  { path: "learn", line: "Four lessons at the gear wall, checked on the gear as you go." },
  { path: "daw", line: "A loop at a time: play, record, mix and bounce it to a file." },
  { path: "instruments", line: "Two decks into the room, to a file, or out on a listen link." },
  { path: "amps", line: "An amp and pedals solved as circuits." },
  { path: "speakers", line: "Speaker boxes from the makers' drawings." },
  { path: "playground", line: "An invite link, a guest list, and the room's PA from where you stand." },
  { path: "event", line: "A planned party live from the Event Planner, on its stacks, with a listen link for the crowd." },
];

/** Two short pitches, for crews and for classes, each with its path's icon and door. */
export const PITCHES: readonly { who: string; line: string; path: PathId }[] = [
  { who: "For crews", line: "Know the field covers before the night: place the stacks, set the air and the ground, see where the highs drop, and take the power plan and the gear list with you.", path: "planner" },
  { who: "For classes", line: "Cabling, gain staging, a PA and a circuit, learned on gear that can't break: each step checked as you go, no account needed.", path: "learn" },
];

// lucide (ISC): thermometer, droplets, mountain, play, pause, headphones, arrow-right, check
export const ICON = {
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
} as const;

/** "Not sure? Try a demo": four things that make a sound in one click, signed out, each an app's own first step. */
export const DEMOS: readonly { id: string; say: string; path: PathId }[] = [
  { id: "beat", say: "Make a beat", path: "daw" },
  { id: "mix", say: "Mix two tracks", path: "instruments" },
  { id: "amp", say: "Play an amp", path: "amps" },
  { id: "stage", say: "Plan a stage", path: "planner" },
];

/** A path by its id. */
export const pathOf = (id: PathId): Path => PATHS.find((p) => p.id === id)!;
