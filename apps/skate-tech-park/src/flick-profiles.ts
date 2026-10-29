// The library of flick profiles (flick.ts): twenty ways to lay tricks out on the flick pad. The first is the one the
// page starts on; `?flick=<name>` picks another, and the footprints button on the pad steps through them. Each is
// plain data, so a new layout is a new entry here (or a JSON profile in the address), not a code change.
import { mirror, type Profile, scaled, type Stroke } from "./flick.ts";

const AXIS = 26.56; // degrees: a drag within this of straight across or up and down is a straight one (more than twice as long one way)
const DIAG = 45 - AXIS;
const LONG = 110; // pixels: a diagonal this long is a double turn

const base = { side: "right", stance: "regular", minDrag: 30, hold: 0.3, nudge: 12, nose: 0.3, tail: 0.3 } as const;

// Drag up to ollie, across or down to flick, the diagonals for the compound tricks; start on the nose and drag down to nollie.
// A long drag doubles the flick or the turn (double kickflip, double heelflip, 360 shove-it, tre and laser on the diagonals).
// The tail turns the board frontside: short a frontside shove-it, long a frontside 360, the long diagonal a 360 hardflip; a long
// drag up the varial's diagonal is a nightmare flip.
const classic: Profile = {
  ...base, name: "classic", about: "Up ollies, across flicks, down shoves it. Start on the nose and drag down to nollie.",
  strokes: [
    { from: "nose", dir: 270, spread: AXIS, pop: "nollie" },
    { from: "nose", dir: 315, spread: DIAG, pop: "nollie", flick: "kickflip" },
    { from: "nose", dir: 225, spread: DIAG, pop: "nollie", flick: "heelflip" },
    { from: "tail", dir: 270, spread: AXIS, min: LONG, flick: "frontside 360 shove-it" },
    { from: "tail", dir: 315, spread: DIAG, min: LONG, flick: "360 hardflip" },
    { from: "tail", dir: 270, spread: AXIS, flick: "frontside shove-it" }, // scooped off the tail the other way
    { from: "any", dir: 45, spread: DIAG, min: LONG, pop: "ollie", flick: "nightmare flip" },
    { from: "any", dir: 0, spread: AXIS, min: LONG, flick: "double kickflip" }, // a long flick goes round twice
    { from: "any", dir: 180, spread: AXIS, min: LONG, flick: "double heelflip" },
    { from: "any", dir: 270, spread: AXIS, min: LONG, flick: "360 shove-it" },
    { from: "any", dir: 0, spread: AXIS, flick: "kickflip" },
    { from: "any", dir: 180, spread: AXIS, flick: "heelflip" },
    { from: "any", dir: 90, spread: AXIS, pop: "ollie" },
    { from: "any", dir: 270, spread: AXIS, flick: "shove-it" },
    { from: "any", dir: 45, spread: DIAG, pop: "ollie", flick: "varial" },
    { from: "any", dir: 135, spread: DIAG, pop: "ollie", flick: "varial heel" },
    { from: "any", dir: 315, spread: DIAG, min: LONG, flick: "tre flip" },
    { from: "any", dir: 225, spread: DIAG, min: LONG, flick: "laser flip" },
    { from: "any", dir: 315, spread: DIAG, flick: "hardflip" },
    { from: "any", dir: 225, spread: DIAG, flick: "inward heel" },
  ],
};

// Two fingers on a real fingerboard: the back one snaps the tail, the front one flicks off the nose's edges.
const fingerboard: Profile = {
  ...base, name: "fingerboard", about: "Tap or push up from the tail to ollie, from the nose down to nollie. Flick off the nose's edges; scoop the tail for shove-its.",
  strokes: [
    { from: "tail", dir: "tap", pop: "ollie" },
    { from: "nose", dir: "tap", pop: "nollie" },
    { from: "tail", dir: 90, spread: 40, pop: "ollie" },
    { from: "nose", dir: 270, spread: 40, pop: "nollie" },
    { from: "nose", dir: 0, spread: 35, min: LONG, flick: "tre flip" },
    { from: "nose", dir: 180, spread: 35, min: LONG, flick: "laser flip" },
    { from: "nose", dir: 0, spread: 35, flick: "kickflip" },
    { from: "nose", dir: 180, spread: 35, flick: "heelflip" },
    { from: "nose", dir: 45, spread: 10, flick: "varial" },
    { from: "nose", dir: 135, spread: 10, flick: "varial heel" },
    { from: "tail", dir: 0, spread: 40, flick: "shove-it" },
    { from: "tail", dir: 180, spread: 40, flick: "shove-it" },
    { from: "tail", dir: 315, spread: 10, flick: "hardflip" },
    { from: "tail", dir: 225, spread: 10, flick: "inward heel" },
    { from: "mid", dir: 90, spread: 40, pop: "ollie" },
    { from: "mid", dir: 0, spread: 40, flick: "kickflip" },
    { from: "mid", dir: 180, spread: 40, flick: "heelflip" },
  ],
};

