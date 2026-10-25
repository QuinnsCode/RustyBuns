// What each kind of sector looks like, as data: the sky and light, the floor's colours, what grows
// (terrain.ts and foliage.ts build from it), and the landmarks by the keep. The sim never reads this;
// a world changes what you see, never a shot or a step.
import type { SectorKind } from "./contract.ts";

// The trunks a world draws for the sim's trees (which block and hide), and on its banks: the
// redwood forest, the jungle's thin wet trunks, or none.
export type Trees = "redwood" | "jungle" | null;

export interface Look {
  sky: number; zenith: number; fog: number;               // the haze and the sky dome, horizon to top
  ground: number; litter: number; trail: number;          // the floor's base, its patches, the worn trail
  sun: number; sunI: number; hemi: [number, number, number];
  ray: number; rays: number;                              // the sun shafts: how strong, how many
  trees: Trees;
  amp: number; bank: number;                              // how much the floor rolls, how high the banks rise past the edge
  strata: boolean;                                        // the floor banded like layered rock
  pave: number | null;                                    // the posts' paving, if they're paved
  rock: { color: number; n: number; h: number; s: number }; // loose rocks, and their tint
  rocky: boolean;                                         // the sim's tall blocks are rock, not built
  built: number;                                          // the built blocks' concrete
  lowRock: boolean;                                       // a built world's low blocks are rock anyway
  mote: { size: number; color: number };
  flora: number[] | null;                                 // an alien world's plant colours, glowing, in place of green
  night: boolean;                                         // stars and two moons in the sky instead of the gas giant
}

const FOREST: Look = {
  sky: 0xb4c2a6, zenith: 0x8fa9b8, fog: 0.0105, ground: 0x3d4a22, litter: 0x5e3d22, trail: 0x8a4a2b,
  sun: 0xffe2a8, sunI: 2.8, hemi: [0xd2e6c0, 0x3a2a16, 1.05], ray: 0.15, rays: 40, trees: "redwood",
  amp: 1.6, bank: 32, strata: false, pave: null, rock: { color: 0x7d7d70, n: 70, h: 0.15, s: 0.06 },
  rocky: false, built: 0x9ca3aa, lowRock: false, mote: { size: 0.1, color: 0xfff0c8 }, flora: null, night: false,
};

export const WORLDS: Record<SectorKind, Look> = {
  // Doren's redwood forest: trunks going up into haze, sun coming down through the canopy in shafts.
  shield: FOREST,
  capital: { ...FOREST, pave: 0x8d8a82, built: 0xd0c8b6 },
  spaceport: { ...FOREST, pave: 0x8f8b80 },
  cannon: { ...FOREST, pave: 0x86775c, lowRock: true },
  // Night with colour: huge glowing trees under two moons, spores drifting, pools of light on the floor.
  jungle: {
    ...FOREST, sky: 0x241552, zenith: 0x080630, fog: 0.008, ground: 0x2a2058, litter: 0x43307c, trail: 0x5a4488,
    sun: 0xa8b8ff, sunI: 1.5, hemi: [0xc0b8ff, 0x2c1a60, 1.9], ray: 0.1, rays: 26, trees: "jungle", built: 0x4a3f7a,
    rock: { color: 0x6a5a9a, n: 70, h: 0.72, s: 0.3 }, mote: { size: 0.3, color: 0x9ffff0 },
    flora: [0x20e0c8, 0xff3fc0, 0x9a5cff, 0xa8ff3c], night: true,
  },
  // Red rock under an open sky, the gas giant hanging in it.
  canyon: {
    ...FOREST, sky: 0xe3b98e, zenith: 0x9fb4c9, fog: 0.0055, ground: 0xb07345, litter: 0x8c5534, trail: 0x9c5a35,
    sun: 0xfff0d6, sunI: 3.0, hemi: [0xf0d6b8, 0x6a3a22, 1.1], ray: 0.04, rays: 0, trees: null, amp: 0.9, bank: 45,
    strata: true, rock: { color: 0x9a5634, n: 140, h: 0.05, s: 0.25 }, rocky: true,
  },
};
