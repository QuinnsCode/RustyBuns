// Four tycoons. Personality is build, colour and bling: nothing here is a loaded
// asset. Every one of them wears a monocle; none wears a top hat.
export type Hat = "none" | "bandana" | "beret";
export type Shades = "aviator" | "wayfarer" | "cateye" | "square";
export interface Look {
  /** Width, height, depth multipliers of the torso. */
  bulk: [number, number, number];
  /** `suit` is the jacket, `waistcoat` the tee under it (the field names are older than the wardrobe). */
  skin: number; suit: number; waistcoat: number; cravat: number;
  hat: Hat; hatColor: number;
  shades: Shades; frame: number; lens: number;
  fur: boolean; camo: boolean;
  /** Cross-chest straps of oil vials (0, 1 or 2), rows of medals, gold epaulettes: a field marshal who has been living rough. */
  bandolier: number; medals: number; epaulettes: boolean;
  cigar: boolean; moustache: number | null; chains: number; goldTeeth: boolean;
  pinstripe: boolean; checked: boolean;
  /** Snout width multiplier, brow weight (angrier = bigger). */
  snout: number; brow: number;
  /** Bellow pitch in Hz (the audio uses it too). */
  voice: number;
  accent: number;
}

export const LOOKS: readonly Look[] = [
  // Baron Gulpington, "El General": round, an olive dress jacket with gold epaulettes and a chestful of medals, a black beret, gold aviators, a cigar
  { bulk: [1.15, 1.0, 1.1], skin: 0x6f5f7a, suit: 0x4f5c34, waistcoat: 0x16161a, cravat: 0, hat: "beret", hatColor: 0x16161a, shades: "aviator", frame: 0xe0b030, lens: 0x2a9aa8, fur: false, camo: false, bandolier: 0, medals: 6, epaulettes: true, cigar: true, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.0, brow: 1.15, voice: 68, accent: 0xff3d9a },
  // Crude Carl: tall and narrow, black beret, dark fatigues, two bandoliers of oil vials, wayfarers, a moustache and a cigar
  { bulk: [0.85, 1.25, 0.95], skin: 0x4e6e68, suit: 0x394026, waistcoat: 0x16161e, cravat: 0, hat: "beret", hatColor: 0x101014, shades: "wayfarer", frame: 0x0a0a0e, lens: 0x121218, fur: false, camo: false, bandolier: 2, medals: 0, epaulettes: false, cigar: true, moustache: 0x1c120c, chains: 1, goldTeeth: false, pinstripe: false, checked: false, snout: 0.9, brow: 1.05, voice: 96, accent: 0x39e6ff },
  // Big Barrel Bertha: widest, a black coat with a white fur collar, a maroon beret, cat-eye shades, a bandolier and a few medals
  { bulk: [1.4, 0.95, 1.2], skin: 0x8c6a6e, suit: 0x15151c, waistcoat: 0xff5a9a, cravat: 0, hat: "beret", hatColor: 0x6a1426, shades: "cateye", frame: 0xd8a830, lens: 0xa8307a, fur: true, camo: false, bandolier: 1, medals: 3, epaulettes: true, cigar: false, moustache: null, chains: 3, goldTeeth: true, pinstripe: false, checked: false, snout: 1.15, brow: 1.6, voice: 52, accent: 0xff8a3a },
  // Gusher Gus: small and wiry, camo, a headband, mirrors, a bandolier, a chest of gold
  { bulk: [0.8, 0.85, 0.85], skin: 0x7a6a4a, suit: 0x4a5a2e, waistcoat: 0xe8e0c8, cravat: 0, hat: "bandana", hatColor: 0x151515, shades: "square", frame: 0xf0eee8, lens: 0x3a2a1a, fur: false, camo: true, bandolier: 1, medals: 0, epaulettes: false, cigar: false, moustache: null, chains: 2, goldTeeth: true, pinstripe: false, checked: false, snout: 0.85, brow: 1.2, voice: 140, accent: 0xffd23a },
];
