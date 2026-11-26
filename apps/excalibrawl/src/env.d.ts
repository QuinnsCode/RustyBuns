// The Worker's bindings (rustybuns.config.ts). Without AI, fights are free practice on random answers.
// @cloudflare/workers-types stays out of this project: its HTMLRewriter Element merges into the DOM's and breaks the
// eqosys client's DOM code (packages/util/src/eqosys.ts), so the few shapes used here are typed by hand.
declare namespace Cloudflare {
  /** The part of an R2 bucket the arena and the replay routes use. */
  interface Bucket {
    get(key: string): Promise<{ body: ReadableStream; json(): Promise<unknown> } | null>;
    put(key: string, value: string, o?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  }
  interface Env {
    ASSETS: { fetch(req: Request): Promise<Response> };
    /** Workers AI: any model by name, its input as the turn built it (Clef checks the answer, not the binding's types). */
    AI?: { run(model: string, input: unknown): Promise<unknown> };
    ARENA: {
      idFromName(name: string): unknown;
      get(id: unknown): Pick<import("./arena.ts").Arena, "start" | "fetch">;
    };
    ARCHIVE?: Bucket;
    DAILY_CALLS?: string;
    /** Where eqosys is, for the cron's read of the prompt posts (src/board.ts). Unset, the live one. */
    EQOSYS_URL?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
  export class DurableObject<E = Cloudflare.Env> {
    protected ctx: import("@rustybuns/util/room").RoomCtx & {
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
        setAlarm(at: number): Promise<void>;
      };
    };
    protected env: E;
    constructor(ctx: unknown, env: E);
  }
}
