// What the radio and the troops say on each world. The redwood forest and the jungle keep the
// ferns-and-trees lines; the other worlds drop those and add their own. Only talk: the sim's rolls
// don't change, and the shield world's pool is exactly the old one.
import type { SectorKind } from "./contract.ts";

const GREEN = /\b(ferns?|trees?|forest)\b/i;

const RADIO: Partial<Record<SectorKind, string[]>> = {
  capital: [
    "Something in the ruins is humming. The ruins are not usually this musical.",
    "A Wooka has moved into the bus shelter. It has put up a tiny curtain.",
    "The street lights are out. Something up there is still doing the humming.",
    "Somebody has spray-painted a Marine on that wall. It's not flattering. It has a lot of eyes.",
  ],
  spaceport: [
    "Something in the vents is humming. The vents are not usually this chatty.",
    "A Wooka is riding the cargo lift. Up. Down. Up. It is having the best day of its life.",
    "Dock control reports an unscheduled passenger. It's on the hull. It's waving.",
    "The windows are holding. Command says the windows are holding. The windows disagree.",
  ],
  cannon: [
    "Something in the dunes is humming. It's in the surf too. How is it in the surf?",
    "A crab has taken the sergeant's hat. A Wooka has taken the crab. Nobody has taken the situation.",
    "The wrecked landing craft is full of Wooka. They've made it a hotel.",
    "Gulls are circling. The gulls are also frightened of them. That is not reassuring.",
  ],
  canyon: [
    "Something in the dust is humming. Visibility is bad. The humming is excellent.",
    "That dust devil just walked past carrying a Wooka. Neither seemed bothered.",
    "Heat's at forty. The Wooka are wearing the water bottles as hats.",
    "Something big is on the rim of the canyon. Please let it be a rock. It waved. It's not a rock.",
  ],
  jungle: [
    "Something in the vines is humming. The vines are humming back.",
    "The moths are glowing again. The moths are following the Wooka. The Wooka are following the moths.",
  ],
};

// Over their heads: [Marines calm, Marines scared, Wooka scared].
const CHAT: Partial<Record<SectorKind, { marines: { calm: string[]; scared: string[] }; wooka: { scared: string[] } }>> = {
  capital: { marines: { calm: ["I think that lamp post just blinked", "Who parks a tram in the middle of a war?"], scared: ["They're in the ruins!", "They're on the roof! The other roof!"] }, wooka: { scared: ["Up the lamp, up the lamp!", "Hide in the bus!"] } },
  spaceport: { marines: { calm: ["I think that panel just blinked", "Is the window supposed to hum?"], scared: ["They're in the vents!", "They're on the lift!"] }, wooka: { scared: ["Up the crane, up the crane!", "Hide in the box!"] } },
  cannon: { marines: { calm: ["I think that crab just blinked", "Sand. It's in my everything"], scared: ["They're in the dunes!", "They're coming out of the surf!"] }, wooka: { scared: ["Up the palm, up the palm!", "Hide in the boat!"] } },
  canyon: { marines: { calm: ["I think that rock just blinked", "Is it meant to be this hot?"], scared: ["They're in the dust!", "They're on the ridge!"] }, wooka: { scared: ["Up the rock, up the rock!", "Hide in the dust!"] } },
};

const without = (pool: readonly string[]) => pool.filter((l) => !GREEN.test(l));
const green = (k: SectorKind) => k === "shield" || k === "jungle";

// The radio's pool for a world.
export const radioFor = (k: SectorKind, all: readonly string[]): readonly string[] =>
  k === "shield" ? all : [...(green(k) ? all : without(all)), ...(RADIO[k] ?? [])];

// A side's chatter for a world: the same pools, with the green lines swapped for the world's own.
export function chatterFor<T extends { calm: readonly string[]; scared: readonly string[] }>(k: SectorKind, side: "marines" | "wooka", lines: T): T {
  if (k === "shield") return lines;
  const own = CHAT[k]?.[side] as Partial<Record<"calm" | "scared", string[]>> | undefined;
  const pick = (p: "calm" | "scared") => [...(green(k) ? lines[p] : without(lines[p])), ...(own?.[p] ?? [])];
  return { ...lines, calm: pick("calm"), scared: pick("scared") };
}
