// A room of riders: who is in it, and where each one is. Pure, so the Durable Object, the page and the
// tests all use the same rules. Each rider simulates their own ride; the room only relays poses, so the
// worst a bad client can do is draw itself somewhere odd.
import { arr, check, int, obj, oneOf, str, type Guard } from "@rustybuns/util/guard";

/** Riders in one room, for now. */
export const MAX_RIDERS = 4;

export type Skin = "fingerboard" | "roadster";
/** What a ghost needs to draw a board: the rider group's place and turn, and the skin pivot's. */
export type Pose = {
  skin: Skin;
  /** x y z, rotation x y z of the rider group, then pivot rotation x y z and pivot height. */
  n: [number, number, number, number, number, number, number, number, number, number];
};

export type Rider = { id: string; name: string; slot: number; pose: Pose | null };
export type View = { you: string; riders: Rider[] };
/** What the world sends a page: the room as that rider sees it. */
export type ServerMsg = { t: "view"; view: View };

const LIMIT = 5000;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A pose off the wire, or null if it isn't one. Numbers are clamped so one rider can't poison the others' math. */
export function parsePose(raw: unknown): Pose | null {
  const m = raw as { skin?: unknown; n?: unknown } | null;
  if (!m || (m.skin !== "fingerboard" && m.skin !== "roadster")) return null;
  if (!Array.isArray(m.n) || m.n.length !== 10 || !m.n.every(finite)) return null;
  return { skin: m.skin, n: m.n.map((v) => Math.max(-LIMIT, Math.min(LIMIT, v))) as Pose["n"] };
}

const RIDER = obj({ id: str(), name: str(Infinity, { min: 0 }), slot: int(0, MAX_RIDERS), pose: parsePose });
const SERVER: Guard<ServerMsg> = obj({ t: oneOf(["view"]), view: obj({ you: str(), riders: arr(RIDER, MAX_RIDERS) }) });
/** The world's message read on the page, every pose through parsePose. */
export const decodeServer = (raw: unknown): ServerMsg | null => check(SERVER, raw);

export class Room {
  private riders = new Map<string, Rider>();

  get size() { return this.riders.size; }

  /** False if the room is full (a rider already in is always let back in). */
  join(id: string, name: string): boolean {
    const had = this.riders.get(id);
    if (had) { had.name = name; return true; }
    if (this.riders.size >= MAX_RIDERS) return false;
    const taken = new Set([...this.riders.values()].map((r) => r.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    this.riders.set(id, { id, name, slot, pose: null });
    return true;
  }

  leave(id: string) { this.riders.delete(id); }

  pose(id: string, p: Pose) {
    const r = this.riders.get(id);
    if (r) r.pose = p;
  }

  /** Everyone but you, with a pose. */
  view(id: string): View {
    return { you: id, riders: [...this.riders.values()].filter((r) => r.id !== id && r.pose) };
  }
}
