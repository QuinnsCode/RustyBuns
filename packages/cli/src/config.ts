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
  world?: string | false;
  /**
   * spa: module whose default export is `{ fetch(req, ctx) }`, for your own
   * host routes (files, native calls, exports). Return null to fall through
   * to a 404. ctx: { env, dataDir, identity, reporter }. This is how a plain
   * Vite app gets a backend without pretending to be a Worker.
   */
  host?: string;
  /**
   * Response header overrides. The default is full cross-origin isolation
   * (COEP require-corp) for SharedArrayBuffer; apps that load CDN resources
   * without CORP headers want { "Cross-Origin-Embedder-Policy": "credentialless" }.
   */
  headers?: Record<string, string>;
  /**
   * Rust crates under native/crates to embed in the binary. Each is built to
   * native/dist/<name>/<os-arch>/ by native/build.ts and found by loadNative().
   */
  native?: string[];
  /** spa: path the client's WorldSocket connects to. */
  worldPath?: string;
  /** spa: headers the host vouches at upgrade, like your CF middleware would. */
  identity?: Record<string, string>;
  /** "all" or a list. TS-only builds cross-compile; Rust cdylibs need a per-OS matrix. */
  targets?: "all" | DesktopOs[];
  window?: "app" | "tab";
  dataDir?: string;
  /**
   * Which "use server" modules the desktop host imports and runs for real.
   * Globs on the module path. Excluded actions keep a client proxy that
   * rejects with "not available on desktop" instead of reaching the host, so
   * the UI degrades instead of crashing and the host never bundles their deps.
   *   actions: { include: ["src/app/actions/game/**"] }
   *   actions: { exclude: ["**\/user/functions.ts", "**\/social/**"] }
   */
  actions?: { include?: string[]; exclude?: string[] };
  /**
   * Extra static mounts on the host: URL prefix -> directory, embedded into the
   * binary. The desktop twin of "the worker serves R2 at /asset/:key":
   *   mounts: { "/asset": ".asset-cache/asset" }
   * Sync the directory from R2 in clientBuild; content-hashed keys never go stale.
   */
  mounts?: Record<string, string>;
  /**
   * Which directory backs each R2 binding on the desktop (defaults to the data
   * dir). Point it at a mount's directory so host-side bucket reads see the
   * same files the route serves:
   *   r2: { ASSETS_BUCKET: ".asset-cache/asset" }
   */
  r2?: Record<string, string>;
  /** DO storage codec: "json" (readable) or "v8" (structured clone, keeps TypedArrays). */
  storageCodec?: "json" | "v8";
  /** Extra --define values baked into the binary (RB_VERSION is always set). */
  define?: Record<string, string>;
}

export interface RustyBunsConfig {
  name: string;
  /**
   * Where the app's source lives and how it's aliased. Inferred from tsconfig
   * paths / vite aliases when omitted; set it when your layout is unusual:
   *   source: { dir: "app", aliases: { "~": "app", "#lib": "lib" } }
   */
  source?: { dir?: string; aliases?: Record<string, string>; ignore?: string[] };
  /** The Workers side. Omitted for desktop-only apps (plain Vite, no Cloudflare). */
  worker?: {
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
