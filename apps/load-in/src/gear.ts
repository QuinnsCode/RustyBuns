// The gear on the floor, at the real sizes and weights in #4849's table (width x height x depth in metres, kg). These are
// drawn with the models in `@rustybuns/models/gear` (#4852); the sound and power numbers come from `packages/gear` (#4851), keyed
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
  "top-12-powered": { id: "top-12-powered", name: "12\" powered top", size: [0.37, 0.6, 0.36], kg: 18, color: 0x1d1e20 },
  "sub-18": { id: "sub-18", name: "18\" sub", size: [0.55, 0.7, 0.75], kg: 45, color: 0x1d1e20 },
  "stand-tripod": { id: "stand-tripod", name: "Speaker stand", size: [0.9, 1.2, 0.9], kg: 4, color: 0x8a8d92 },
  "mixer-small": { id: "mixer-small", name: "Mixer", size: [0.4, 0.1, 0.35], kg: 4, color: 0x1d1e20 },
  "road-case-m": { id: "road-case-m", name: "Road case", size: [0.6, 0.5, 0.5], kg: 14, color: 0x1d1e20 },
} satisfies Record<string, Gear>;

export type GearId = keyof typeof GEAR;
