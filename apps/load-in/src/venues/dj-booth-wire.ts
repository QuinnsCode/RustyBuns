// The DJ booth wired the way a player does it, through the page's own harness: to the case, take a cable, carry it,
// plug both ends, for every run, then everything switched on. `?level=dj-booth&wired=1` opens the booth ready to
// play (for a listen, or a shot), and `loadIn.wireBooth()` does the same from the console. Returns what failed.

type Lead = "power" | "rca" | "ground" | "xlr" | "speaker";
/** The harness calls the wiring needs (`window.loadIn` has them all). */
export type BoothHands = {
  state(): { you: { x: number; z: number }; cables: { key: string; kind: string; coiled: boolean }[]; decks?: { kind?: string } | null };
  walkTo(x: number, z: number): unknown;
  takeCable(kind: Lead): { ok: boolean; why?: string };
  plug(owner: string, jack: string): { ok: boolean; why?: string };
  grabEnd(key: string, end: "a" | "b"): { ok: boolean; why?: string };
  dropEnd(): unknown;
  power(key: string, on?: boolean): unknown;
};

/** The lane behind the booth, and where to stand for each jack's owner. */
const LANE = 0.75;
const STAND: Record<string, [number, number]> = {
  case: [2.45, 1.2], "deck-1": [0.4, LANE], "deck-2": [-0.4, LANE], mixer: [0, LANE], distro: [0.6, LANE], "wall-1": [-1.2, LANE],
  "wall-2": [1.2, LANE], rack: [-2.2, LANE], "mon-l": [0.9, LANE], "mon-r": [-0.9, LANE], "top-l": [2.45, 1.2], "top-r": [-2.1, 1.0], sub: [-0.7, 2.6],
};

export function wireBooth(L: BoothHands): string[] {
  const fail: string[] = [], vinyl = L.state().decks?.kind === "vinyl", input = vinyl ? "phono-in-" : "rca-in-";
  const go = (to: string) => {
    const [x, z] = STAND[to]!, you = L.state().you, out = you.z > 2;
    // The room side goes round the left end of the booth, past the rack's stand-off.
    if (out) { L.walkTo(-2.1, 2.6); L.walkTo(-2.1, LANE); }
    L.walkTo(you.x > 2.2 && !out ? 2.3 : L.state().you.x, LANE);
    if (to === "sub") { L.walkTo(-2.1, LANE); L.walkTo(-2.1, 2.6); L.walkTo(x, z); return; }
    L.walkTo(Math.min(x, 2.3), LANE);
    L.walkTo(x, z);
  };
  const run = (kind: Lead, a: string, b: string) => {
    const [ao, aj] = a.split(" ") as [string, string], [bo, bj] = b.split(" ") as [string, string];
    go("case");
    // The case hands out the first coiled cable of a kind.
    const key = L.state().cables.find((c) => c.kind === kind && c.coiled)?.key;
    let r = L.takeCable(kind);
    if (!r.ok || !key) return void fail.push(`${kind}: ${r.why ?? "none left in the case"}`);
    go(ao); r = L.plug(ao, aj);
    if (!r.ok) { fail.push(`${a}: ${r.why}`); L.dropEnd(); return; }
    go("case"); r = L.grabEnd(key, "b");
    if (!r.ok) return void fail.push(`${key} b: ${r.why}`);
    go(bo); r = L.plug(bo, bj);
    if (!r.ok) { fail.push(`${b}: ${r.why}`); L.dropEnd(); }
  };
  run("power", "wall-2 power-out-1", "distro power-in");
  ["deck-1", "deck-2", "mixer", "mon-l", "mon-r"].forEach((k, i) => run("power", `distro power-out-${i + 1}`, `${k} power-in`));
  run("power", "wall-2 power-out-2", "top-l power-in");
  run("power", "wall-1 power-out-1", "sub power-in");
  run("power", "wall-1 power-out-2", "top-r power-in");
  run("rca", "deck-1 rca-out", `mixer ${input}2`);
  run("rca", "deck-2 rca-out", `mixer ${input}3`);
  if (vinyl) { run("ground", "deck-1 ground-out", "mixer ground-in-1"); run("ground", "deck-2 ground-out", "mixer ground-in-2"); }
  run("xlr", "mixer xlr-out-3", "mon-l xlr-in");
  run("xlr", "mixer xlr-out-4", "mon-r xlr-in");
  run("xlr", "mixer xlr-out-1", "top-l xlr-in");
  run("xlr", "top-l xlr-out", "sub xlr-in");
  run("xlr", "mixer xlr-out-2", "top-r xlr-in");
  for (const k of ["deck-1", "deck-2", "mixer", "mon-l", "mon-r", "top-l", "top-r", "sub"]) L.power(k, true);
  // Back round the left end of the booth to the DJ's spot.
  L.walkTo(-2.1, 2.6); L.walkTo(-2.1, LANE); L.walkTo(0, LANE);
  return fail;
}
