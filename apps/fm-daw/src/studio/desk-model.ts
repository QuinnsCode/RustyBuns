// The full desk in the jam room (#5394) without its view: the gear room's desk (src/mixer.ts `seshDesk`), a strip per
// track, one per player the live line plays sound for, and the two aux returns. Every move is the desk's own ops
// (`deskOps`), sent over the sesh when your grants allow them ("mix"), refused with why when they don't.
// desk-panel.ts draws it with the gear room's strips (src/room/desk.ts); a test drives it as is.
import type { Op, Project } from "../project.ts";
import type { Can } from "../grants.ts";
import { deskOps, seshDesk, seshShape, shapeOps, withChannel, withReturn, withSend, type Channel, type Desk, type Player, type ShapeAt } from "../mixer.ts";
import type { EqDoc } from "../engine/eq.ts";
import { laneOp } from "./lane-model.ts";

/** What the desk needs from the room: the project, who has a strip, a way to send an op, your grants, and whether you sit at the desk. */
export interface DeskHost {
  project(): Project;
  /** Everyone with a channel beyond the tracks: whoever the live line plays sound for (and you, while your guitar is in). */
  players(): Player[];
  /** Send an op over the sesh and apply it here. */
  edit(op: Op): void;
  may(): Record<Can, boolean>;
  /** You sit at the control room's desk (sitting there opens it, standing up closes it). */
  atDesk(): boolean;
  /** In the room and playing: the mixer button shows (left out: always). */
  ready?(): boolean;
  /** What is cabled into aux `aux`'s return, in words ("" for nothing). */
  cabled?(aux: number): string;
  /** The audio's sample rate, for the Shape editor's curve (left out: 48 kHz). */
  sampleRate?(): number;
  /** The desk opened or closed (the room lets go of the mouse while it's open, and takes it back after). */
  onToggle?(open: boolean): void;
}

export type DeskModel = ReturnType<typeof deskModel>;

/** The desk's state and moves, for a view to draw (subscribe/version) and a probe or a test to drive. */
export function deskModel(host: DeskHost) {
  let open = false, refused: string | null = null, version = 0, sat = false;
  const subs = new Set<() => void>();
  const changed = () => { version++; for (const f of subs) f(); };
  const desk = (): Desk => seshDesk(host.project(), host.players());
  const setOpen = (on: boolean) => {
    if (on === open) return;
    open = on; refused = null;
    host.onToggle?.(on);
    changed();
  };
  /** Take the desk to `next`: its ops over the sesh, all of them or (one refused) none. */
  const set = (next: Desk): boolean => send(deskOps(host.project(), next));
  /** Some ops over the sesh: all of them or (one refused) none. */
  const send = (ops: Op[]): boolean => {
    const may = host.may();
    const no = ops.map((op) => laneOp(op, may)).find((x) => !x.ok);
    refused = no && !no.ok ? no.why : null;
    if (!refused) for (const op of ops) host.edit(op);
    changed();
    return !refused;
  };
  return {
    host,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    version: () => version,
    desk,
    set,
    /** One Shape on the desk (a channel's, a return's or the master's) as it is, and set to `eq`. */
    shapeDoc: (at: ShapeAt) => seshShape(host.project(), host.players(), at),
    shape: (at: ShapeAt, eq: EqDoc) => send(shapeOps(host.project(), host.players(), at, eq)),
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    /** A channel's controls (ids are `desk()`'s: `track-1`, `player-<who>`). */
    channel: (id: string, ch: Partial<Omit<Channel, "id" | "source">>) => set(withChannel(desk(), id, ch)),
    /** A channel's aux send, 0 to 1. */
    send: (id: string, aux: number, v: number) => set(withSend(desk(), id, aux, v)),
    /** A return's fader, 0 to 1 (0.75 is 0 dB), or its mute. */
    ret: (aux: number, r: { fader?: number; mute?: boolean }) => set(withReturn(desk(), aux, r)),
    /** The project, the players or your seat may have changed: open at the desk, close on standing up from it, draw again. */
    refresh() {
      const now = host.atDesk();
      if (now !== sat) { sat = now; setOpen(now); return; }
      changed();
    },
    state() {
      return { open, readOnly: !host.may().mix, refused, desk: desk() };
    },
  };
}