// A tap pops (the nose's tap a nollie), so every swipe is free to be a trick of its own.
const tapPop: Profile = {
  ...base, name: "tap pop", about: "Tap to ollie, tap the nose to nollie. Every swipe is a trick: right kickflip, left heelflip, up varial, down shove-it.",
  strokes: [
    { from: "nose", dir: "tap", pop: "nollie" },
    { from: "any", dir: "tap", pop: "ollie" },
    { from: "any", dir: 0, spread: AXIS, flick: "kickflip" },
    { from: "any", dir: 180, spread: AXIS, flick: "heelflip" },
    { from: "any", dir: 90, spread: AXIS, flick: "varial" },
    { from: "any", dir: 270, spread: AXIS, flick: "shove-it" },
    { from: "any", dir: 45, spread: DIAG, flick: "tre flip" },
    { from: "any", dir: 135, spread: DIAG, flick: "laser flip" },
    { from: "any", dir: 315, spread: DIAG, flick: "hardflip" },
    { from: "any", dir: 225, spread: DIAG, flick: "inward heel" },
  ],
};

// Eight points of the compass, one trick each; a tap pops.
const compass: Profile = {
  ...base, name: "compass", about: "Eight directions, eight tricks. Tap the tail (or anywhere) to ollie, tap the nose to nollie.",
  strokes: [
    { from: "nose", dir: "tap", pop: "nollie" },
    { from: "any", dir: "tap", pop: "ollie" },
    ...([[90, "varial"], [45, "tre flip"], [0, "kickflip"], [315, "hardflip"], [270, "shove-it"], [225, "inward heel"], [180, "heelflip"], [135, "laser flip"]] as const)
      .map(([dir, flick]): Stroke => ({ from: "any", dir, flick })),
  ],
};

// Pop the nose by default: up is the nollie, and the tail has to be asked for.
const nollieFirst: Profile = {
  ...base, name: "nollie first", about: "Up nollies. Start on the tail and push up to ollie. Across flicks, down shoves it.",
  strokes: [
    { from: "tail", dir: 90, spread: AXIS, pop: "ollie" },
    ...classic.strokes.filter((s) => s.from === "any").map((s): Stroke => (s.pop === "ollie" ? { ...s, pop: "nollie" } : s)),
  ],
};

// Pull back to pop, like drawing back a stick: down ollies, up shoves it.
const pullPop: Profile = {
  ...base, name: "pull pop", about: "Pull down to ollie, start on the nose and push up to nollie. Across flicks, up shoves it.",
  strokes: [
    { from: "nose", dir: 90, spread: AXIS, pop: "nollie" },
    ...classic.strokes.filter((s) => s.from === "any").map((s): Stroke => (s.dir === "tap" ? s : { ...s, dir: (360 - s.dir) % 360 })),
  ],
};

// One stroke, one whole trick: the flicks pop on their own.
const oneSwipe: Profile = {
  ...base, name: "one swipe", about: "Every flick pops itself: swipe across from the ground and it ollies into the trick. From the nose it nollies into it.",
  strokes: [
    ...classic.strokes.filter((s) => s.from === "nose"),
    { from: "nose", dir: 0, spread: AXIS, pop: "nollie", flick: "kickflip" },
    { from: "nose", dir: 180, spread: AXIS, pop: "nollie", flick: "heelflip" },
    ...classic.strokes.filter((s) => s.from === "any").map((s): Stroke => (s.flick ? { ...s, pop: "ollie" } : s)),
  ],
};

// The flicks only count off the nose, as a real front finger does them; the middle and tail just pop.
const noseFlicks: Profile = {
  ...base, name: "nose flicks", nose: 0.4, about: "Flips come off the nose only: across for kickflip and heelflip, long for the 360s. Up from anywhere else ollies.",
  strokes: [
    { from: "nose", dir: 270, spread: AXIS, pop: "nollie" },
    { from: "nose", dir: 0, spread: AXIS, min: LONG, flick: "tre flip" },
    { from: "nose", dir: 180, spread: AXIS, min: LONG, flick: "laser flip" },
    { from: "nose", dir: 0, spread: AXIS, flick: "kickflip" },
    { from: "nose", dir: 180, spread: AXIS, flick: "heelflip" },
    { from: "nose", dir: 315, spread: DIAG, flick: "hardflip" },
    { from: "nose", dir: 225, spread: DIAG, flick: "inward heel" },
    { from: "nose", dir: 45, spread: DIAG, flick: "varial" },
    { from: "nose", dir: 135, spread: DIAG, flick: "varial heel" },
    { from: "any", dir: 90, spread: 60, pop: "ollie" },
    { from: "any", dir: 270, spread: AXIS, flick: "shove-it" },
  ],
};

