import { DurableObject } from "cloudflare:workers";
import { take } from "./budget.ts";

// One instance ("global") holds the day's count. See src/budget.ts.
export class ReviewBudget extends DurableObject {
  async take(cap: number): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const count = (await this.ctx.storage.get<{ day: string; n: number }>("count")) ?? { day: today, n: 0 };
    const next = take(count, today, cap);
    if (next.ok) await this.ctx.storage.put("count", { day: next.day, n: next.n });
    return next.ok;
  }
}
