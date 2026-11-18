// Line check: before a band plays, each player plays alone and the engineer listens for it on the channel the input
// list gives it. What a channel carries is traced through the real path: the source's XLR (mic or DI) into a stage
// box input, that input's pair down the snake, out of the fan's tail of the same number into the desk channel of that
// number. What goes wrong on a real night, seeded as `Fault`s: a dead cable (nothing comes up: swap it), a crackling
// connector (it comes up crackling: swap it), two stage box inputs crossed (the previous crew's labels: the kick
// comes up on 4, so repatch it into the input that lands on 1), and a ground loop through the bass DI (it hums until
// its ground lift is pressed). A condenser with the desk's 48 V off is silent too, seeded or not.
// Plain data, no DOM.
import { gear as catalog } from "./catalog.ts";
import type { Cable, Placed, Problem } from "./patch.ts";

/** A cable as the game lays it: its own key, so a dead one stays dead wherever it is plugged. */
export type KeyedCable = Cable & { key: string };

/** A fault on tonight's stage. Pairs are stage box input numbers, 1 to 12. */
export type Fault =
  | { kind: "dead"; cable: string }
  | { kind: "crackle"; cable: string }
  | { kind: "crossed"; a: number; b: number }
  | { kind: "hum"; di: string };

/** One line of the input list: the channel it wants, what it is, and the mic or DI that picks it up. */
export type Line = { channel: number; what: string; source: string };

export type Sound = "clean" | "hum" | "crackle" | "silent";

/** What a line check of one input finds: the desk channel it comes up on (null: nowhere), and how it sounds there. */
export type Heard = { channel: number; what: string; source: string; on: number | null; sound: Sound; ok: boolean; why: string | null };

const STAGE_BOX = "stage-box-12", FAN = "snake-fan-12";
const num = (jack: string) => Number(jack.match(/-(\d+)$/)?.[1] ?? 0);

/** The pair a stage box input comes out on at the fan, with tonight's crossed pairs. */
function pairOf(input: number, faults: readonly Fault[]): number {
  for (const f of faults) if (f.kind === "crossed") {
    if (input === f.a) return f.b;
    if (input === f.b) return f.a;
  }
  return input;
}

/**
 * Line-check every input on the list. `desk` is the desk's item id (its `phantom` is the 48 V switch; `powered`: it has
 * mains). The fan's tails go into the desk channels of their own numbers.
 */
export function lineCheck(placed: readonly Placed[], cables: readonly KeyedCable[], lines: readonly Line[], faults: readonly Fault[], desk: { id: string; powered: boolean }): Heard[] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  const at = (id: string, jack: string) => cables.find((c) => [c.from, c.to].some(([i, j]) => i === id && j === jack));
  const other = (c: Cable, id: string) => (c.from[0] === id ? c.to : c.from);
  const gearOf = (id: string) => byId.get(id)?.gear ?? "";
  const snake = cables.find((c) => c.kind === "multi" && [c.from, c.to].some(([i]) => gearOf(i) === STAGE_BOX) && [c.from, c.to].some(([i]) => gearOf(i) === FAN));
  const phantom = !!byId.get(desk.id)?.phantom;

  return lines.map((l): Heard => {
    const out = (on: number | null, sound: Sound, why: string | null): Heard => ({ channel: l.channel, what: l.what, source: l.source, on, sound, ok: on === l.channel && sound === "clean", why });
    const src = byId.get(l.source);
    if (!src) return out(null, "silent", `${l.what}: its ${l.source} is not on stage`);
    const run = at(l.source, "xlr-out");
    if (!run) return out(null, "silent", `${l.what}: nothing is plugged into ${l.source}`);
    const [box, jack] = other(run, l.source);
    if (gearOf(box) !== STAGE_BOX) return out(null, "silent", `${l.what}: ${l.source}'s cable goes to ${box}, not the stage box`);
    if (!snake) return out(null, "silent", `${l.what}: the snake is not in between the stage box and the fan`);
    if (!desk.powered) return out(null, "silent", `${l.what}: the desk has no power`);
    const on = pairOf(num(jack), faults);
    if (faults.some((f) => f.kind === "dead" && f.cable === run.key)) return out(null, "silent", `${l.what}: nothing on any channel. Cable ${run.key} is dead: swap it`);
    if (catalog(src.gear).mic?.phantom && !phantom) return out(null, "silent", `${l.what}: a condenser with the desk's 48 V off makes no sound`);
    const wrong = on !== l.channel ? `${l.what} comes up on channel ${on}, wants ${l.channel}` : null;
    if (faults.some((f) => f.kind === "crackle" && f.cable === run.key)) return out(on, "crackle", `${l.what} crackles: cable ${run.key} has a bad connector, swap it${wrong ? `; and ${wrong}` : ""}`);
    if (faults.some((f) => f.kind === "hum" && f.di === l.source) && !src.lift) return out(on, "hum", `${l.what} hums: a ground loop through ${l.source}, press its ground lift${wrong ? `; and ${wrong}` : ""}`);
    return out(on, "clean", wrong);
  });
}

/** The faults a line check leaves, as problems: what is still wrong on the list. */
export function lineProblems(heard: readonly Heard[]): Problem[] {
  return heard.filter((h) => !h.ok).map((h) => ({
    kind: h.sound === "hum" ? "hum" : h.sound === "crackle" ? "crackle" : h.on === null ? "dead" : "crossed",
    items: [h.source],
    jack: "xlr-out",
    message: h.why ?? `${h.what} is not right`,
  }));
}
