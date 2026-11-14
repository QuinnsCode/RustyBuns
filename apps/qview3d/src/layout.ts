// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Where everything lives in the one R2 bucket. Every org gets a folder, split by kind, never by shopper or date:
//
//   orgs/<org>/org.json                  which sites may embed the widget and upload (origins), set at onboarding
//   orgs/<org>/products/<product>.json   a product: which model, which colours, its print zone
//   orgs/<org>/originals/<sha>.<ext>     the shopper's file as uploaded: the print source. Never served by /r/
//   orgs/<org>/textures/<sha>.<ext>      the same picture cut down to texture size: served, cached a year
//   orgs/<org>/snapshots/<sha>.<ext>     exported renders of a design: served, cached a year
//   orgs/<org>/designs/<id>.json         a design's settings (model, colour, where the picture sits, camera)
//   orgs/<org>/photos/<sha>.<ext>        an admin's photos of the shop's own product, sent to make a sample. Never served
//   orgs/<org>/models/<id>.json          a sample in the making: its Meshy task, progress, then its GLB
//   orgs/<org>/models/<id>.glb           the sample model itself: served, cached a year
//   meta/meshy/<yyyy-mm-dd>.json         samples started that day, across every org: the ceiling on our Meshy bill
//
// Files are named by their own SHA-256, so the same picture uploaded twice is one object, and a served key never
// changes content: the edge may keep it forever (`immutable`). A design names the files it uses, so nothing needs a
// per-shopper folder. An org's whole footprint is one prefix to list, bill or delete.

/** An org or product id: lowercase letters, digits and dashes, as it sits in a URL and a key. */
export const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const SHA = /^[0-9a-f]{64}$/;

/** What may be uploaded, how big, and as which types. The extension in the key comes from the type. */
export const KINDS = {
  original: { max: 20 << 20, types: ["image/png", "image/jpeg", "image/webp"] },
  texture: { max: 4 << 20, types: ["image/webp", "image/png", "image/jpeg"] },
  snapshot: { max: 4 << 20, types: ["image/png", "image/webp"] },
  /** Admins only: a photo of the shop's own product, for a sample. */
  photo: { max: 8 << 20, types: ["image/jpeg", "image/png", "image/webp"] },
} as const;
export type Kind = keyof typeof KINDS;
export const KIND_NAMES = Object.keys(KINDS) as Kind[];

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export const orgRoot = (org: string) => `orgs/${org}/`;
export const orgKey = (org: string) => `orgs/${org}/org.json`;
export const productKey = (org: string, product: string) => `orgs/${org}/products/${product}.json`;
export const designKey = (org: string, id: string) => `orgs/${org}/designs/${id}.json`;
export const sampleKey = (org: string, id: string) => `orgs/${org}/models/${id}.json`;
export const sampleGlb = (org: string, id: string) => `orgs/${org}/models/${id}.glb`;
export const meshyDayKey = (d = new Date()) => `meta/meshy/${d.toISOString().slice(0, 10)}.json`;
/** A sample's id: 24 hex digits, random. */
export const SAMPLE_ID = /^[0-9a-f]{24}$/;
export const fileKey = (org: string, kind: Kind, sha: string, type: string) => `orgs/${org}/${kind}s/${sha}.${EXT[type] ?? "bin"}`;

/** Whether `/r/<key>` may hand this key out: textures, snapshots, designs and sample models. Originals, photos and org settings stay private. */
export const servable = (key: string) =>
  /^orgs\/[a-z0-9][a-z0-9-]{0,62}\/models\/[0-9a-f]{24}\.glb$/.test(key) ||
  /^orgs\/[a-z0-9][a-z0-9-]{0,62}\/(textures|snapshots)\/[0-9a-f]{64}\.(webp|png|jpg)$/.test(key) ||
  /^orgs\/[a-z0-9][a-z0-9-]{0,62}\/designs\/[0-9a-f]{24}\.json$/.test(key);
