// The jam room's lane (#5205) without its view: which track the seat you're at edits, whether you may, and the edit
// itself, an op sent over the sesh as the desk's are. lane.tsx draws it with FM DAW's editors; a test drives it as is.
import type { Op, Project } from "../project.ts";
import { opNeeds, type Can } from "../grants.ts";

export const TABS = ["patch", "eq", "mixer", "notes"] as const;
export type Tab = (typeof TABS)[number];

/** Where you sit: its label, whether it's the kit, and the track it plays (-1: none). */
export interface Seat { label: string; drums: boolean; track: number }

/** What the lane needs from the room: the project, a way to send an op, your grants, and where you sit. */
export interface LaneHost {
  project(): Project;
  /** Send an op over the sesh and apply it here. */
  edit(op: Op): void;
  may(): Record<Can, boolean>;
  /** The seat you're at, or null standing. */
  seat(): Seat | null;
  /** Play the track's note for a moment. */
  audition(track: number): void;
  /** The lane opened or closed (the room lets go of the mouse while it's open, and takes it back after). */
  onToggle?(open: boolean): void;
}

export interface LaneState { open: boolean; tab: Tab; track: number; name: string | null; readOnly: { edit: boolean; mix: boolean }; refused: string | null }

/** The track a seat edits: the one it plays, or at the kit the drum track picked (the first, until another is). */
export function laneTrack(p: Project, seat: Pick<Seat, "drums" | "track"> | null, picked: number | null): number {
  if (!seat) return -1;
  if (seat.drums) {
    if (picked !== null && p.tracks[picked]?.kind === "drum") return picked;
    return p.tracks.findIndex((t) => t.kind === "drum");
  }
  return seat.track >= 0 && seat.track < p.tracks.length ? seat.track : -1;
}

/** An op from the lane, if your grants allow it (the World's own rule, opNeeds); otherwise why not. */
export function laneOp(op: Op, may: Record<Can, boolean>): { ok: true } | { ok: false; why: string } {
  const need = opNeeds(op);
  if (may[need]) return { ok: true };
  return { ok: false, why: `Read only: the leader hasn't let you ${need === "mix" ? "mix" : "edit"}. H raises your hand` };
}

export type LaneModel = ReturnType<typeof laneModel>;

/** The lane's state and moves, for a view to draw (subscribe/version) and a probe or a test to drive. */
export function laneModel(host: LaneHost) {
  let open = false, tab: Tab = "patch", picked: number | null = null, refused: string | null = null, version = 0;
  const subs = new Set<() => void>();
  const changed = () => { version++; for (const f of subs) f(); };
  const track = () => laneTrack(host.project(), host.seat(), picked);
  const setOpen = (on: boolean) => {
    if (on && track() < 0) return false;
    if (on === open) return open;
    open = on; refused = null;
    host.onToggle?.(on);
    changed();
    return open;
  };
  let seatWas = "";
  return {
    host,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    version: () => version,
    track,
    open: () => setOpen(true),
    close: () => { setOpen(false); },
    toggle: () => setOpen(!open),
    isOpen: () => open,
    tab: () => tab,
    setTab(t: Tab) { tab = t; refused = null; changed(); },
    /** At the kit: which drum's lane. */
    pick(i: number) { picked = i; changed(); },
    /** An edit from the lane: sent over the sesh when your grants allow it, else refused with why. */
    edit(op: Op): boolean {
      const ok = laneOp(op, host.may());
      refused = ok.ok ? null : ok.why;
      if (ok.ok) host.edit(op);
      changed();
      return ok.ok;
    },
    /** The project or your seat may have changed: draw again, and close if you stood up. */
    refresh() {
      const k = JSON.stringify(host.seat());
      if (k !== seatWas) { seatWas = k; picked = null; }
      if (open && track() < 0) setOpen(false); else changed();
    },
    state(): LaneState {
      const may = host.may(), i = track();
      return { open, tab, track: i, name: host.project().tracks[i]?.name ?? null, readOnly: { edit: !may.edit, mix: !may.mix }, refused };
    },
  };
}
