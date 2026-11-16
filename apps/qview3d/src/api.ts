// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Every shape that crosses the wire, as one guard both the Worker and the widget import.
import { arr, bool, int, num, obj, oneOf, opt, or, str, type Of } from "@rustybuns/util/guard";
import { ID, KIND_NAMES, SHA } from "./layout.ts";

/** The products made in code: hats, then tops. A shop's own product, made from its photos, is "custom" and names its GLB. */
export const HATS = ["cap", "beanie", "bucket"] as const;
export type HatModel = (typeof HATS)[number];
export const TOPS = ["tee", "sweater", "hoodie", "tank", "racerback"] as const;
export type TopModel = (typeof TOPS)[number];
/** The tops with sleeves: they print on a sleeve too, and can hang on a hanger (the tanks can't yet). */
export const SLEEVED: readonly Model[] = ["tee", "sweater", "hoodie"];
export const MODELS = [...HATS, ...TOPS] as const;
export type Made = (typeof MODELS)[number];
/** The print zones a product can have: a hat's front; a top's front, back and left sleeve. */
export const ZONES = ["front", "back", "left-sleeve"] as const;
export type ZoneName = (typeof ZONES)[number];
/** The zones `model` prints on: a sleeved top has all three, a tank its front and back, a hat and a shop's own model the front. */
export const zonesOf = (model: Model): readonly ZoneName[] =>
  SLEEVED.includes(model) ? ZONES : (TOPS as readonly string[]).includes(model) ? ["front", "back"] : ["front"];
export const ANY_MODEL = [...MODELS, "custom"] as const;
export type Model = (typeof ANY_MODEL)[number];
const HEX = /^#[0-9a-f]{6}$/i;

/** This app's id in eqosys's APPS, and the eqosys it trusts unless EQOSYS_URL says otherwise. */
export const APP = "qview3d";
export const EQOSYS = "https://eqosys.qntbr.com";

/** An eqosys studio's id, as it sits in a key: a UUID, or the house studio's "qntbr". */
export const STUDIO = /^[A-Za-z0-9-]{1,64}$/;

/** A site that may embed an org: its origin (https://shop.example), or "*" for any page. */
const ORIGIN = /^(\*|https?:\/\/[^/\s]+)$/;

/**
 * An org's settings (D1 `orgs`, settings.ts): which pages may embed the widget and sign uploads ("*" allows any: the
 * demo org), the SHA-256 of each admin key (scripts use them for samples and product photos), how many samples the org
 * has paid for, the eqosys studio that runs it (its owners and admins manage it signed in, orgs.ts), and whether it is
 * the public demo, which keeps no files.
 */
export const Org = obj({
  origins: arr(str(200), 50),
  admins: opt(arr(str(64, { re: SHA }), 20)),
  samples: opt(int(0, 10_000)),
  studio: opt(str(64, { re: STUDIO })),
  readOnly: opt(bool()),
  /** A sandbox (sandboxes.ts) ends then, in ms since 1970: after it the org reads as unknown. Unset: it never does. */
  expires: opt(num(0, 1e15)),
});
export type Org = Of<typeof Org>;

/** A print zone's real size on the product, in centimetres: what a print file is laid out over. */
export const PrintCm = obj({ w: num(1, 100), h: num(1, 100) });
export type PrintCm = Of<typeof PrintCm>;
const ZoneSizes = obj({ front: opt(PrintCm), back: opt(PrintCm), "left-sleeve": opt(PrintCm) });

/** Each made product's zones in centimetres, when its product names none. A shop's own model has no default: its product names them. */
export const PRINT_CM: Record<Made, Partial<Record<ZoneName, PrintCm>>> = {
  cap: { front: { w: 12, h: 6 } },
  beanie: { front: { w: 10, h: 5 } },
  bucket: { front: { w: 12, h: 5 } },
  tee: { front: { w: 30, h: 40 }, back: { w: 30, h: 40 }, "left-sleeve": { w: 9, h: 9 } },
  sweater: { front: { w: 30, h: 36 }, back: { w: 30, h: 40 }, "left-sleeve": { w: 8, h: 14 } },
  hoodie: { front: { w: 28, h: 25 }, back: { w: 32, h: 40 }, "left-sleeve": { w: 9, h: 9 } },
  tank: { front: { w: 28, h: 30 }, back: { w: 28, h: 32 } },
  racerback: { front: { w: 24, h: 28 }, back: { w: 24, h: 26 } },
};

