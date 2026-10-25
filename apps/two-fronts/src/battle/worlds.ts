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
  sea: { level: number } | null;                          // shallows along the +x edge, the water's surface height
  stone: number;                                          // the sim's rock blocks and cliffs
  wood: number;                                           // fallen logs and stumps
  giant: boolean;                                         // the gas giant in the sky
  moss: boolean;                                          // moss on the built blocks' tops
}

const FOREST: Look = {
  sky: 0xb4c2a6, zenith: 0x8fa9b8, fog: 0.0105, ground: 0x3d4a22, litter: 0x5e3d22, trail: 0x8a4a2b,
  sun: 0xffe2a8, sunI: 2.8, hemi: [0xd2e6c0, 0x3a2a16, 1.05], ray: 0.15, rays: 40, trees: "redwood",
  amp: 1.6, bank: 32, strata: false, pave: null, rock: { color: 0x7d7d70, n: 70, h: 0.15, s: 0.06 },
  rocky: false, built: 0x9ca3aa, lowRock: false, mote: { size: 0.1, color: 0xfff0c8 },
  sea: null, stone: 0x8a8a7c, wood: 0x5a3a26, moss: true, giant: true,
};

export const WORLDS: Record<SectorKind, Look> = {
  // Doren's redwood forest: trunks going up into haze, sun coming down through the canopy in shafts.
  shield: FOREST,
  capital: { ...FOREST, pave: 0x8d8a82, built: 0xd0c8b6 },
  spaceport: { ...FOREST, pave: 0x8f8b80 },
  // Anti-ship cannon: a bright shore. Sand rolls down to ankle-deep shallows on the east edge and a sea past it.
  cannon: {
    ...FOREST, sky: 0xbfe1f2, zenith: 0x3b8ee0, fog: 0.0024, ground: 0xfff2c4, litter: 0xf0d9a2, trail: 0xe0c48c,
    sun: 0xfff3da, sunI: 3.3, hemi: [0xcfe9ff, 0xe0c78e, 1.2], ray: 0, rays: 0, trees: null, amp: 0.6, bank: 14,
    pave: 0xe8d6a4, rock: { color: 0xe6d9b6, n: 70, h: 0.1, s: 0.1 }, lowRock: true, built: 0xe6dcc2,
    mote: { size: 0.07, color: 0xffffff }, sea: { level: -0.02 }, stone: 0xb7a888, wood: 0xa8998a, moss: false, giant: false,
  },
  // The same idea, closer, wetter and full of vines.
  jungle: {
    ...FOREST, sky: 0x8aa284, zenith: 0x6f8f86, fog: 0.016, ground: 0x2b3a17, litter: 0x4a3a1c, trail: 0x6e4526,
    sun: 0xf1ffc8, sunI: 2.3, hemi: [0xbfe0b0, 0x24301a, 1.0], ray: 0.16, trees: "jungle", built: 0x7f8a6a,
    mote: { size: 0.16, color: 0xd8ffb0 },
  },
  // Red rock under an open sky, the gas giant hanging in it.
  canyon: {
    ...FOREST, sky: 0xe3b98e, zenith: 0x9fb4c9, fog: 0.0055, ground: 0xb07345, litter: 0x8c5534, trail: 0x9c5a35,
    sun: 0xfff0d6, sunI: 3.0, hemi: [0xf0d6b8, 0x6a3a22, 1.1], ray: 0.04, rays: 0, trees: null, amp: 0.9, bank: 45,
    strata: true, rock: { color: 0x9a5634, n: 140, h: 0.05, s: 0.25 }, rocky: true,
  },
};
