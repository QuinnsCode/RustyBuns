// What layers.ts writes and board.ts reads: the regions in layers out from the Pine Barrens, each with its cryptids.
import { arr, bool, int, nul, obj, str, type Of } from "@rustybuns/util/guard";

export const Layer = obj({
  n: int(1, 999), name: str(80), tier: str(40), layer: int(0, 99), next: arr(int(1, 999), 64), boss: nul(str(40)),
  beasts: arr(obj({ id: str(40), name: str(80), starter: bool(), rebuilt: bool(), refs: bool(), pics: int(0, 9999) }), 200),
});
export type Layer = Of<typeof Layer>;
export const Layers = arr(Layer, 500);
