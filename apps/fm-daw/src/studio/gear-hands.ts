// The gear room's hands in the jam room: pick up, set down, cables and knobs at the studio's gear wall (gear-wall.ts),
// on the sesh's patch. It is room.ts's Room, kept in step with the World as the gear room page keeps its own, with
// your body put into the gear room's frame each time you reach. What a guitar plays through comes out of the same
// patch, so every page in the sesh hears the chain cabled at the wall, from where its cab stands. Pure: no DOM.
import { type Aim, type Answer, type Room, aimed, boardIn, drop, gearOf, hand, heldId, hint, item, knobValue, landingPose, listen, lookAt, newRoom, openJacks, setKnob, startPatch, turnHeld, use } from "../room/room.ts";
import { applyStudio, patchOps, type StudioOp, type StudioServer } from "../studio.ts";
import type { AmpSettings } from "../amp/messages.ts";
import { gearBounds, gearPlace, toGear, toStudio } from "./gear-wall.ts";
import type { Jam } from "./jam.ts";
import type { StudioDef } from "./room.ts";

export class GearHands {
  readonly room: Room;
  private seeded = false;
  /** Whether the World has said which hand is yours: until it has, the gear stays where it is. */
  joined = false;
  /** The knob a held click turns, as you drag. */
  turning: { id: string; knob: string } | null = null;

  constructor(readonly def: StudioDef, send: (op: StudioOp) => void) {
    this.room = newRoom(startPatch());
    this.room.bounds = gearBounds(def);
    this.room.sent = send;
  }

  /** The World's gear room: all of it (with your number on the live line), one step someone else took, or a bench board. */
  onStudio(m: StudioServer) {
    const r = this.room;
    if (m.t === "studio-board") { boardIn(m.board); return; }
    if (m.t === "studio-op") { if (m.from !== r.me || !this.joined) r.studio = applyStudio(r.studio, m.from, m.op); return; }
    if (m.you) { r.me = m.you; this.joined = true; }
    if (m.studio.patch.placed.length || this.seeded || !this.joined) { r.studio = m.studio; this.seeded ||= m.studio.patch.placed.length > 0; return; }
    // nobody has set the gear out in this sesh yet: the wall as it starts goes in, once
    this.seeded = true;
    r.studio = { patch: startPatch(), held: {} };
    for (const step of patchOps(r.studio.patch)) r.sent?.(step);
  }

  /** Your body (and everyone else's, for what they carry) into the gear room's frame: call before anything that reaches. */
  reach(j: Jam): Room {
    const r = this.room, g = gearPlace(this.def), [x, z] = toGear(g, j.me.x, j.me.z);
    r.you = { x, z, yaw: j.me.yaw - g.yaw, pitch: j.me.pitch };
    r.bodies.clear();
    for (const [peer, o] of j.others) { const [ox, oz] = toGear(g, o.at[0], o.at[1]); r.bodies.set(peer, { x: ox, z: oz, yaw: o.yaw - g.yaw }); }
    return r;
  }

  /** Turn to look straight at a box on the wall, or one of its jacks or knobs, from where you stand; then what you aim at. */
  lookAt(j: Jam, id: string, part?: string): Aim | null {
    const r = this.reach(j);
    if (!lookAt(r, id, part)) return null;
    j.me.yaw = r.you.yaw + gearPlace(this.def).yaw;
    j.me.pitch = r.you.pitch;
    return this.aim(j);
  }
  /** Where a box on the wall stands on the studio's floor (x, z), to walk up to; null for none. */
  at(id: string): [number, number] | null { const p = item(this.room, id); return p ? toStudio(gearPlace(this.def), p.at[0], p.at[2]) : null; }

  /** What you look at on the wall within reach (a jack, a knob, a box), or null: then a click is the jam room's (sit). */
  aim(j: Jam): Aim | null { return j.me.seat ? null : aimed(this.reach(j)); }
  /** Whether a click is the wall's: you carry something, or you look at something on it. */
  wants(j: Jam): boolean { return !j.me.seat && this.joined && (!!hand(this.reach(j)) || !!this.aim(j)); }

  /** A click (or F): set down, plug, unplug, take a cable, pick up; on a knob, hold and drag to turn it. */
  click(j: Jam): Answer {
    if (!this.joined) return { ok: false, why: "The sesh's gear is on its way" };
    const a = this.aim(j);
    if (a?.t === "knob" && !hand(this.room)) { this.turning = { id: a.id, knob: a.knob }; return { ok: true }; }
    return use(this.room, a);
  }
  /** Drag while turning a knob: up turns it up. */
  drag(dy: number) {
    const t = this.turning, p = t && item(this.room, t.id), k = p && gearOf(p)?.knobs.find((x) => x.name === t.knob);
    if (t && p && k) setKnob(this.room, t.id, t.knob, knobValue(this.room.studio.patch, t.id, k) - dy * 0.004);
  }
  /** Let go of the cable in your hand (G, right-click). */
  letGo(): Answer { return drop(this.room); }
  /** Turn what you carry (Q, E): -1 left, 1 right. False when your hands are empty, so the key does what it did. */
  turn(dir: number): boolean { if (!heldId(this.room)) return false; turnHeld(this.room, dir); return true; }
  /** The line under the crosshair at the wall, or "" away from it. */
  hint(j: Jam): string { return this.wants(j) ? hint(this.reach(j), this.aim(j)) : ""; }

  /**
   * What a guitar plays through here: the patch's chain from the guitar to a cab, and where that cab stands on the
   * studio's floor. Null when nothing is cabled through to a cab: each guitar keeps its track's amp.
   */
  rig(): { settings: AmpSettings; at: [number, number]; chain: string[] } | null {
    const patch = this.room.studio.patch, h = listen(patch, 2), cab = h.playing ? item(this.room, h.chain[h.chain.length - 1]) : undefined;
    const from = h.chain[0] ? item(this.room, h.chain[0]) : undefined;
    if (!h.settings || !cab || from?.gear !== "guitar") return null;
    return { settings: h.settings, at: toStudio(gearPlace(this.def), cab.at[0], cab.at[2]), chain: h.chain };
  }

  /** For the harness (qjam.state().gear): the patch, what you hold and aim at, where a box you carry would land, and what plays. */
  state(j: Jam) {
    const r = this.reach(j), heard = listen(r.studio.patch, 2);
    return {
      joined: this.joined, place: gearPlace(this.def), holding: hand(r) ?? null, aimed: this.aim(j), lands: landingPose(r), open: openJacks(r),
      items: r.studio.patch.placed.map((p) => ({ id: p.id, gear: p.gear, at: p.at.map((v) => Math.round(v * 100) / 100) })),
      cables: r.studio.patch.cables, knobs: r.studio.patch.knobs,
      heard: { playing: heard.playing, chain: heard.chain, problems: heard.problems, returns: heard.returns.map((x) => ({ aux: x.aux, whole: x.whole, chain: x.chain, problems: x.problems })) },
      guitar: this.rig()?.chain ?? null,
    };
  }
}
