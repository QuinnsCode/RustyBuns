// Key rebinding, pure so a test reaches it without a page. A game lists its actions with the keys it ships (a
// `KeyboardEvent.code` each) and keeps reading those default codes; `canon` turns the key that was really pressed into
// the default code of the action it is bound to, so the game's own checks never change.

export interface Action {
  id: string;
  label: string;
  /** Keys it ships with; the first is the code the game reads. */
  keys: string[];
}

/** Action id to the codes it is bound to now; an action missing from it keeps its defaults. */
export type Bindings = Record<string, string[]>;

/** Keys that can't be taken: Esc always lets go of the mouse or pauses. */
const RESERVED = ["Escape"];

export type Result = { ok: true } | { ok: false; why: "reserved" } | { ok: false; why: "clash"; with: string };

const NAMES: Record<string, string> = {
  Space: "Space", ShiftLeft: "Shift", ShiftRight: "Right Shift", ControlLeft: "Ctrl", ControlRight: "Right Ctrl", AltLeft: "Alt", AltRight: "Right Alt",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Tab: "Tab", Enter: "Enter", Backspace: "Backspace",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]",
  // Not keys: a game that reads mouse buttons through the same bindings names them so.
  MouseLeft: "Click", MouseRight: "Right click", MouseMiddle: "Middle click",
};
/** A code the way a key cap reads it: KeyW is W, Digit1 is 1, ShiftLeft is Shift. */
export function keyName(code: string): string {
  return NAMES[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
}

/** Whatever was stored (unknown) down to bindings for known actions with no key twice; anything off is dropped. */
export function parseBindings(raw: unknown, actions: Action[]): Bindings {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  const out: Bindings = {};
  const taken = new Set<string>();
  for (const a of actions) {
    const v = o[a.id];
    if (!Array.isArray(v)) continue;
    const codes = v.filter((c): c is string => typeof c === "string" && c !== "" && !RESERVED.includes(c));
    if (codes.length) out[a.id] = codes;
  }
  // A stored clash (hand-edited save): the later action goes back to its defaults rather than share a key.
  for (const a of actions) {
    const mine = out[a.id] ?? a.keys;
    if (mine.some((c) => taken.has(c))) delete out[a.id];
    for (const c of out[a.id] ?? a.keys) taken.add(c);
  }
  return out;
}

export function createBindings(actions: Action[], stored: unknown = null) {
  let now: Bindings = parseBindings(stored, actions);
  const undo: Bindings[] = [];
  const find = (id: string) => actions.find((a) => a.id === id);
  const get = (id: string): string[] => now[id] ?? find(id)?.keys ?? [];
  const holder = (code: string, except?: string) => actions.find((a) => a.id !== except && get(a.id).includes(code));
  const commit = (next: Bindings) => { undo.push(now); now = next; };
  return {
    actions,
    get,
    /** True when the action has its shipped keys. */
    isDefault: (id: string) => !(id in now),
    /** Bind the action to this one key. A key some other action holds, or a reserved one, is refused and nothing changes. */
    set(id: string, code: string): Result {
      if (RESERVED.includes(code)) return { ok: false, why: "reserved" };
      const other = holder(code, id);
      if (other) return { ok: false, why: "clash", with: other.label };
      if (get(id).length === 1 && get(id)[0] === code) return { ok: true };
      commit({ ...now, [id]: [code] });
      return { ok: true };
    },
    /** One action back to its shipped keys, or refused when another action has taken one of them. */
    resetOne(id: string): Result {
      const a = find(id);
      if (!a || !(id in now)) return { ok: true };
      const other = a.keys.map((c) => holder(c, id)).find((h) => h !== undefined);
      if (other) return { ok: false, why: "clash", with: other.label };
      const { [id]: _, ...rest } = now;
      commit(rest);
      return { ok: true };
    },
    /** A whole layout at once (a preset): what doesn't parse, or clashes, is dropped as it would be from a save. */
    apply(next: Bindings) { commit(parseBindings(next, actions)); },
    /** Every action back to its shipped keys. */
    resetAll() { if (Object.keys(now).length) commit({}); },
    /** Take back the last change; false when there is nothing to take back. */
    undo(): boolean { const prev = undo.pop(); if (!prev) return false; now = prev; return true; },
    canUndo: () => undo.length > 0,
    /** The key that was pressed, as the default code of the action it is bound to. A shipped key whose action has moved elsewhere does nothing (""); other keys pass through. */
    canon(code: string): string {
      const a = actions.find((x) => get(x.id).includes(code));
      if (a) return a.keys[0];
      return actions.some((x) => x.keys.includes(code)) ? "" : code;
    },
    /** What to store. */
    toJSON: (): Bindings => ({ ...now }),
  };
}

export type BindingSet = ReturnType<typeof createBindings>;
