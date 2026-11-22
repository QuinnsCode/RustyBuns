// What the Worker answers and the page reads, declared once for both ends. No Bun, no DOM.
import { obj, str, type Of } from "@rustybuns/util/guard";

/** This app's id in eqosys's APPS: uploads carry a token eqosys signed for it. */
export const APP = "sharesplat";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The live page, where eqosys sends people back after signing in. */
export const SITE = "https://sharesplat.notryanquinn.workers.dev";

/** The largest splat one upload may be. A cleaned product .spz is a few MB; this leaves room for a big one. */
export const MAX_BYTES = 50 * 1024 * 1024;
/** How many products one person may host at once; they delete one to add another. */
export const MAX_PER_PERSON = 20;

/** A product's id: the first 20 hex digits of its file's SHA-256, so the same file is the same product. */
export const ID = /^[0-9a-f]{20}$/;

/** POST /api/splats: where the product now lives. */
export const Hosted = obj({
  id: str(20, { re: ID }),
  /** The .spz itself. */
  src: str(300),
  /** The one URL for the product: the spinning product alone, for an iframe or a link. */
  page: str(300),
});
export type Hosted = Of<typeof Hosted>;

/** Any route that refuses: why, in words for the seller. */
export const Problem = obj({ error: str(300) });
export type Problem = Of<typeof Problem>;

/** The `<iframe>` a seller pastes into a product description. */
export const iframeFor = (page: string) =>
  `<iframe src="${page}" style="width:100%;aspect-ratio:1;border:0" allow="fullscreen" loading="lazy"></iframe>`;
