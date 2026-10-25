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
  mote: { size: number; color: number; fall: number };    // the air's specks, and how fast they fall (ash)
  city: boolean;                                          // a ruined city: no moss, no gas giant, towers of its own
}

const FOREST: Look = {
  sky: 0xb4c2a6, zenith: 0x8fa9b8, fog: 0.0105, ground: 0x3d4a22, litter: 0x5e3d22, trail: 0x8a4a2b,
  sun: 0xffe2a8, sunI: 2.8, hemi: [0xd2e6c0, 0x3a2a16, 1.05], ray: 0.15, rays: 40, trees: "redwood",
  amp: 1.6, bank: 32, strata: false, pave: null, rock: { color: 0x7d7d70, n: 70, h: 0.15, s: 0.06 },
  rocky: false, built: 0x9ca3aa, lowRock: false, mote: { size: 0.1, color: 0xfff0c8, fall: 0 }, city: false,
};

export const WORLDS: Record<SectorKind, Look> = {
  // Doren's redwood forest: trunks going up into haze, sun coming down through the canopy in shafts.
  shield: FOREST,
  // The capital after the bombing: an ash sky, a dim orange sun through smoke, bare broken streets,
  // and ash falling.
  capital: {
    ...FOREST, sky: 0x8e8985, zenith: 0x4d4c4c, fog: 0.0055, ground: 0x6a665f, litter: 0x4f4b46, trail: 0x262626,
    sun: 0xffd2ac, sunI: 2.0, hemi: [0xc8c8ca, 0x4a4643, 1.4], ray: 0.035, rays: 8, trees: null, amp: 0.5, bank: 14,
    pave: 0x302f2e, rock: { color: 0x7d7b78, n: 160, h: 0.08, s: 0.03 }, built: 0x9a958e, mote: { size: 0.16, color: 0xd6d0ca, fall: 0.9 },
    city: true,
  },
  spaceport: { ...FOREST, pave: 0x8f8b80 },
  cannon: { ...FOREST, pave: 0x86775c, lowRock: true },
  // The same idea, closer, wetter and full of vines.
  jungle: {
    ...FOREST, sky: 0x8aa284, zenith: 0x6f8f86, fog: 0.016, ground: 0x2b3a17, litter: 0x4a3a1c, trail: 0x6e4526,
    sun: 0xf1ffc8, sunI: 2.3, hemi: [0xbfe0b0, 0x24301a, 1.0], ray: 0.16, trees: "jungle", built: 0x7f8a6a,
    mote: { size: 0.16, color: 0xd8ffb0, fall: 0 },
  },
  // Red rock under an open sky, the gas giant hanging in it.
  canyon: {
    ...FOREST, sky: 0xe3b98e, zenith: 0x9fb4c9, fog: 0.0055, ground: 0xb07345, litter: 0x8c5534, trail: 0x9c5a35,
    sun: 0xfff0d6, sunI: 3.0, hemi: [0xf0d6b8, 0x6a3a22, 1.1], ray: 0.04, rays: 0, trees: null, amp: 0.9, bank: 45,
    strata: true, rock: { color: 0x9a5634, n: 140, h: 0.05, s: 0.25 }, rocky: true,
  },
};
