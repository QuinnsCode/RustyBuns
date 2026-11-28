// The one control map (#6474): what can be driven (a light's dimmer, a scene, the room's level, a lesson, OBS), and
// which message from outside drives it. A button, Cmd+K, WebMCP, a MIDI fader and an OSC message all end in
// `drive(id, value)`, so each thing is done one way. Pairings are learned (arm a control, move one on the
// controller) and kept in this browser; the DJ decks' MIDI learn keeps its own with the same store.
// Pure but for localStorage: no DOM, no three.
import { check, rec, str } from "@rustybuns/util/guard";

// ---- learned pairings: source (a controller's name, "osc") -> message key -> control id

const Learned = rec(rec(str(200), 512), 64);
export type Learned = Record<string, Record<string, string>>;

export function learnedMap(storage: string) {
  const load = (): Learned => { try { const s = localStorage.getItem(storage); return (s && check(Learned, JSON.parse(s))) || {}; } catch { return {}; } };
  const map = load();
  const save = () => { try { localStorage.setItem(storage, JSON.stringify(map)); } catch { /* private window: this visit only */ } };
  return {
    all: (): Readonly<Learned> => map,
    get: (source: string, key: string): string | undefined => map[source]?.[key],
    /** This message drives `id` from now on, in place of any this source had for it. */
    pair(source: string, key: string, id: string) {
      const mine = (map[source] ??= {});
      for (const k of Object.keys(mine)) if (mine[k] === id) delete mine[k];
      mine[key] = id;
      save();
    },
    forget(source: string, key: string): boolean {
      const mine = map[source];
      if (!mine?.[key]) return false;
      delete mine[key];
      if (!Object.keys(mine).length) delete map[source];
      save();
      return true;
    },
  };
}

// ---- what can be driven

/** A `level` takes 0 to 1 (a fader); a `press` happens each time it is pressed (a button). */
export interface Control {
  id: string;
  label: string;
  kind: "level" | "press";
  /** Do it; the answer is why not, or null when done. */
  drive(value: number): string | null;
  /** A level as it stands, 0 to 1. */
  value?(): number;
}

/** A message from outside: who sent it, which of its controls, how far (0 to 1) and whether it is down. */
export interface Signal {
  source: string;
  key: string;
  value: number;
  down: boolean;
  /** A button with no release (an OSC message with no value): every one is a new press. */
  momentary?: boolean;
  /** The control the message names itself (an OSC /qollab/ address): needs no learning. */
  to?: string;
}

export type Drove = { ok: true; id: string; value: number } | { ok: false; why: string };

export function controlMap(controls: () => readonly Control[], learned: ReturnType<typeof learnedMap>) {
  let armed: string | null = null;
  /** Messages held down, so a pad or a CC stream presses once. */
  const held = new Set<string>();
  const find = (id: string) => controls().find((c) => c.id === id);

  function drive(id: string, value: number): Drove {
    const c = find(id);
    if (!c) return { ok: false, why: `No control ${id}` };
    const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const why = c.drive(v);
    return why === null ? { ok: true, id, value: v } : { ok: false, why };
  }

  return {
    controls,
    drive,
    armed: () => armed,
    /** The next message that comes in is paired with this control (null: stop waiting). */
    arm(id: string | null) { armed = id && find(id) ? id : null; return armed; },
    /** A message in: pairs the armed control, or drives what it names or was paired with. Null: nothing was driven. */
    handle(s: Signal): Drove | null {
      const at = `${s.source}\n${s.key}`, was = held.has(at);
      if (s.down && !s.momentary) held.add(at); else held.delete(at);
      if (armed) {
        // a release isn't a pick: the next press or move is
        if (s.value > 0 || s.down) { learned.pair(s.source, s.key, armed); armed = null; }
        return null;
      }
      const id = s.to ?? learned.get(s.source, s.key);
      const c = id ? find(id) : undefined;
      if (!c) return null;
      if (c.kind === "press" && (!s.down || was)) return null;
      return drive(c.id, c.kind === "press" ? 1 : s.value);
    },
  };
}
export type ControlMap = ReturnType<typeof controlMap>;
