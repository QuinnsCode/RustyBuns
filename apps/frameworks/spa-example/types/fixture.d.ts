// Just enough of rwsdk, @cloudflare/vite-plugin and the Workers runtime for
// src/ and vite.config.ts to type check. This fixture is read as text by
// packages/cli/test/glue.test.ts and never built, so it doesn't install them.
// Kept outside src/ so the boundary analysis there doesn't see it.

declare module "cloudflare:workers" {
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
    first<T = unknown>(column: string): Promise<T | null>;
  }
  interface D1Database {
    exec(query: string): Promise<unknown>;
    prepare(query: string): D1PreparedStatement;
  }
  export const env: { DB: D1Database };
}

declare module "rwsdk/worker" {
  export const requestInfo: { request: Request; ctx: { user: { id: string } } };
}

declare module "rwsdk/vite" {
  import type { PluginOption } from "vite";
  export function redwood(options?: object): PluginOption;
}

declare module "@cloudflare/vite-plugin" {
  import type { PluginOption } from "vite";
  export function cloudflare(options?: object): PluginOption;
}
