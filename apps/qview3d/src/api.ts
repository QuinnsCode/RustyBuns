// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Every shape that crosses the wire, as one guard both the Worker and the widget import.
import { arr, bool, int, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { ID, KIND_NAMES, SHA } from "./layout.ts";

export const MODELS = ["cap", "beanie", "bucket"] as const;
export type Model = (typeof MODELS)[number];
const HEX = /^#[0-9a-f]{6}$/i;

/** orgs/<org>/org.json: which pages may embed the widget and sign uploads. "*" allows any (the demo org). */
export const Org = obj({ origins: arr(str(200), 50) });
export type Org = Of<typeof Org>;

/** orgs/<org>/products/<product>.json. */
export const Product = obj({
  name: str(120),
  model: oneOf(MODELS),
  colors: arr(str(7, { re: HEX }), 24, { min: 1 }),
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

/** One picture on the product: its files, and where it sits in the print zone (0..1 across and up). */
export const Layer = obj({
  texture: str(300),
  original: opt(str(300)),
  u: num(0, 1),
  v: num(0, 1),
  scale: num(0.05, 1),
  rotation: num(-Math.PI, Math.PI),
});
export type Layer = Of<typeof Layer>;

/** A design: everything needed to draw it again. What the widget's `design` is and what a snapshot is exported with. */
export const Design = obj({
  v: oneOf([1] as const),
  model: oneOf(MODELS),
  color: str(7, { re: HEX }),
  layers: arr(Layer, 8),
  camera: obj({ azimuth: num(-10, 10), polar: num(0, Math.PI), distance: num(0.1, 10) }),
  product: opt(str(63, { re: ID })),
  snapshot: opt(str(300)),
});
export type Design = Of<typeof Design>;

export const DesignReply = obj({ id: str(24), url: str(400) });
export type DesignReply = Of<typeof DesignReply>;
