// A studio is a sesh: the gear on the floor, the cables between its jacks and where every knob sits live in the
// World beside the groove, so friends in the room see one studio. Who is carrying what lives there too, so two
// people can't carry one amp: a pick-up is the world's call, and whoever holds a box or a cable end has it in
// their hand until they set it down, plug it in or leave. Each player hears the circuits on their own machine
// from this shared patch; nothing here is audio.
//
// Pure, no DOM: the World applies each op and passes it on, and the page applies the same ops to its own copy.
import { arr, Bad, check, num, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";

export const MAX_GEAR = 64;
export const MAX_CABLES = 128;
export const MAX_KNOBS = 16;
/** How far from the middle of the room a box can stand, in metres. */
export const ROOM_M = 50;

const ID = str(32, { re: /^[a-z0-9][a-z0-9-]*$/ });
const AT = arr(num(-ROOM_M, ROOM_M), 3, { min: 3 });
const TURN = num(-Math.PI * 2, Math.PI * 2);
/** A knob's place from all the way down (0) to all the way up (1); the gear maps it to its own range. */
const KNOB = num(0, 1);

/** One box on the floor: its own id (two pedals of one kind are two items), the gear it is, where and which way it faces. */
const Placed = obj({ id: ID, gear: ID, at: AT, turn: TURN });
export type Placed = Of<typeof Placed>;
/** An end of a cable: [item id, jack name]. */
const End = (v: unknown): [string, string] => { const [a, b] = arr(ID, 2, { min: 2 })(v); return [a, b]; };
export type End = Of<typeof End>;
const Cable = obj({ from: End, to: End });
export type Cable = Of<typeof Cable>;

/** What the sesh keeps: the patch, saved with the groove and its bucket copy. */
const Patch = obj({ placed: arr(Placed, MAX_GEAR), cables: arr(Cable, MAX_CABLES), knobs: rec(rec(KNOB, MAX_KNOBS), MAX_GEAR) });
export type Patch = Of<typeof Patch>;

/** What a player has in their hand: a box, or the free end of a cable whose other end is plugged into `from`. */
const Hand = (v: unknown): Hand => check(obj({ item: ID }), v) ?? obj({ lead: End })(v);
export type Hand = { item: string } | { lead: End };
/** Who holds what: each player (their socket's peer number) has one hand's worth. Not saved: a hand leaves with its player. */
export type Held = Record<string, Hand>;

export type Studio = { patch: Patch; held: Held };

/**
 * One thing a player does in the studio. `bring` puts a new box in their hand at their feet; `pick` takes a box
 * off the floor (or off nobody else); `put` sets what they carry down; `lead` pulls a cable out of a jack and
 * walks with its free end; `plug` pushes the free end into a jack; `drop` lets go of a lead without plugging it
 * in; `unplug` pulls out the cable in a jack; `knob` turns one; `bin` takes a box out of the room with its cables.
 */
export type StudioOp =
  | { t: "bring"; id: string; gear: string; at: number[]; turn: number }
  | { t: "pick"; id: string }
  | { t: "put"; at: number[]; turn: number }
  | { t: "lead"; from: End }
  | { t: "plug"; to: End }
  | { t: "drop" }
  | { t: "unplug"; at: End }
  | { t: "knob"; id: string; knob: string; v: number }
  | { t: "bin"; id: string };
const tag = <T extends string>(t: T) => oneOf([t]);
const OPS: Guard<StudioOp>[] = [
  obj({ t: tag("bring"), id: ID, gear: ID, at: AT, turn: TURN }),
  obj({ t: tag("pick"), id: ID }),
  obj({ t: tag("put"), at: AT, turn: TURN }),
  obj({ t: tag("lead"), from: End }),
  obj({ t: tag("plug"), to: End }),
  obj({ t: tag("drop") }),
  obj({ t: tag("unplug"), at: End }),
  obj({ t: tag("knob"), id: ID, knob: ID, v: KNOB }),
  obj({ t: tag("bin"), id: ID }),
];
export const decodeStudioOp = (v: unknown): StudioOp | null => OPS.reduce<StudioOp | null>((got, g) => got ?? check(g, v), null);
const OP = (v: unknown) => { const op = decodeStudioOp(v); if (!op) throw new Bad("a studio op"); return op; };

/** Page to world: one thing done in the studio. */
export type StudioClient = { t: "studio"; op: StudioOp };
/**
 * World to page: the whole studio (on joining, or to put a player back in step when the world said no), then each op a
 * player did. `you`: your own number on the live line, on joining, so the page knows which hand in `held` is its own.
 */
export type StudioServer = { t: "studio-all"; studio: Studio; you?: number } | { t: "studio-op"; from: number; op: StudioOp };
const PEER = num(1, Infinity);
const HELD = rec(Hand, 64);
const CLIENT = obj({ t: tag("studio"), op: OP });
const SERVER: Guard<StudioServer>[] = [
  obj({ t: tag("studio-all"), studio: obj({ patch: Patch, held: HELD }), you: opt(PEER) }),
  obj({ t: tag("studio-op"), from: PEER, op: OP }),
];
export const decodeStudioClient = (v: unknown): StudioClient | null => check(CLIENT, v);
export const decodeStudioServer = (v: unknown): StudioServer | null => SERVER.reduce<StudioServer | null>((got, g) => got ?? check(g, v), null);
/** A saved patch, fitted: anything that isn't one reads as an empty room. */
export const sanitizePatch = (v: unknown): Patch => check(Patch, v) ?? emptyPatch();

export const emptyPatch = (): Patch => ({ placed: [], cables: [], knobs: {} });
export const emptyStudio = (): Studio => ({ patch: emptyPatch(), held: {} });

const same = (a: End, b: End) => a[0] === b[0] && a[1] === b[1];
const holder = (held: Held, has: (h: Hand) => boolean) => Object.keys(held).find((p) => has(held[p]));
const inJack = (s: Studio, end: End) =>
  s.patch.cables.some((c) => same(c.from, end) || same(c.to, end)) ||
  !!holder(s.held, (h) => "lead" in h && same(h.lead, end));
const placed = (s: Studio, id: string) => s.patch.placed.some((p) => p.id === id);

/**
 * Pure: the studio after player `peer` did `op`, or the same studio when they can't: a box someone else has,
 * a full hand, a jack with a cable in it already, a box that isn't in the room. The World keeps the answer and
 * passes the op on only when it changed something, so every copy takes the same steps.
 */
export function applyStudio(s: Studio, peer: number, op: StudioOp): Studio {
  const me = String(peer), hand = s.held[me];
  const hold = (h: Hand | null): Studio => {
    const held = { ...s.held };
    if (h) held[me] = h; else delete held[me];
    return { ...s, held };
  };
  const patch = (p: Partial<Patch>, h?: Hand | null): Studio => {
    const next = { ...s, patch: { ...s.patch, ...p } };
    return h === undefined ? next : { ...next, held: hold(h).held };
  };
  switch (op.t) {
    case "bring":
      if (hand || placed(s, op.id) || s.patch.placed.length >= MAX_GEAR) return s;
      return patch({ placed: [...s.patch.placed, { id: op.id, gear: op.gear, at: op.at, turn: op.turn }] }, { item: op.id });
    case "pick":
      // two people can't carry one amp
      if (hand || !placed(s, op.id) || holder(s.held, (h) => "item" in h && h.item === op.id)) return s;
      return hold({ item: op.id });
    case "put":
      if (!hand || !("item" in hand)) return s;
      return patch({ placed: s.patch.placed.map((p) => (p.id === hand.item ? { ...p, at: op.at, turn: op.turn } : p)) }, null);
    case "lead":
      if (hand || !placed(s, op.from[0]) || inJack(s, op.from) || s.patch.cables.length >= MAX_CABLES) return s;
      return hold({ lead: op.from });
    case "plug":
      if (!hand || !("lead" in hand) || !placed(s, op.to[0]) || same(hand.lead, op.to) || inJack(s, op.to)) return s;
      return patch({ cables: [...s.patch.cables, { from: hand.lead, to: op.to }] }, null);
    case "drop":
      return hand && "lead" in hand ? hold(null) : s;
    case "unplug": {
      const cables = s.patch.cables.filter((c) => !same(c.from, op.at) && !same(c.to, op.at));
      return cables.length === s.patch.cables.length ? s : patch({ cables });
    }
    case "knob": {
      if (!placed(s, op.id) || s.patch.knobs[op.id]?.[op.knob] === op.v) return s;
      const mine = s.patch.knobs[op.id] ?? {};
      if (!(op.knob in mine) && Object.keys(mine).length >= MAX_KNOBS) return s;
      return patch({ knobs: { ...s.patch.knobs, [op.id]: { ...mine, [op.knob]: op.v } } });
    }
    case "bin": {
      // a box someone else is carrying stays theirs
      const by = holder(s.held, (h) => "item" in h && h.item === op.id);
      if (!placed(s, op.id) || (by && by !== me)) return s;
      const knobs = { ...s.patch.knobs };
      delete knobs[op.id];
      const next = patch({
        placed: s.patch.placed.filter((p) => p.id !== op.id),
        cables: s.patch.cables.filter((c) => c.from[0] !== op.id && c.to[0] !== op.id),
        knobs,
      });
      // a lead pulled out of the binned box goes with it
      const held = Object.fromEntries(Object.entries(next.held).filter(([, h]) => ("item" in h ? h.item : h.lead[0]) !== op.id));
      return { ...next, held };
    }
  }
}

/** A player left: whatever was in their hand stays where it is (a box) or falls out (a lead). */
export function letGo(s: Studio, peer: number): Studio {
  if (!(String(peer) in s.held)) return s;
  const held = { ...s.held };
  delete held[String(peer)];
  return { ...s, held };
}

/** What a player is holding, for the room to draw in their hand. */
export const inHand = (s: Studio, peer: number): Hand | undefined => s.held[String(peer)];

/** The steps that build `patch` in an empty studio: each box brought and set down, each cable led and plugged, each knob turned. */
export function patchOps(patch: Patch): StudioOp[] {
  return [
    ...patch.placed.flatMap((p): StudioOp[] => [{ t: "bring", id: p.id, gear: p.gear, at: p.at, turn: p.turn }, { t: "put", at: p.at, turn: p.turn }]),
    ...patch.cables.flatMap((c): StudioOp[] => [{ t: "lead", from: c.from }, { t: "plug", to: c.to }]),
    ...Object.entries(patch.knobs).flatMap(([id, ks]) => Object.entries(ks).map(([knob, v]): StudioOp => ({ t: "knob", id, knob, v }))),
  ];
}