/** Where a picture sits in its zone: 0..1 across and up, its size against the zone, and its turn. */
export const Placement = obj({ u: num(0, 1), v: num(0, 1), scale: num(0.05, 1), rotation: num(-Math.PI, Math.PI) });
export type Placement = Of<typeof Placement>;

/**
 * A shop's own model's print area: a square on its surface, centred on `point` and facing `normal` (the model's own
 * space, as a Layer's), `size` across. A picture's middle stays inside it, and the picture is never wider.
 */
export const PrintArea = obj({ point: arr(num(-10, 10), 3, { min: 3 }), normal: arr(num(-1, 1), 3, { min: 3 }), size: num(0.05, 4) });
export type PrintArea = Of<typeof PrintArea>;
/** The print area a placed picture marks: its spot and facing, as wide as it shows (model-surface.ts: scale x 1.4). */
export const areaOf = (l: { point?: number[]; normal?: number[]; scale: number }): PrintArea | null =>
  l.point && l.normal ? { point: l.point, normal: l.normal, size: Math.min(4, Math.max(0.05, l.scale * 1.4)) } : null;

/** A product's settings (D1 `products`, settings.ts): everything the widget reads when it loads one. */
export const Product = obj({
  name: str(120),
  model: oneOf(ANY_MODEL),
  /** A custom model's GLB (orgs/<org>/models/<id>.glb), served from /r/. */
  glb: opt(str(300)),
  /** The colours on offer. A custom model keeps its own texture and offers none. */
  colors: arr(str(7, { re: HEX }), 24),
  /** Its print zones' real sizes, over the defaults in PRINT_CM. */
  zones: opt(ZoneSizes),
  /** The print zones switched on, of those its model has (zonesOf). Unset: all of them. */
  print: opt(arr(oneOf(ZONES), 3, { min: 1 })),
  /** Where a new picture lands before the shopper moves it. Unset: the widget's own middle. */
  place: opt(Placement),
  /** A custom model's print area, marked on /admin.html. Unset: anywhere on it. */
  area: opt(PrintArea),
});
export type Product = Of<typeof Product>;

/** The zones a product prints on: its model's, less any it switched off. */
export const printZones = (p: Pick<Product, "model" | "print">): readonly ZoneName[] =>
  zonesOf(p.model).filter((z) => !p.print || p.print.includes(z));

/** PUT /api/orgs/<org> (QView3D's owner): make the org or change it. Its admin keys stay as they are. */
export const OrgSetup = obj({
  studio: str(64, { re: STUDIO }),
  origins: arr(str(200, { re: ORIGIN }), 50),
  samples: int(0, 10_000),
});
export type OrgSetup = Of<typeof OrgSetup>;

/** PUT /api/orgs/<org>/sites (the shop's owner or admin): the pages that may embed the widget. */
/** "Fern's Hats!" -> "fern-s-hats": an org id from a name. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");

/**
 * POST /api/mine/shops: a studio's owner or admin starts its shop. `org` names it (else the studio's name does);
 * `sandbox` keeps a sandbox instead, its products and all, with the key its link carried.
 */
export const ShopStart = obj({
  studio: str(64, { re: STUDIO }),
  org: opt(str(63, { re: ID })),
  sandbox: opt(obj({ org: str(63, { re: ID }), key: str(200) })),
});
export type ShopStart = Of<typeof ShopStart>;

export const Sites = obj({ origins: arr(str(200, { re: ORIGIN }), 50, { min: 1 }) });
export type Sites = Of<typeof Sites>;

/** An org as its shop sees it: GET /api/orgs/<org> (its admin key, or the shop signed in), and each org in GET /api/mine. */
export const Shop = obj({
  id: str(63, { re: ID }),
  origins: arr(str(200), 50),
  samples: int(0, 10_000),
  keys: int(0, 20),
  expires: opt(num(0, 1e15)),
  products: arr(obj({ id: str(63, { re: ID }), product: Product }), 200),
});
export type Shop = Of<typeof Shop>;

