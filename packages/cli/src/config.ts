// The one file the developer owns. Everything else is generated from it.

export type Binding =
  | { type: "d1"; databaseName: string; migrationsDir?: string }
  | { type: "kv" }
  | { type: "r2"; bucketName: string }
  | { type: "durable_object"; className: string; scriptName?: string }
  /** Cloudflare Artifacts: git repos created at runtime. Locally, bare repos served over git HTTP. */
  | { type: "artifacts"; namespace: string }
  /**
   * Cloudflare Images: transform and convert images inside the Worker.
   * Off the edge it is a passthrough: the original image, header-read info().
   */
  | { type: "images" }
  /**
   * Cloudflare Email Sending: `env.NAME.send({ from, to, subject, text, html })`.
   * The `from` domain has to be onboarded to Email Sending first. Edge only:
   * the desktop has no twin, so the binding is left out there.
   */
  | { type: "send_email"; allowedSenderAddresses?: string[] }
  /**
   * Cloudflare Containers: a Durable Object class exported by `main` with a
   * container image behind it (the class reaches it through `ctx.container`).
   * Edge only: the desktop has no twin, so the binding is left out there and
   * the app falls back to running on the machine itself.
   */
  | {
      type: "container";
      className: string;
      /** Path to the Dockerfile, relative to the app. Its directory is the build context. */
      dockerfile: string;
      /** Cap on instances running at once. @default 1 */
      maxInstances?: number;
      /** "lite" (1/16 vCPU, 256 MiB), "basic" (1/4 vCPU, 1 GiB), "standard-1" and up. @default "lite" */
      instanceType?: string;
    }
  /**
   * Cloudflare Queues: `env.NAME.send(body, { delaySeconds })` and `sendBatch`,
   * and this Worker as the queue's consumer: its `queue(batch, env, ctx)` gets
   * the messages in batches, and one it doesn't ack is retried. Off the edge it
   * is a sqlite-backed queue in the host process, with the same retries and delays.
   */
  | {
      type: "queue";
      /** The queue's name on Cloudflare (with targets.edge.adopt; Alchemy names it otherwise). */
      queueName: string;
      /** How this Worker consumes it, or false to only send to it. @default {} */
      consumer?: QueueConsumer | false;
    }
  | { type: "var"; value: string }
  | {
      type: "secret";
      /**
       * experimental.wheel only: a 1Password reference ("op://vault/item/field",
       * from "Copy Secret Reference"). plan/deploy fetch it through varlock, so
       * the value never sits on disk. Who unlocks 1Password is the wheel.
       */
      op?: string;
      /**
       * Bound only when it has a value. With `op`, a missing 1Password item
       * resolves to nothing instead of failing plan/deploy. For keys you may not use.
       */
      optional?: boolean;
    };

/** A queue consumer's settings, as wrangler's `queues.consumers` has them. */
export interface QueueConsumer {
  /** Messages per batch (up to 100). @default 10 */
  batchSize?: number;
  /** How long a batch may wait to fill, in ms (up to 60000). On the desktop a send is delivered at once. @default 5000 */
  maxWaitTimeMs?: number;
  /** Retries after the first delivery before a message is dropped (up to 100). @default 3 */
  maxRetries?: number;
  /** Seconds before a retry when `retry()` doesn't say. @default 0 */
  retryDelay?: number;
}

/**
 * One step of a Worker's Durable Object migration history, in wrangler's shape.
 * Cloudflare applies each tag once, in order, so a deployed tag never changes.
 */
export interface DoMigration {
  tag: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
  renamed_classes?: { from: string; to: string }[];
  deleted_classes?: string[];
}

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
   * Which crates from native/dist/<name>/<os-arch>/ to embed (default: every
   * built crate, minus those whose Cargo.toml sets
   * `[package.metadata.rustybuns] desktop = false`). Each is built by
   * native/build.ts; only the target OS's library goes into each binary, where
   * loadNative() finds it. A named crate that was never built is an error. false
   * leaves native/ out of the binary entirely, so cross targets need no native build.
   */
  native?: string[] | false;
  /** spa: path the client's WorldSocket connects to. */
  worldPath?: string;
  /** spa: headers the host vouches at upgrade, like your CF middleware would. */
  identity?: Record<string, string>;
  /**
   * Where the desktop host listens. Default 127.0.0.1 on a random port, which
   * only this machine can reach. `RB_LISTEN=host:port` or `--listen host:port`
   * at launch override it, and the running host can move with POST /__rb/host.
   */
  listen?: { hostname?: string; port?: number };
  /**
   * spa: let other machines join the world. A guest reaches only `worldPath`,
   * with `?join=<passphrase>` on the upgrade and no cookie; the SPA, assets and
   * actions stay token-only. Each guest brings its own `?uid=&name=` identity
   * (trust on first use); the host's own socket keeps the local identity.
   *   guests: { max: 8 }                 closed until the UI opens it
   *   guests: { join: "pass", max: 8 }   open from launch (RB_JOIN / --join override)
   * No TLS: this is ws:// on a LAN. See README "Multiplayer on a LAN".
   */
  guests?: {
    /** Passphrase at launch. Unset = closed until POST /__rb/host { join }. */
    join?: string;
    /** Concurrent guest sockets. @default 8 */
    max?: number;
    /** Guests must send `?v=` equal to this; default the build's RB_VERSION. false skips the check. */
    version?: string | false;
  };
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

/**
 * targets.box: one server running the same Bun host the desktop build uses.
 *
 * Hetzner: one Hetzner Cloud server running the same Bun host the desktop build uses,
 * public on 0.0.0.0:<port>, with sqlite on an attached Volume.
 */
