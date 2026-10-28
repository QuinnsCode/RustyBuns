// The vote screen's live line between the seats (net.ts on the page, edge/campaign.ts on the world): one type
// each way, decoded once. Coordinates are 0..1 across the vote screen, kept to three places.
import { check, num, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";
import { clamp01 } from "@rustybuns/util";
import { MATCH_MODES, type Faction } from "./battle/contract.ts";
import { FACTIONS } from "./war/rules.ts";
import type { Vote } from "./war/table.ts";

/** Page to world: the seat token first (not in the URL), then where its pointer is. */
export type PointerIn = { t: "hello"; token: string } | { t: "at"; x: number; y: number };
/** World to page: you're in, another seat's pointer, or the votes as they land. */
export type PointerOut = { t: "hi"; seat: Faction } | { t: "at"; seat: Faction; x: number; y: number } | { t: "vote"; vote: Vote };

const unit = (v: unknown) => Math.round(clamp01(num(-Infinity, Infinity)(v)) * 1000) / 1000;
const tag = <T extends string>(t: T) => oneOf([t]);
const seat = oneOf(FACTIONS), mode = oneOf(MATCH_MODES);
const IN: Guard<PointerIn>[] = [obj({ t: tag("hello"), token: str(128, { min: 16, re: /^\S+$/ }) }), obj({ t: tag("at"), x: unit, y: unit })];
const OUT: Guard<PointerOut>[] = [
  obj({ t: tag("hi"), seat }),
  obj({ t: tag("at"), seat, x: unit, y: unit }),
  obj({ t: tag("vote"), vote: obj({ match: str(), votes: obj({ marines: opt(mode), wooka: opt(mode) }), picked: (v: unknown) => (v === null ? null : mode(v)) }) }),
];

export const decodeIn = (v: unknown): PointerIn | null => IN.reduce<PointerIn | null>((got, g) => got ?? check(g, v), null);
export const decodeOut = (v: unknown): PointerOut | null => OUT.reduce<PointerOut | null>((got, g) => got ?? check(g, v), null);
