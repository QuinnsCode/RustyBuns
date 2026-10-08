// Four tycoons. Personality is build, colour and bling: nothing here is a loaded
// asset. Every one of them wears a monocle; none wears a top hat.
export type Hat = "bowler" | "miner" | "bonnet" | "newsboy";
export interface Look {
  /** Width, height, depth multipliers of the torso. */
  bulk: [number, number, number];
  skin: number; suit: number; waistcoat: number; cravat: number;
  hat: Hat; hatColor: number;
  cigar: boolean; moustache: number | null; chains: number; goldTeeth: boolean;
  pinstripe: boolean; checked: boolean;
  /** Snout width multiplier, brow weight (angrier = bigger). */
  snout: number; brow: number;
  /** Bellow pitch in Hz (the audio uses it too). */
  voice: number;
  accent: number;
}

export const LOOKS: readonly Look[] = [
  // Baron Gulpington: round, plum, pinstripe tailcoat, gold-banded bowler, the fattest watch chain
  { bulk: [1.15, 1.0, 1.1], skin: 0x8f7a9c, suit: 0x3a1a3c, waistcoat: 0xd8a62a, cravat: 0xf2ead6, hat: "bowler", hatColor: 0x25232a, cigar: false, moustache: null, chains: 2, goldTeeth: true, pinstripe: true, checked: false, snout: 1.0, brow: 1.0, voice: 68, accent: 0xb06ad6 },
  // Crude Carl: tall and narrow, bottle-green frock coat, miner's lamp helmet, handlebar moustache, oil-drip cigar
  { bulk: [0.85, 1.25, 0.95], skin: 0x6d8f8a, suit: 0x1d5a34, waistcoat: 0x8a1c24, cravat: 0xe9dfc4, hat: "miner", hatColor: 0xc9971c, cigar: true, moustache: 0x2a1a10, chains: 1, goldTeeth: false, pinstripe: false, checked: false, snout: 0.9, brow: 0.9, voice: 96, accent: 0x34b86a },
  // Big Barrel Bertha: widest, copper-orange jacket, plumed bonnet, triple chain, huge brows
  { bulk: [1.4, 0.95, 1.2], skin: 0xb28a8c, suit: 0xb85a1a, waistcoat: 0xf0d9a0, cravat: 0xfaf3e0, hat: "bonnet", hatColor: 0x6a1d2a, cigar: false, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.15, brow: 1.5, voice: 52, accent: 0xff8a1f },
  // Gusher Gus: small and wiry, checked waistcoat, newsboy cap, loud everything
  { bulk: [0.8, 0.85, 0.85], skin: 0xa08a68, suit: 0x59422a, waistcoat: 0xe2b81f, cravat: 0xd22b2b, hat: "newsboy", hatColor: 0x3a3430, cigar: false, moustache: null, chains: 1, goldTeeth: true, pinstripe: false, checked: true, snout: 0.85, brow: 1.1, voice: 140, accent: 0xe2b81f },
];
