// Gamepad reading and rebindable buttons, pure where it can be so a test reaches it without a page. A game lists its
// button actions with the standard-layout button each ships on, calls `poll` once a frame, and reads sticks and
// held/pressed actions off the result. Sticks have a radial dead zone; buttons rebind in the Controls dialog.

export interface PadAction {
  id: string;
  label: string;
  /** Standard-layout button index it ships on (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 d-pad). */
  button: number;
}

/** Action id to the button it is bound to now; an action missing from it keeps its shipped button. */
export type PadBindings = Record<string, number>;

const BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Home"];
export const buttonName = (i: number): string => BUTTON_NAMES[i] ?? `Button ${i}`;

/** Stick position with a radial dead zone: inside it is 0, past it the reach rescales so the edge still hits 1. */
export function deadZone(x: number, y: number, zone = 0.15): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (!Number.isFinite(m) || m <= zone) return { x: 0, y: 0 };
  const k = Math.min(1, (m - zone) / (1 - zone)) / m;
  return { x: x * k, y: y * k };
}

/** Whatever was stored (unknown) down to bindings for known actions with no button twice; anything off is dropped. */
export function parsePadBindings(raw: unknown, actions: PadAction[]): PadBindings {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  const out: PadBindings = {};
  for (const a of actions) {
    const v = o[a.id];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 32) out[a.id] = v;
  }
  // A stored clash: the later action goes back to its shipped button rather than share one.
  const taken = new Set<number>();
  for (const a of actions) {
    if (taken.has(out[a.id] ?? a.button)) delete out[a.id];
    taken.add(out[a.id] ?? a.button);
  }
  return out;
}

export function createPadBindings(actions: PadAction[], stored: unknown = null) {
  let now = parsePadBindings(stored, actions);
  const get = (id: string): number => now[id] ?? actions.find((a) => a.id === id)?.button ?? -1;
  return {
    actions,
    get,
    isDefault: (id: string) => !(id in now),
    /** Bind the action to this button; one another action holds is refused (the label of the holder comes back). */
    set(id: string, button: number): { ok: true } | { ok: false; with: string } {
      const other = actions.find((a) => a.id !== id && get(a.id) === button);
      if (other) return { ok: false, with: other.label };
      now = { ...now, [id]: button };
      return { ok: true };
    },
    resetOne(id: string) { const { [id]: _, ...rest } = now; now = rest; },
    resetAll() { now = {}; },
    toJSON: (): PadBindings => ({ ...now }),
  };
}
export type PadBindingSet = ReturnType<typeof createPadBindings>;

/** What a pad reads as this frame. */
export interface PadState {
  connected: boolean;
  /** Left and right sticks, dead-zoned, y positive when pushed down (as the browser reports it). */
  left: { x: number; y: number };
  right: { x: number; y: number };
  /** Actions held now, and those that went down this frame. */
  held: Set<string>;
  pressed: Set<string>;
  /** Buttons that went down this frame, whatever they are bound to (the rebind dialog listens here). */
  raw: number[];
}

/** The slice of a browser Gamepad this reads, so a test can hand in a plain object. */
export interface PadSnapshot { connected: boolean; axes: readonly number[]; buttons: readonly { pressed: boolean; value?: number }[] }

const empty = (): PadState => ({ connected: false, left: { x: 0, y: 0 }, right: { x: 0, y: 0 }, held: new Set(), pressed: new Set(), raw: [] });

/** Read the first connected pad once a frame. `zone` is the stick dead zone. */
export function createPad(binds: PadBindingSet, zone = 0.15, read: () => ArrayLike<PadSnapshot | null> = () => (typeof navigator !== "undefined" ? navigator.getGamepads?.() ?? [] : [])) {
  let prev = new Set<number>();
  const first = (): PadSnapshot | null => {
    const list = read();
    for (let i = 0; i < list.length; i++) if (list[i]?.connected) return list[i];
    return null;
  };
  return {
    binds,
    /** Every button down right now, without touching `poll`'s memory of the last frame (the Controls dialog listens with this). */
    down(): number[] {
      const out: number[] = [];
      first()?.buttons.forEach((b, i) => { if (b.pressed || (b.value ?? 0) > 0.5) out.push(i); });
      return out;
    },
    poll(): PadState {
      const pad = first();
      if (!pad) { prev = new Set(); return empty(); }
      const down = new Set<number>();
      pad.buttons.forEach((b, i) => { if (b.pressed || (b.value ?? 0) > 0.5) down.add(i); });
      const s = empty();
      s.connected = true;
      s.left = deadZone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, zone);
      s.right = deadZone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, zone);
      s.raw = [...down].filter((i) => !prev.has(i));
      for (const a of binds.actions) {
        const b = binds.get(a.id);
        if (down.has(b)) { s.held.add(a.id); if (!prev.has(b)) s.pressed.add(a.id); }
      }
      prev = down;
      return s;
    },
  };
}
export type Pad = ReturnType<typeof createPad>;

/** The game's pad bindings, restored from what this browser saved under the same `key` the cog uses. */
export function loadPad(key: string, actions: PadAction[], zone?: number): Pad {
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(`${key}.pad`) ?? "null"); } catch {}
  return createPad(createPadBindings(actions, stored), zone);
}
