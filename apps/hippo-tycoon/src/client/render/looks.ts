// Four tycoons. Personality is build, colour and bling: nothing here is a loaded
// asset. Every one of them wears a monocle; none wears a top hat.
export type Hat = "panama" | "miner" | "sunhat" | "bucket";
export interface Look {
  /** Width, height, depth multipliers of the torso. */
  bulk: [number, number, number];
  /** `waistcoat` is the colour of the aloha shirt; `cravat` the lei's main flower. */
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
  // Baron Gulpington: round, plum, cream linen jacket over a magenta aloha shirt, panama, the fattest chain
  { bulk: [1.15, 1.0, 1.1], skin: 0x8f7a9c, suit: 0xe9dcc0, waistcoat: 0x8a1f6a, cravat: 0xff7a5a, hat: "panama", hatColor: 0xe6d49c, cigar: false, moustache: null, chains: 2, goldTeeth: true, pinstripe: false, checked: false, snout: 1.0, brow: 1.0, voice: 68, accent: 0xb06ad6 },
  // Crude Carl: tall and narrow, khaki safari vest, teal shirt, explorer's lamp helmet, handlebar moustache, oil-drip cigar
  { bulk: [0.85, 1.25, 0.95], skin: 0x6d8f8a, suit: 0x8a7a48, waistcoat: 0x1f7a7a, cravat: 0xffd24a, hat: "miner", hatColor: 0xb89a46, cigar: true, moustache: 0x2a1a10, chains: 1, goldTeeth: false, pinstripe: false, checked: false, snout: 0.9, brow: 0.9, voice: 96, accent: 0x34b86a },
  // Big Barrel Bertha: widest, coral jacket, cream hibiscus shirt, a floppy sun hat with a flower, triple chain, huge brows
  { bulk: [1.4, 0.95, 1.2], skin: 0xb28a8c, suit: 0xd8634a, waistcoat: 0xf3e6c4, cravat: 0xff4a7a, hat: "sunhat", hatColor: 0xf0e2b0, cigar: false, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.15, brow: 1.5, voice: 52, accent: 0xff8a1f },
  // Gusher Gus: small and wiry, sand linen, canary shirt, bucket hat, loud everything
  { bulk: [0.8, 0.85, 0.85], skin: 0xa08a68, suit: 0xc8b48a, waistcoat: 0xf2c21f, cravat: 0xffffff, hat: "bucket", hatColor: 0x2f6a4a, cigar: false, moustache: null, chains: 1, goldTeeth: true, pinstripe: false, checked: false, snout: 0.85, brow: 1.1, voice: 140, accent: 0xe2b81f },
];
