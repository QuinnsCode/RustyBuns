// Quick play online. The Matchmaker is shared (@rustybuns/util/matchmaker); this is Splat Spray's
// window: 12 seconds, up to six people, filled out to four with bots.
import { QuickMatchmaker, type DONamespace, type QuickConfig } from "@rustybuns/util/matchmaker";

export const QUICK: QuickConfig = { windowMs: 12_000, minLeftMs: 3_000, maxPeople: 6, size: 4 };

export class Matchmaker extends QuickMatchmaker {
  constructor(ctx: unknown, env: { WORLD: DONamespace }) { super(ctx, env, QUICK); }
}