/** GET /api/mine: the signed-in person's shops (a studio, and its org once the owner made one), and whether they are QView3D's owner. */
export const Mine = obj({
  owner: bool(),
  shops: arr(obj({
    studio: str(64),
    name: str(60),
    role: oneOf(["owner", "admin", "maker"] as const),
    org: opt(Shop),
  }), 20),
});
export type Mine = Of<typeof Mine>;

/**
 * POST /api/sandboxes (QView3D's owner): a test shop to hand someone. `for` names it (it goes in the org id), `samples`
 * is how many of their own products Meshy may make (each costs credits), `days` how long it lasts.
 */
export const SandboxRequest = obj({ for: opt(str(60)), samples: opt(int(0, 5)), days: opt(int(1, 90)) });
export type SandboxRequest = Of<typeof SandboxRequest>;
/** The new sandbox: its org, its admin key (shown this once) and the link that carries both, to send. */
export const SandboxReply = obj({ org: str(63, { re: ID }), key: str(200), link: str(400), expires: num(0, 1e15) });
export type SandboxReply = Of<typeof SandboxReply>;

/** POST /api/orgs/<org>/keys: a new admin key for a script, shown this once (the org keeps its SHA-256). */
export const KeyReply = obj({ key: str(200) });
export type KeyReply = Of<typeof KeyReply>;

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

/**
 * POST /api/orgs/<org>/models (an admin): make a sample model from 1 to 4 product photos already uploaded (Meshy),
 * or from a scan already uploaded (the shop's iPhone made the model itself). One or the other.
 */
export const SampleRequest = obj({ name: str(120), photos: opt(arr(str(300), 4, { min: 1 })), scan: opt(str(300)) });
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

/** One zone's print file: the shopper's original (an admin fetches it), laid at `dpi` over the zone's real size. */
export const PrintSheet = obj({
  zone: oneOf(ZONES),
  cm: PrintCm,
  px: obj({ w: int(1, 20_000), h: int(1, 20_000) }),
  original: str(400),
  at: Placement,
});
export type PrintSheet = Of<typeof PrintSheet>;

/** GET /api/orgs/<org>/designs/<id>/print (an admin): a print file per zone, and the zones that can't have one, with why. */
export const PrintPlan = obj({
  design: str(24),
  model: oneOf(ANY_MODEL),
  dpi: int(72, 1200),
  sheets: arr(PrintSheet, 8),
  skipped: arr(obj({ zone: oneOf(ZONES), why: str(200) }), 8),
});
export type PrintPlan = Of<typeof PrintPlan>;
/** A pack of samples a shop can buy (billing.ts PACKS). */
export const Pack = obj({ id: str(20), samples: int(1, 1000), cents: int(0, 10_000_000) });
export type Pack = Of<typeof Pack>;
export const PROVIDERS = ["test", "stripe"] as const;

/** orgs/<org>/receipts/<id>.json: one paid pack. Its id comes from the payment's own id, so a retried webhook writes it once. */
export const Receipt = obj({
  id: str(24, { re: /^[0-9a-f]{24}$/ }),
  pack: str(20),
  samples: int(1, 1000),
  cents: int(0, 10_000_000),
  provider: oneOf(PROVIDERS),
  /** The payment's id at the provider (a Stripe Checkout session), for a refund or a question. */
  ref: str(200),
  at: num(0, 1e15),
});
export type Receipt = Of<typeof Receipt>;

/** GET /api/orgs/<org>/billing (an admin): samples paid for and used, what's for sale, and the receipts, newest first. */
export const Billing = obj({
  allowance: int(0, 1_000_000),
  used: int(0, 1_000_000),
  /** Who takes the money here: none means checkout is switched off. */
  provider: opt(oneOf(PROVIDERS)),
  packs: arr(Pack, 10),
  receipts: arr(Receipt, 500),
});
export type Billing = Of<typeof Billing>;

