// Moving one node of a beast's sheet (beasts/<id>.json): `nodes[name]` is [x, y, z, radius]. Shared by the dev
// server's /__beast/nudge route and the gallery's agent tools, so both agree on what a nudge is.
import { num, obj, str, type Of } from "@rustybuns/util/guard";

const NAME = { re: /^[a-z0-9-]+$/ };
export const Nudge = obj({
  id: str(40, NAME), node: str(40, { re: /^[A-Za-z0-9_.-]+$/ }),
  dx: num(-1, 1, 0), dy: num(-1, 1, 0), dz: num(-1, 1, 0), dr: num(-0.5, 0.5, 0),
});
export type Nudge = Of<typeof Nudge>;

/** The sheet with one node moved (and its radius grown by `dr`, never below 0.005). Throws when the sheet or the node isn't there. */
export function nudged(sheet: unknown, n: Nudge): unknown {
  const nodes = typeof sheet === "object" && sheet !== null ? Reflect.get(sheet, "nodes") : null;
  const at = typeof nodes === "object" && nodes !== null ? Reflect.get(nodes, n.node) : null;
  if (!Array.isArray(at) || at.length < 4 || !at.slice(0, 4).every((v) => typeof v === "number")) throw new Error(`${n.id} has no node "${n.node}"`);
  const [x, y, z, r] = at as number[];
  const to = [x! + n.dx, y! + n.dy, z! + n.dz, Math.max(0.005, r! + n.dr)].map((v) => +v.toFixed(4));
  return { ...sheet as object, nodes: { ...nodes as object, [n.node]: [...to, ...at.slice(4)] } };
}
