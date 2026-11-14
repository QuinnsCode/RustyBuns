// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Every shape that crosses the wire, as one guard both the Worker and the widget import.
import { arr, bool, int, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { ID, KIND_NAMES, SHA } from "./layout.ts";

/** The products made in code: hats, then tops. A shop's own product, made from its photos, is "custom" and names its GLB. */
export const HATS = ["cap", "beanie", "bucket"] as const;
export type HatModel = (typeof HATS)[number];
export const TOPS = ["tee", "hoodie"] as const;
export type TopModel = (typeof TOPS)[number];
export const MODELS = [...HATS, ...TOPS] as const;
export type Made = (typeof MODELS)[number];
/** The print zones a product can have: a hat's front; a top's front, back and left sleeve. */
export const ZONES = ["front", "back", "left-sleeve"] as const;
export type ZoneName = (typeof ZONES)[number];
/** The zones `model` prints on: a top has all three, a hat and a shop's own model the front. */
export const zonesOf = (model: Model): readonly ZoneName[] => ((TOPS as readonly string[]).includes(model) ? ZONES : ["front"]);
export const ANY_MODEL = [...MODELS, "custom"] as const;
export type Model = (typeof ANY_MODEL)[number];
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * orgs/<org>/org.json: which pages may embed the widget and sign uploads ("*" allows any: the demo org), the
 * SHA-256 of each admin key (they make samples and upload product photos), and how many samples the org has paid for.
 */
export const Org = obj({
  origins: arr(str(200), 50),
  admins: opt(arr(str(64, { re: SHA }), 20)),
  samples: opt(int(0, 10_000)),
});
export type Org = Of<typeof Org>;

/** orgs/<org>/products/<product>.json. */
export const Product = obj({
  name: str(120),
  model: oneOf(ANY_MODEL),
  /** A custom model's GLB (orgs/<org>/models/<id>.glb), served from /r/. */
  glb: opt(str(300)),
  /** The colours on offer. A custom model keeps its own texture and offers none. */
  colors: arr(str(7, { re: HEX }), 24),
});
export type Product = Of<typeof Product>;

/** POST /api/orgs/<org>/uploads: "I have this file, where do I put it?" */
export const SignRequest = obj({
  kind: oneOf(KIND_NAMES),
  type: str(40),
  size: int(1, 64 << 20),
  sha256: str(64, { re: SHA }),
});
export type SignRequest = Of<typeof SignRequest>;

/** Where to PUT the bytes (with these headers), and the URL it is served from afterwards (none for originals). */
export const SignReply = obj({
  key: str(300),
  exists: bool(),
  put: opt(obj({ url: str(4000), headers: obj({ "content-type": str(40) }) })),
  url: opt(str(400)),
});
export type SignReply = Of<typeof SignReply>;

/** One picture on the product: its files, its print zone (the front when unnamed), and where it sits in it (0..1 across and up). */
export const Layer = obj({
  texture: str(300),
  original: opt(str(300)),
  zone: opt(oneOf(ZONES)),
  u: num(0, 1),
  v: num(0, 1),
  scale: num(0.05, 1),
  rotation: num(-Math.PI, Math.PI),
  /** On a custom model: the spot on its surface and the surface's facing there, in the model's own space. */
  point: opt(arr(num(-10, 10), 3, { min: 3 })),
  normal: opt(arr(num(-1, 1), 3, { min: 3 })),
});
export type Layer = Of<typeof Layer>;

/** A design: everything needed to draw it again. What the widget's `design` is and what a snapshot is exported with. */
export const Design = obj({
  v: oneOf([1] as const),
  model: oneOf(ANY_MODEL),
  color: str(7, { re: HEX }),
  layers: arr(Layer, 8),
  camera: obj({ azimuth: num(-10, 10), polar: num(0, Math.PI), distance: num(0.1, 10) }),
  product: opt(str(63, { re: ID })),
  snapshot: opt(str(300)),
});
export type Design = Of<typeof Design>;

export const DesignReply = obj({ id: str(24), url: str(400) });
export type DesignReply = Of<typeof DesignReply>;

/** POST /api/orgs/<org>/models (an admin): make a sample model from 1 to 4 product photos already uploaded. */
export const SampleRequest = obj({ name: str(120), photos: arr(str(300), 4, { min: 1 }) });
export type SampleRequest = Of<typeof SampleRequest>;

/** A sample's progress, from POST and GET /api/orgs/<org>/models/<id>. Ready: `product` is its product id. */
export const Sample = obj({
  id: str(24),
  name: str(120),
  status: oneOf(["generating", "ready", "failed"] as const),
  progress: num(0, 100),
  task: str(200),
  photos: arr(str(300), 4),
  created: num(0, 1e15),
  glb: opt(str(300)),
  product: opt(str(63)),
  error: opt(str(500)),
});
export type Sample = Of<typeof Sample>;
