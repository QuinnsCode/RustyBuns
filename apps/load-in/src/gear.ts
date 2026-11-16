// The gear on the floor, at the real sizes and weights in #4849's table (width x height x depth in metres, kg). These are
// plain boxes until the models (#4852) land; the sound and power numbers come from `packages/gear` (#4851) later, keyed
// by the same ids. Only what a level places is listed here.

export interface Gear {
  id: string;
  name: string;
  /** Width (x), height (y), depth (z) in metres, facing +z. */
  size: readonly [number, number, number];
  kg: number;
  /** Box colour on the page until the model lands. */
  color: number;
}

export const GEAR = {
  "amp-head": { id: "amp-head", name: "Amp head", size: [0.7, 0.27, 0.25], kg: 18, color: 0x2b2b2b },
  "cab-4x12": { id: "cab-4x12", name: "4x12 cab", size: [0.76, 0.76, 0.36], kg: 40, color: 0x3a3330 },
  guitar: { id: "guitar", name: "Guitar", size: [0.33, 1.0, 0.05], kg: 3.5, color: 0xb5452a },
} satisfies Record<string, Gear>;

export type GearId = keyof typeof GEAR;