// The board turns off the tail and flips off the nose: how far you drag says how far it turns.
const tailScoop: Profile = {
  ...base, name: "tail scoop", about: "Scoop the tail across to turn the board (short a shove-it, long a 360), flick the nose across to flip it.",
  strokes: [
    { from: "nose", dir: 270, spread: AXIS, pop: "nollie" },
    { from: "tail", dir: 90, spread: AXIS, pop: "ollie" },
    { from: "tail", dir: 0, spread: AXIS, min: LONG, flick: "tre flip" },
    { from: "tail", dir: 180, spread: AXIS, min: LONG, flick: "laser flip" },
    { from: "tail", dir: 0, spread: AXIS, flick: "shove-it" },
    { from: "tail", dir: 180, spread: AXIS, flick: "varial heel" },
    { from: "nose", dir: 0, spread: AXIS, flick: "kickflip" },
    { from: "nose", dir: 180, spread: AXIS, flick: "heelflip" },
    { from: "any", dir: 90, spread: AXIS, pop: "ollie" },
    { from: "any", dir: 0, spread: AXIS, flick: "varial" },
    { from: "any", dir: 180, spread: AXIS, flick: "inward heel" },
    { from: "any", dir: 270, spread: AXIS, flick: "hardflip" },
  ],
};

// The five tricks everyone learns first, with wide paths that are hard to miss.
const firstFive: Profile = {
  ...base, name: "first five", minDrag: 40, about: "Just the first five: up ollie, nose down nollie, right kickflip, left heelflip, down shove-it. Wide paths.",
  strokes: [
    { from: "nose", dir: 270, spread: 45, pop: "nollie" },
    { from: "any", dir: 90, spread: 45, pop: "ollie" },
    { from: "any", dir: 0, spread: 45, flick: "kickflip" },
    { from: "any", dir: 180, spread: 45, flick: "heelflip" },
    { from: "any", dir: 270, spread: 45, flick: "shove-it" },
  ],
};

// Narrow paths and length that counts: short and long of every direction are different tricks.
const fine: Profile = {
  ...base, name: "fine lines", about: "Narrow paths, and length counts: short across is a kickflip or heelflip, long across a tre flip or laser flip.",
  strokes: [
    { from: "nose", dir: 270, spread: 15, pop: "nollie" },
    { from: "nose", dir: 300, spread: 15, pop: "nollie", flick: "kickflip" },
    { from: "nose", dir: 240, spread: 15, pop: "nollie", flick: "heelflip" },
    { from: "any", dir: 90, spread: 15, pop: "ollie" },
    { from: "any", dir: 60, spread: 15, pop: "ollie", flick: "varial" },
    { from: "any", dir: 120, spread: 15, pop: "ollie", flick: "varial heel" },
    { from: "any", dir: 0, spread: 15, min: LONG, flick: "tre flip" },
    { from: "any", dir: 180, spread: 15, min: LONG, flick: "laser flip" },
    { from: "any", dir: 0, spread: 15, flick: "kickflip" },
    { from: "any", dir: 180, spread: 15, flick: "heelflip" },
    { from: "any", dir: 270, spread: 15, flick: "shove-it" },
    { from: "any", dir: 315, spread: 15, flick: "hardflip" },
    { from: "any", dir: 225, spread: 15, flick: "inward heel" },
  ],
};

const lefty = (p: Profile, name: string): Profile => ({ ...p, name, side: "left", about: `${p.about} Flick pad on the left, stick on the right.` });

export const PROFILES: Profile[] = [
  classic,
  mirror(classic, "classic goofy", "Classic with left and right swapped, for the other foot forward."),
  fingerboard,
  mirror(fingerboard, "fingerboard goofy", "Fingerboard with left and right swapped."),
  scaled(classic, 0.6, "short thumb", "Classic with short strokes, for a small phone."),
  scaled(classic, 1.6, "long throw", "Classic with long strokes, for a tablet."),
  { ...classic, name: "anywhere", about: "Classic with no nose or tail: the same drag does the same trick wherever it starts.", strokes: classic.strokes.filter((s) => s.from === "any") },
  tapPop,
  compass,
  nollieFirst,
  pullPop,
  oneSwipe,
  noseFlicks,
  tailScoop,
  firstFive,
  fine,
  { ...classic, name: "quick manual", hold: 0.18, about: "Classic, but a press held still for a moment less is a manual." },
  { ...classic, name: "slow manual", hold: 0.5, nudge: 20, about: "Classic, but a manual waits for a longer, stiller hold." },
  lefty(classic, "lefty"),
  lefty(fingerboard, "lefty fingerboard"),
];