/** POST /api/orgs/<org>/checkout (an admin): buy a pack. */
export const CheckoutRequest = obj({ pack: str(20) });
/** Where to send the admin to pay. The test provider pays at once and names the receipt. */
export const CheckoutReply = obj({ url: str(2000), receipt: opt(str(24)) });
export type CheckoutReply = Of<typeof CheckoutReply>;

/** What a shop's webhook can hear: a design the widget saved, and an order whose print files are ready. "test" is the Send test button. */
export const HOOK_EVENTS = ["design.saved", "order.ready"] as const;
export const EVENT_TYPES = [...HOOK_EVENTS, "test"] as const;
/** A shop's own URL: https anywhere, or http on this machine (local dev and tests). */
export const HOOK_URL = /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/\S*)?$/;

/** POST /api/orgs/<org>/hooks (an admin): a URL to send events to, and which (all of them when unset). */
export const HookRequest = obj({ url: str(500, { re: HOOK_URL }), events: opt(arr(oneOf(HOOK_EVENTS), 2, { min: 1 })) });
export type HookRequest = Of<typeof HookRequest>;
/** The new webhook and its signing secret, shown this once (the org keeps it sealed). */
export const HookReply = obj({ id: str(24), secret: str(100) });
export type HookReply = Of<typeof HookReply>;

/** One send of one event to one webhook: the delivery log a shop sees, last 20. Pending ones are tried again with backoff. */
export const Delivery = obj({
  id: str(32),
  hook: str(24),
  event: oneOf(EVENT_TYPES),
  status: oneOf(["pending", "ok", "failed"] as const),
  attempts: int(0, 100),
  /** The shop's answer to the last try, or why there was none. */
  code: opt(int(0, 999)),
  error: opt(str(300)),
  at: num(0, 1e15),
  next: opt(num(0, 1e15)),
});
export type Delivery = Of<typeof Delivery>;

/** GET /api/orgs/<org>/hooks (an admin): its webhooks, and the last 20 deliveries, newest first. */
export const Hooks = obj({
  hooks: arr(obj({ id: str(24), url: str(500), events: arr(oneOf(HOOK_EVENTS), 2), created: num(0, 1e15) }), 5),
  deliveries: arr(Delivery, 20),
});
export type Hooks = Of<typeof Hooks>;

/** POST /api/orgs/<org>/orders (the script key): an order came in, a line per saved design. `id` is the store's own (#1001, a uuid). */
export const OrderRequest = obj({
  id: str(64, { re: /^[A-Za-z0-9#._:-]+$/ }),
  lines: arr(obj({ design: str(24, { re: /^[0-9a-f]{24}$/ }), qty: or(int(1, 10_000), 1) }), 100, { min: 1 }),
});
export type OrderRequest = Of<typeof OrderRequest>;

/** An order line with its print files: a sheet per zone (each with its original's link), what can't print and why, and the plan's link. */
export const OrderLine = obj({ design: str(24), qty: int(1, 10_000), print: str(400), sheets: arr(PrintSheet, 8), skipped: arr(obj({ zone: oneOf(ZONES), why: str(200) }), 8) });
export type OrderLine = Of<typeof OrderLine>;

/** POST /api/orgs/<org>/orders answers the order as recorded; `fresh` is false when the store sent it before (nothing fires twice). */
export const OrderReply = obj({ id: str(64), lines: arr(OrderLine, 100), created: num(0, 1e15), fresh: bool() });
export type OrderReply = Of<typeof OrderReply>;

/**
 * The body every webhook gets, signed in `QView3D-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * design.saved fills design, url, model and product; order.ready fills order and lines; test fills nothing.
 */
export const HookEvent = obj({
  id: str(32),
  type: oneOf(EVENT_TYPES),
  org: str(63, { re: ID }),
  created: num(0, 1e15),
  data: obj({
    design: opt(str(24)),
    url: opt(str(400)),
    model: opt(oneOf(ANY_MODEL)),
    product: opt(str(63)),
    order: opt(str(64)),
    lines: opt(arr(OrderLine, 100)),
  }),
});
export type HookEvent = Of<typeof HookEvent>;
