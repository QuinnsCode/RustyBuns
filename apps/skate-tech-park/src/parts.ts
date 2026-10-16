// What a board can be built from: the choices on the parts picker. Pure data, so the page and the tests share it.
export type Choice = { id: string; name: string; color: number; /** Price in cents. No price means free. */ price?: number };
export type Deck = Choice & { accent: number };
export type Trucks = Choice & { bushing: number; metal: number; rough: number };
export type Wheels = Choice & { core: number };

export const CATALOG = {
  deck: [
    { id: "sunset", name: "Sunset", color: 0xd9572b, accent: 0xf2e8d0 },
    { id: "teal", name: "Teal", color: 0x1f8a8a, accent: 0xf4c542 },
    { id: "ink", name: "Ink", color: 0x23262d, accent: 0xe2572b },
    { id: "bone", name: "Bone", color: 0xece4d2, accent: 0x2b5f9e },
    { id: "midnight", name: "Midnight foil", color: 0x1b1f4a, accent: 0xc9a227, price: 199 },
    { id: "magma", name: "Magma", color: 0xb3261e, accent: 0xffb347, price: 199 },
  ] satisfies Deck[],
  trucks: [
    { id: "raw", name: "Raw steel", color: 0xa5acb4, bushing: 0xe8d34a, metal: 0.9, rough: 0.3 },
    { id: "black", name: "Black", color: 0x2a2c30, bushing: 0xe2572b, metal: 0.7, rough: 0.4 },
    { id: "gold", name: "Gold", color: 0xc9a227, bushing: 0x1b1b1f, metal: 0.9, rough: 0.28, price: 99 },
  ] satisfies Trucks[],
  wheels: [
    { id: "bone", name: "Bone", color: 0xf2efe2, core: 0x2b2b2b },
    { id: "red", name: "Red", color: 0xd6382b, core: 0xf2efe2 },
    { id: "blue", name: "Blue", color: 0x2f6fd0, core: 0xf2efe2 },
    { id: "black", name: "Black", color: 0x2b2b2b, core: 0xe2572b },
    { id: "mint", name: "Mint", color: 0x6fe3b5, core: 0x23262d, price: 99 },
  ] satisfies Wheels[],
  grip: [
    { id: "black", name: "Black", color: 0x1c1c1e },
    { id: "grey", name: "Grey", color: 0x6b6e73 },
    { id: "clear", name: "Clear", color: 0x4a3f33 }, // clear grip over maple reads as dark sandpaper
  ] satisfies Choice[],
};

export type Part = keyof typeof CATALOG;
export type Parts = { [P in Part]: string };
export const DEFAULT_PARTS: Parts = { deck: "sunset", trucks: "raw", wheels: "bone", grip: "black" };

/** The catalogue entry for a part, falling back to the first for an id it does not know (a stale saved choice). */
export function pickPart<P extends Part>(part: P, id: string): (typeof CATALOG)[P][number] {
  const list = CATALOG[part] as readonly Choice[];
  return (list.find((c) => c.id === id) ?? list[0]!) as (typeof CATALOG)[P][number];
}
