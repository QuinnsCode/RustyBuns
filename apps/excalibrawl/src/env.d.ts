// The Worker's bindings (rustybuns.config.ts). Without AI, fights are free practice on random answers.
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    AI?: Ai;
    ARENA: DurableObjectNamespace<import("./arena.ts").Arena>;
    ARCHIVE?: R2Bucket;
    DAILY_CALLS?: string;
  }
}
