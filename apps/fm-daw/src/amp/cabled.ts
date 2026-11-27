// What the cables make Q Amp play: the chains `compile` finds (src/circuit/patch.ts) turned into the pedalboard the
// audio thread runs (`AmpSettings.chain`), and the board's tile order read back off them. Plain TS, no DOM.
import { seriesCables, type Cable, type End } from "../circuit/patch.ts";
import type { BoardPedal, ChainSlot } from "./messages.ts";

/** The amp's tile (pedalboard.ts `AMP_SLOT`) and its gear in the patch. */
const AMP = "amp", HEAD = "head";

/**
 * The slots the audio thread plays for these audible chains (`audibleChains`), and the item each is for. `slotOf`
 * is a pedal or machine as it plays now (null when it is switched off or isn't one). The amp is its first pass;
 * what comes back from its return is in its loop. Chains that part at an A/B split and meet again play their
 * sides side by side, blended evenly; sides with a machine or the amp on them can't, so the first chain plays.
 */
export function cabledChain(all: readonly string[][], slotOf: (id: string) => ChainSlot | null): { chain: ChainSlot[]; ids: string[] } {
  const chain: ChainSlot[] = [], ids: string[] = [];
  const chains = [...new Map(all.map((c) => [c.join(" "), c])).values()];
  let amp = false;
  const put = (id: string) => {
    if (id === HEAD) { if (!amp) { amp = true; chain.push({ amp: true }); ids.push(AMP); } return; }
    const slot = slotOf(id);
    if (slot) { chain.push(slot); ids.push(id); }
  };
  if (!chains.length) return { chain, ids };
  const [first] = chains, short = Math.min(...chains.map((c) => c.length));
  let pre = 0, post = 0;
  while (pre < short && chains.every((c) => c[pre] === first[pre])) pre++;
  while (post < short - pre && chains.every((c) => c[c.length - 1 - post] === first[first.length - 1 - post])) post++;
  const sides = chains.map((c) => c.slice(pre, c.length - post));
  const pedals = sides.map((side) => side.map((id) => (id === HEAD ? undefined : slotOf(id))));
  // A switched-off pedal is a gap on its side; the amp or a machine that is on can't sit on one.
  const parallel = chains.length > 1 && pedals.every((side) => side.every((s) => s === null || (s && "pedal" in s)));
  if (!parallel) { first.forEach(put); return { chain, ids }; }
  first.slice(0, pre).forEach(put);
  const split = pedals.map((side) => side.filter((s): s is BoardPedal => !!s && "pedal" in s));
  if (split.some((side) => side.length)) { chain.push({ split, mix: split.map(() => 1 / split.length) }); ids.push("split"); }
  first.slice(first.length - post).forEach(put);
  return { chain, ids };
}

/**
 * The cables once a tile is dragged to a new place on the board: every tile cabled one after the next in `order`,
 * those before the amp's tile into its input, those after it through its send and return. A split, and anything
 * else run through the board, is laid back out in that row; the speaker cable stays as it was.
 */
export function relay(order: readonly string[], cables: readonly Cable[]): Cable[] {
  const amp = order.indexOf(AMP), tiles = new Set(order);
  const onBoard = ([item, jack]: End) => tiles.has(item) || item === "split" || item === "blend" || item === "guitar" || (item === HEAD && jack !== "speaker");
  const kept = cables.filter((c) => !onBoard(c.from) && !onBoard(c.to));
  const laid = seriesCables(order.slice(0, Math.max(0, amp)), amp < 0 ? [] : order.slice(amp + 1)).filter((c) => c.from[1] !== "speaker");
  return [...laid, ...kept];
}

/** The tiles in the order the cables run them (the amp's tile for the head), each once. */
export const cabledOrder = (chains: readonly string[][], tiles: ReadonlySet<string>): string[] =>
  [...new Set(chains.flat().map((id) => (id === HEAD ? AMP : id)))].filter((id) => tiles.has(id));