export interface HetznerBoxTarget {
  provider: "hetzner";
  /** `nbg1`, `fsn1`, `hel1`, `ash`, `hil`, `sin`. Changing it replaces the server. */
  location?: string;
  /** @deprecated use `location` */
  region?: string;
  /** `cpx12`, `cx23`, `cax11` (ARM)... Picks the binary's arch. Changing it replaces the server. */
  serverType?: string;
  /** @default "ubuntu-24.04" */
  image?: string;
  /** Port the host listens on. @default 3000 */
  port?: number;
  /** Volume size in GB for sqlite + R2 dirs (min 10). 0 keeps data on the server's own disk. @default 10 */
  volumeSize?: number;
  /** Required for ccx (dedicated) or tier 3+ types like cpx31. Small tiers need nothing. See COSTS.md. */
  allowLargeServer?: boolean;
}

/**
 * One Railway Service running the same Bun host, as a plain bundle on the
 * oven/bun image (a compiled binary is over Railway's 32 MiB upload limit).
 * sqlite + R2 dirs live on a Railway Volume. Billed by usage, so it sleeps
 * when idle unless told otherwise.
 */
export interface RailwayBoxTarget {
  provider: "railway";
  /** `us-west2`, `us-east4`, `europe-west4`, `asia-southeast1`. Railway picks when unset. */
  region?: string;
  /** Port the host listens on (Railway routes the public domain to it). @default 3000 */
  port?: number;
  /** Keep sqlite + R2 dirs on a Railway Volume at /data. false keeps them in the container, lost on redeploy. @default true */
  volume?: boolean;
  /**
   * Sleep the service when it has no traffic, so an idle box costs close to
   * nothing. The first request after a sleep wakes it (a cold start of a
   * second or two). In-memory world state is lost on sleep; sqlite is not.
   * @default true
   */
  sleep?: boolean;
}

export type BoxTarget = HetznerBoxTarget | RailwayBoxTarget;

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
    /**
     * Durable Object migration steps that can't be inferred: removing a class
     * (`deleted_classes`, which deletes its data) or renaming one
     * (`renamed_classes`). The history already in wrangler.jsonc is kept, steps
     * here with a tag it lacks are appended, and a newly bound class gets its
     * own `v<n+1>` tag on its own. Use a tag after the last one in wrangler.jsonc:
     *   migrations: [{ tag: "v3", deleted_classes: ["OldRoom"] }]
     * Only wrangler.jsonc reads this. Alchemy works its migrations out from the
     * deployed Worker, and treats a binding whose class changed as a rename.
     */
    migrations?: DoMigration[];
    /**
     * Cron Triggers: when the Worker's `scheduled(controller, env, ctx)` runs,
     * as five-field cron expressions in UTC ("0 * * * *" is hourly). On the edge
     * they are the Worker's Cron Triggers; the desktop and box hosts run their
     * own minute timer and call the same handler.
     */
    crons?: string[];
    /**
     * CPU time one invocation may use, in ms (`limits.cpu_ms`). Workers Paid
     * defaults to 30,000 and allows up to 300,000; the free plan is fixed at 10.
     * Billed per CPU ms used, not per ms allowed. The desktop has no limit.
     */
    cpuMs?: number;
  };
  bindings: Record<string, Binding>;
  targets: {
    edge?: {
      provider: "cloudflare";
      domain?: string;
      /**
       * Give the Worker the config's `name`, D1 its `databaseName` and R2 its
       * `bucketName`, and take over ones that already exist under those names
       * (made with wrangler, or left behind by a lost Alchemy state).
       * Off, Alchemy names them `<app>-<id>-<stage>-<random>` itself. Don't turn
       * it on for a stack Alchemy already deployed: the names change, so those
       * resources are replaced.
       */
      adopt?: boolean;
    };
    box?: BoxTarget;
    desktop?: DesktopTarget;
  };
  /**
   * Where Alchemy keeps this app's deploy state. "shared" (the default) links
   * `.alchemy/state` into the repo's git dir, so every worktree and the main
   * checkout share it and deleting a worktree doesn't lose it; one deploy at a
   * time holds it. "project" keeps it in this directory's `.alchemy/state`.
   */
  state?: "shared" | "project";
  /** Opt-in features that may change or go away between releases. */
  experimental?: {
    /**
     * Who holds the keys to this stack's `secret` bindings.
     *
     * "agent": take the wheel. For stacks that come and go (tests, CI, previews).
     *   A secret without `op` is minted on create (Alchemy.Random), kept in the
     *   stack's state across deploys, and gone on destroy: create, test, destroy,
     *   as often as you like, nothing to rotate. A secret with `op` is read from
     *   1Password with a service account token in OP_TOKEN (scope it to one vault).
     *
     * "human": in the loop. For prod. A secret with `op` is read from 1Password
     *   by the 1Password app on your machine, behind your Touch ID or passkey;
     *   no token is accepted. A secret without `op` comes from the shell or
     *   .dev.vars, as without this flag.
     *
     * Every secret is listed in a generated .env.schema at the app root, by
     * name and source, never value: commit it and the same secrets resolve on
     * any machine, CI job or agent, each behind its own wheel. Remove its
     * "# GENERATED" header to own it.
     *
     * `op` secrets are fetched by varlock, which ships with the CLI; "human"
     * also needs the 1Password CLI, `op`.
     */
    wheel?: "agent" | "human";
  };
}

export function defineConfig(c: RustyBunsConfig): RustyBunsConfig { return c; }
