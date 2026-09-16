// The one file the developer owns. Everything else is generated from it.

export type Binding =
  | { type: "d1"; databaseName: string; migrationsDir?: string }
  | { type: "kv" }
  | { type: "r2"; bucketName: string }
  | { type: "durable_object"; className: string; scriptName?: string }
  | { type: "var"; value: string }
  | { type: "secret" };

export interface RustyBunsConfig {
  name: string;
  worker: {
    /** Entry as wrangler sees it (RWSDK: src/worker.tsx). */
    main: string;
    /** Prebuilt worker bundle after `vite build`; deployed byte-for-byte. */
    builtMain?: string;
    /** Built client assets after `vite build`. */
    assets?: string;
    runWorkerFirst?: string[];
    compatibilityDate: string;
    compatibilityFlags: string[];
    /** Command that produces builtMain + assets. */
    build?: string;
  };
  bindings: Record<string, Binding>;
  targets: {
    edge?: { provider: "cloudflare"; domain?: string };
    box?: { provider: "hetzner"; region?: string; serverType?: string };
    desktop?: { window?: "app" | "tab"; dataDir?: string };
  };
}

export function defineConfig(c: RustyBunsConfig): RustyBunsConfig { return c; }
