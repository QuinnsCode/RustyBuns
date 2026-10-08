// Four tycoons. Personality is build, colour and bling: nothing here is a loaded asset.
export type Hat = "crown" | "derrick" | "cap" | "none";
export interface Look {
  /** Width, height, depth multipliers of the torso. */
  bulk: [number, number, number];
  skin: number; suit: number; suit2: number; tie: number;
  hat: Hat; hatColor: number;
  shades: boolean; cigar: boolean; chains: number; goldTeeth: boolean;
  pinstripe: boolean; checked: boolean;
  /** Snout width multiplier, brow weight (angrier = bigger). */
  snout: number; brow: number;
  /** Bellow pitch in Hz (the audio uses it too). */
  voice: number;
  accent: number;
}

export const LOOKS: readonly Look[] = [
  // Baron Gulpington: round, plum, pinstripe, crown-shaped hard hat, ring on every pinky
  { bulk: [1.15, 1.0, 1.1], skin: 0x9c82ab, suit: 0x3b1a52, suit2: 0x6a3a8c, tie: 0xf2c230, hat: "crown", hatColor: 0xf5c518, shades: false, cigar: false, chains: 2, goldTeeth: true, pinstripe: true, checked: false, snout: 1.0, brow: 1.0, voice: 68, accent: 0x9b59d6 },
  // Crude Carl: tall and narrow, mirrored shades, money-green suit, derrick hard hat, oil-drip cigar
  { bulk: [0.85, 1.25, 0.95], skin: 0x6f9396, suit: 0x1f7a3a, suit2: 0x2fae56, tie: 0x0c3d1a, hat: "derrick", hatColor: 0xffd21a, shades: true, cigar: true, chains: 1, goldTeeth: false, pinstripe: false, checked: false, snout: 0.9, brow: 0.9, voice: 96, accent: 0x2fae56 },
  // Big Barrel Bertha: widest, barrel-orange jacket, triple chain, gold teeth, huge brows
  { bulk: [1.4, 0.95, 1.2], skin: 0xbb949a, suit: 0xd9650f, suit2: 0xff9a3c, tie: 0x3a1d08, hat: "none", hatColor: 0, shades: false, cigar: false, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.15, brow: 1.5, voice: 52, accent: 0xff8a1f },
  // Gusher Gus: small and wiry, backwards cap, loud checked jacket
  { bulk: [0.8, 0.85, 0.85], skin: 0xa88e6a, suit: 0xe3b81a, suit2: 0x7a1a1a, tie: 0xd22b2b, hat: "cap", hatColor: 0x1b1b1b, shades: false, cigar: false, chains: 1, goldTeeth: true, pinstripe: false, checked: true, snout: 0.85, brow: 1.1, voice: 140, accent: 0xe3b81a },
];
