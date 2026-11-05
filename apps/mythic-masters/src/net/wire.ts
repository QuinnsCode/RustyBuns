// Walking the open world together (#3663): what a page and its region's room say to each other, checked on both
// sides. A party of up to six shares one room per region it stands in (src/edge/region.ts); a page sends its own
// pose at most SEND_HZ times a second and only when it moved, quantised to whole decimetres and 1/256 of a turn, and
// the room passes each one straight on to the others. Nothing here runs per frame.
import { arr, check, int, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";

/** This game's id in eqosys's APPS, and the live eqosys: the page signs in there, the Worker checks its tokens. */
export const APP = "mythic-masters";
export const EQOSYS = "https://eqosys.qntbr.com";

/** A party walks together: never more than this many in one region's room. */
export const MAX_PARTY = 6;
/** Poses a page sends a second, at most. */
export const SEND_HZ = 5;
export const SEND_MS = 1000 / SEND_HZ;
/** Decimetres to a metre: a pose is whole decimetres, which the 77 km world fits in a 20-bit number. */
export const Q = 10;
/** The world's far corner, decimetres (12 × 8 regions of 6.4 km). */
const FAR = 12 * 6400 * Q;
/** A party code, as eqosys makes them. */
export const CODE = /^[A-Z0-9]{4,12}$/;
/** A den's key (world.ts `wildsNear`, "cx,cz", or a contract's lair, "hunt:<id>"). */
const DEN = str(48, { re: /^(-?\d{1,4},-?\d{1,4}|hunt:[a-z0-9-]{1,40})$/ });
/** Close codes: the same player opened the room in another tab; the room is full. */
export const CLOSE_REPLACED = 4001, CLOSE_FULL = 4002;
/** The room's clock comes round once in this many seconds; a page keeps it as the world's clock (the day, the dens). */
export const PERIOD = 1440 * 600;

/** A page to its room: where it stands (`x`, `z` decimetres, `h` heading in 256ths of a turn), who leads its line-up,
 * and a den it walked into (the fight is the page's own; the den goes quiet for everyone there). */
export const Up: Guard<
  { t: "p"; x: number; z: number; h: number } | { t: "lead"; id: string } | { t: "calm"; den: string }
> = (v) => {
  const t = obj({ t: oneOf(["p", "lead", "calm"]) })(v).t;
  if (t === "p") return { t, ...obj({ x: int(0, FAR), z: int(0, FAR), h: int(0, 255) })(v) };
  if (t === "lead") return { t, id: obj({ id: str(40, { re: /^[a-z0-9-]+$/ }) })(v).id };
  return { t, den: obj({ den: DEN })(v).den };
};
export type Up = Of<typeof Up>;

/** Someone in the room: a seat number (what poses go by), their eqosys name and their line-up's lead. */
export const Walker = obj({ s: int(0, MAX_PARTY - 1), name: str(40), lead: str(40, { min: 0 }) });
export type Walker = Of<typeof Walker>;
/** One seat's pose: [seat, x, z, h]. */
const Pose = arr(int(0, FAR), 4, { min: 4 });

/** The room to a page: your seat, its clock and the quiet dens when you join; who is here when that changes; someone's
 * pose (a list, so a room could batch them later without a new message); a den someone walked into. */
export const Down: Guard<
  | { t: "hi"; you: number; now: number; calm: string[] }
  | { t: "who"; walkers: Walker[] }
  | { t: "v"; p: number[][] }
  | { t: "calm"; den: string; s: number }
> = (v) => {
  const t = obj({ t: oneOf(["hi", "who", "v", "calm"]) })(v).t;
  if (t === "hi") return { t, ...obj({ you: int(0, MAX_PARTY - 1), now: int(0, 1e15), calm: arr(DEN, 500) })(v) };
  if (t === "who") return { t, walkers: obj({ walkers: arr(Walker, MAX_PARTY) })(v).walkers };
  if (t === "v") return { t, p: obj({ p: arr(Pose, MAX_PARTY) })(v).p };
  return { t, ...obj({ den: DEN, s: int(0, MAX_PARTY - 1) })(v) };
};
export type Down = Of<typeof Down>;
export const down = (v: unknown) => check(Down, v);

/** A heading in radians as 256ths of a turn, and back. */
export const toH = (yaw: number) => ((Math.round((yaw / (2 * Math.PI)) * 256) % 256) + 256) % 256;
export const fromH = (h: number) => (h / 256) * 2 * Math.PI;

/** The room a party's page joins: one per party code and region, so a party spread over two regions is two rooms. */
export const roomOf = (code: string, region: number) => `${code}:${region}`;
