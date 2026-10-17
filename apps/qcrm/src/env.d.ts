// The Worker's bindings (rustybuns.config.ts).
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    HOOKS: Queue<import("./env.ts").HookMessage>;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    SUPER_ADMIN_EMAIL?: string;
  }
}
