// Four tycoons. Personality is build, colour and bling: nothing here is a loaded
// asset. Every one of them wears a monocle; none wears a top hat.
export type Hat = "none" | "bandana";
export type Shades = "aviator" | "wayfarer" | "cateye" | "square";
export interface Look {
  /** Width, height, depth multipliers of the torso. */
  bulk: [number, number, number];
  /** `suit` is the jacket, `waistcoat` the tee under it (the field names are older than the wardrobe). */
  skin: number; suit: number; waistcoat: number; cravat: number;
  hat: Hat; hatColor: number;
  shades: Shades; frame: number; lens: number;
  fur: boolean; camo: boolean;
  cigar: boolean; moustache: number | null; chains: number; goldTeeth: boolean;
  pinstripe: boolean; checked: boolean;
  /** Snout width multiplier, brow weight (angrier = bigger). */
  snout: number; brow: number;
  /** Bellow pitch in Hz (the audio uses it too). */
  voice: number;
  accent: number;
}

export const LOOKS: readonly Look[] = [
  // Baron Gulpington: round, white linen jacket over a teal tee, gold aviators, three chains, a cigar. The boss.
  { bulk: [1.15, 1.0, 1.1], skin: 0x6f5f7a, suit: 0xf2efe6, waistcoat: 0x2fd0c0, cravat: 0, hat: "none", hatColor: 0, shades: "aviator", frame: 0xe0b030, lens: 0x2a9aa8, fur: false, camo: false, cigar: true, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.0, brow: 1.1, voice: 68, accent: 0xff3d9a },
  // Crude Carl: tall and narrow, pastel pink jacket over black, black wayfarers, a red bandana, a moustache, a cigar
  { bulk: [0.85, 1.25, 0.95], skin: 0x4e6e68, suit: 0xf0aac0, waistcoat: 0x16161e, cravat: 0, hat: "bandana", hatColor: 0x9a1c1c, shades: "wayfarer", frame: 0x0a0a0e, lens: 0x121218, fur: false, camo: false, cigar: true, moustache: 0x1c120c, chains: 1, goldTeeth: false, pinstripe: false, checked: false, snout: 0.9, brow: 1.0, voice: 96, accent: 0x39e6ff },
  // Big Barrel Bertha: widest, a black coat with a white fur collar, cat-eye shades, hot pink tee, huge brows
  { bulk: [1.4, 0.95, 1.2], skin: 0x8c6a6e, suit: 0x15151c, waistcoat: 0xff5a9a, cravat: 0, hat: "none", hatColor: 0, shades: "cateye", frame: 0xd8a830, lens: 0xa8307a, fur: true, camo: false, cigar: false, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.15, brow: 1.6, voice: 52, accent: 0xff8a3a },
  // Gusher Gus: small and wiry, olive camo jacket, a black headband, white-framed mirrors, gold teeth
  { bulk: [0.8, 0.85, 0.85], skin: 0x7a6a4a, suit: 0x4a5a2e, waistcoat: 0xe8e0c8, cravat: 0, hat: "bandana", hatColor: 0x151515, shades: "square", frame: 0xf0eee8, lens: 0x3a2a1a, fur: false, camo: true, cigar: false, moustache: null, chains: 2, goldTeeth: true, pinstripe: false, checked: false, snout: 0.85, brow: 1.2, voice: 140, accent: 0xffd23a },
];
