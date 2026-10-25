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
  cliff: number;                                          // the sim's rock blocks' colour
  giant: boolean;                                         // the gas giant hanging in the sky
  twin: number | null;                                    // a second sun's colour, if the sky has one
  ripple: boolean;                                        // the floor rippled like wind-blown sand
  city: boolean;                                          // a ruined city: no moss, towers of its own
  flora: number[] | null;                                 // an alien world's plant colours, glowing, in place of green
  night: boolean;                                         // stars and two moons in the sky
}

const FOREST: Look = {
  sky: 0xb4c2a6, zenith: 0x8fa9b8, fog: 0.0105, ground: 0x3d4a22, litter: 0x5e3d22, trail: 0x8a4a2b,
  sun: 0xffe2a8, sunI: 2.8, hemi: [0xd2e6c0, 0x3a2a16, 1.05], ray: 0.15, rays: 40, trees: "redwood",
  amp: 1.6, bank: 32, strata: false, pave: null, rock: { color: 0x7d7d70, n: 70, h: 0.15, s: 0.06 },
  rocky: false, built: 0x9ca3aa, lowRock: false, mote: { size: 0.1, color: 0xfff0c8, fall: 0 },
  cliff: 0xa45a36, giant: true, twin: null, ripple: false, city: false, flora: null, night: false,
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
    city: true, giant: false,
  },
  spaceport: { ...FOREST, pave: 0x8f8b80 },
  cannon: { ...FOREST, pave: 0x86775c, lowRock: true },
  // Night with colour: huge glowing trees under two moons, spores drifting, pools of light on the floor.
  jungle: {
    ...FOREST, sky: 0x241552, zenith: 0x080630, fog: 0.008, ground: 0x2a2058, litter: 0x43307c, trail: 0x5a4488,
    sun: 0xa8b8ff, sunI: 1.5, hemi: [0xc0b8ff, 0x2c1a60, 1.9], ray: 0.1, rays: 26, trees: "jungle", built: 0x4a3f7a,
    rock: { color: 0x6a5a9a, n: 70, h: 0.72, s: 0.3 }, mote: { size: 0.3, color: 0x9ffff0, fall: 0 },
    flora: [0x20e0c8, 0xff3fc0, 0x9a5cff, 0xa8ff3c], night: true, giant: false,
  },
  // A desert under two suns: wind-carved sandstone among dunes, sand blowing, bones and ruined farms.
  canyon: {
    ...FOREST, sky: 0xeccb98, zenith: 0x9fb9c6, fog: 0.0042, ground: 0xbb8650, litter: 0x9a6636, trail: 0x93663a,
    sun: 0xfff0cc, sunI: 2.6, hemi: [0xf2d4aa, 0x7a4a2a, 0.85], ray: 0.05, rays: 0, trees: null, amp: 1.1, bank: 30,
    strata: true, rock: { color: 0xc58a56, n: 140, h: 0.07, s: 0.3 }, rocky: true,
    mote: { size: 0.22, color: 0xf3d9a4, fall: 0 }, cliff: 0xffffff, giant: false, twin: 0xffb070, ripple: true,
  },
};
