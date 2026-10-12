// The Worker's bindings (rustybuns.config.ts). Any of them missing means the free estimate: see src/api.ts.
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    AI?: Ai;
    BUDGET?: DurableObjectNamespace<import("./budget-do.ts").ReviewBudget>;
    DAILY_REVIEWS?: string;
    REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET?: string;
  }
}
