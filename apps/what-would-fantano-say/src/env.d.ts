// The Worker's bindings (rustybuns.config.ts). Secrets are optional: see src/api.ts.
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    REVIEW_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
    TURNSTILE_SITE_KEY?: string;
    REVIEW_MODEL?: string;
    ANTHROPIC_API_KEY?: string;
    TURNSTILE_SECRET?: string;
  }
}
