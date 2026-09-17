// The one file the developer owns. Everything else is generated from it.

export type Binding =
  | { type: "d1"; databaseName: string; migrationsDir?: string }
  | { type: "kv" }
  | { type: "r2"; bucketName: string }
  | { type: "durable_object"; className: string; scriptName?: string }
  | { type: "var"; value: string }
  | { type: "secret" };

export type DesktopOs = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "windows-x64";

export interface DesktopTarget {
  /**
   * "spa": your own Vite SPA build + a world class; the RWSDK worker never runs.
   *        This is the honest desktop for a one-player app (default).
   * "worker": run the full worker bundle under Bun with sqlite bindings.
   */
  mode?: "spa" | "worker";
  /** spa: command that builds the client (e.g. "vite build --config vite.desktop.config.ts"). */
  clientBuild?: string;
  /** spa: where that build lands. Embedded into the binary. */
  clientDir?: string;
  /**
   * spa: module whose default export is a DO-shaped class:
   *   new (ctx, env) => { fetch(req), webSocketMessage?, webSocketClose?, alarm? }
   * No `extends DurableObject` needed. It is bound in-process with sqlite storage.
   */
  world?: string;
  /** spa: path the client's WorldSocket connects to. */
  worldPath?: string;
  /** spa: headers the host vouches at upgrade, like your CF middleware would. */
  identity?: Record<string, string>;
  /** "all" or a list. TS-only builds cross-compile; Rust cdylibs need a per-OS matrix. */
  targets?: "all" | DesktopOs[];
  window?: "app" | "tab";
  dataDir?: string;
  /** DO storage codec: "json" (readable) or "v8" (structured clone, keeps TypedArrays). */
  storageCodec?: "json" | "v8";
  /** Extra --define values baked into the binary (RB_VERSION is always set). */
  define?: Record<string, string>;
}

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
    desktop?: DesktopTarget;
  };
}

export function defineConfig(c: RustyBunsConfig): RustyBunsConfig { return c; }
