// The Worker's bindings (rustybuns.config.ts). Any of them missing means the free estimate: see src/api.ts.
// @cloudflare/workers-types stays out of this project: its HTMLRewriter Element merges into the DOM's and breaks the
// eqosys client's DOM code (packages/util/src/eqosys.ts), so the few shapes used here are typed by hand.
declare namespace Cloudflare {
  interface Env {
    ASSETS: { fetch(req: Request): Promise<Response> };
    AI?: { run(model: string, input: unknown): Promise<unknown> };
    BUDGET?: { idFromName(name: string): unknown; get(id: unknown): { take(cap: number): Promise<boolean> } };
    DAILY_REVIEWS?: string;
    REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET?: string;
    REVIEWS?: import("./board.ts").Kv;
    /** Where eqosys is, for reading the board (src/board.ts). Unset, the live one. */
    EQOSYS_URL?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
  export class DurableObject {
    protected ctx: { storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> } };
    constructor(ctx: unknown, env: unknown);
  }
}
