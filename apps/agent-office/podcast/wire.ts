// What the podcast routes answer, and what podcasts.json holds, as guards: the office (feed.ts) writes
// `x satisfies FeedsReply`, the station (player.ts) reads through the same guard. No Bun or DOM, so both import it.
import { arr, num, obj, oneOf, or, str, type Of } from "@rustybuns/util/guard";

/** The order the station goes through a show: "oldest" (from the start, the default) or "newest". */
export const Order = oneOf(["oldest", "newest"], "oldest");
const ID = /^[\w-]+$/;

/** One feed in podcasts.json. A feed without an id or an http(s) url is left out. */
export const Feed = obj({ id: str(100, { re: ID }), title: or(str(500), ""), url: str(4000, { re: /^https?:\/\// }), order: Order });
export type Feed = Of<typeof Feed>;
export const PodcastsFile = obj({ feeds: arr(Feed, 200, { drop: true }) });

export const Episode = obj({ id: str(2000), title: str(2000, { min: 0, dflt: "" }), url: str(4000), seconds: num(0, 1e7, 0), published: num(0, Number.MAX_SAFE_INTEGER, 0) });
export type Episode = Of<typeof Episode>;

/** GET /__rb/podcast: the feeds you set up (no urls: the office fetches them). */
export const FeedsReply = obj({ feeds: arr(obj({ id: str(100, { re: ID }), title: str(500, { min: 0 }), order: Order }), 200, { drop: true }) });
export type FeedsReply = Of<typeof FeedsReply>;

/** GET /__rb/podcast/episodes?feed=<id>. */
export const EpisodesReply = obj({ title: str(500, { min: 0 }), order: Order, episodes: arr(Episode, 5000, { drop: true }) });
export type EpisodesReply = Of<typeof EpisodesReply>;
