// The one file the developer owns. Everything else is generated from it.

import type { Persona } from "@rustybuns/shell-bun/priority";

export type Binding =
  | {
      type: "d1";
      databaseName: string;
      migrationsDir?: string;
      /**
       * The database's previous name, while renaming it. The desktop moves its
       * `<renamedFrom>.sqlite` over when there's no file under the new name yet.
       * On Cloudflare a rename replaces the database: copy its data into one
       * under the new name first, and adopt takes that over.
       */
      renamedFrom?: string;
    }
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
   * Workers Rate Limiting: `await env.NAME.limit({ key })` answers `{ success }`,
   * counted per Cloudflare location in memory, so a check costs no storage write.
   * Free, and no resource behind it. Edge only: the desktop has no twin, so the
   * binding is left out there and the app runs without it.
   */
  | {
      type: "ratelimit";
      /** A positive integer, as a string, unique in the account: Workers sharing one share its counts. */
      namespaceId: string;
      /** `limit` requests per key in each `period` of 10 or 60 seconds. */
      simple: { limit: number; period: 10 | 60 };
    }
  /**
   * Cloudflare Vectorize: `env.NAME.upsert(vectors)`, `.query(values, { topK, filter })`,
   * `.getByIds(ids)` and `.deleteByIds(ids)`. `metadataIndexes` are the metadata properties
   * a query can filter on. Edge only: the desktop has no twin, so the binding is left out there.
   */
  | {
      type: "vectorize";
      /** The index's name on Cloudflare (with targets.edge.adopt; Alchemy names it otherwise). */
      indexName: string;
      /** Each vector's length: the embedding model's (bge-small-en-v1.5 makes 384). Fixed at creation. */
      dimensions: number;
      /** @default "cosine" */
      metric?: "cosine" | "euclidean" | "dot-product";
      /** Property name -> its type, for each property a query filters on. */
      metadataIndexes?: Record<string, "string" | "number" | "boolean">;
    }
  /**
   * Workers AI: `await env.NAME.run(model, inputs)`, e.g. embeddings for a vectorize
   * binding. No resource behind it. Edge only: the desktop has no twin.
   */
  | { type: "ai" }
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
      /**
       * The queue's previous name, while renaming it. The desktop carries
       * messages still waiting under it over to the new name. On Cloudflare a
       * rename replaces the queue, so drain the old one first.
       */
      renamedFrom?: string;
      /** How this Worker consumes it, or false to only send to it. @default {} */
      consumer?: QueueConsumer | false;
      /**
       * false: the Worker only consumes it, and `env` gets no binding for it (wrangler's
       * consumer-only queue, a dead-letter queue's own consumer, say). The key is only a name then.
       * @default true
       */
      producer?: false;
    }
  /**
   * Cloudflare Workflows: `await env.NAME.create({ params })` starts an instance of the
   * `WorkflowEntrypoint` class `main` exports (or `scriptName`'s), whose steps are retried
   * and persisted. Alchemy names the workflow `<worker>-<class>-<hash>`, not wrangler's `name`, so
   * instances started under a wrangler deploy stay with that one. Edge only: the desktop has
   * no twin, so the binding is left out there.
   */
  | { type: "workflow"; className: string; scriptName?: string }
  /**
   * Workers Analytics Engine: `env.NAME.writeDataPoint({ blobs, doubles, indexes })` into a
   * dataset, made on first write (no resource to provision). Off the edge writeDataPoint is a no-op.
   */
  | { type: "analytics_engine"; /** @default the binding's name */ dataset?: string }
  /**
   * Dynamic Worker Loader: `env.NAME.get(id, () => ({ mainModule, modules, ... }))` runs code
   * in a Worker isolate made at runtime. No resource behind it. Edge only: the desktop has no twin.
   */
  | { type: "worker_loader" }
  /**
   * Cloudflare Hyperdrive: a pooled, cached route to a Postgres the app already has (Supabase,
   * Neon, RDS). `env.NAME.connectionString` goes to `pg`, `postgres` or Drizzle as is. Off the
   * edge there is no pool to go through, so the desktop and box hand the app the secret's URL
   * itself, in the same shape (connectionString, host, port, user, password, database).
   */
  | {
      type: "hyperdrive";
      /**
       * The `secret` binding holding the origin's URL, postgres://user:password@host:port/database.
       * Required unless `origin.neon`; with it, the desktop and box read this secret (a dev branch,
       * say) instead of the stack's branch.
       */
      urlSecret?: string;
      /**
       * A Postgres the stack owns instead of a URL: a Neon project (and branch) made at deploy and
       * gone on destroy, its origin wired into Hyperdrive. Alchemy reads the Neon API key from
       * NEON_API_KEY. Off the edge the app reads `NAME_URL` (or `urlSecret`); a box in the same
       * stack gets the branch's URL there.
       */
      origin?: { neon: NeonOrigin };
      /** The Hyperdrive config's name on Cloudflare (with targets.edge.adopt; Alchemy names it otherwise). */
      configName?: string;
      /** Query caching, on by default (60 s, 15 s stale-while-revalidate). false turns it off. */
      caching?: false | { maxAge?: number; staleWhileRevalidate?: number };
      /**
       * "pglite": when the URL is unset off the edge (an offline desktop), run PGlite in the data dir
       * and hand the app its 127.0.0.1 URL instead. Needs @electric-sql/pglite and
       * @electric-sql/pglite-socket in the app's dependencies; the binary embeds PGlite (~16 MB).
       */
      local?: "pglite";
      /** With local "pglite": SQL migrations applied to it at boot, Drizzle's (0000_name.sql) or
       *  Prisma's (<timestamp>_name/migration.sql), tracked in rb_migrations. */
      migrationsDir?: string;
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
      /**
       * Only the box gets it, not the edge Worker: a secret for the host itself,
       * like RB_PROF_SECRET, which turns on /__rb/prof (see `rustybuns prof`).
       */
      boxOnly?: boolean;
    };

/** A Neon Postgres the stack makes for a `hyperdrive` binding. */
export interface NeonOrigin {
  /** The Neon project's name (Alchemy names it otherwise). */
  project?: string;
  /** A branch of that name off the project's default branch, fronted instead of the default branch. */
  branch?: string;
  /** Where the project lives, e.g. "aws-us-east-2". Fixed once made. */
  region?: string;
  /** Postgres major version. Fixed once made. */
  pgVersion?: 14 | 15 | 16 | 17 | 18;
  /** experimental.wheel only: a 1Password reference for NEON_API_KEY, fetched through varlock at plan/deploy. */
  apiKeyOp?: string;
}

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
  /** Most batches the edge runs at once (up to 250); unset, it scales with the backlog. The desktop runs one at a time. */
  maxConcurrency?: number;
  /**
   * Another queue binding's key: a message still unacked after maxRetries goes there instead
   * of being dropped (wrangler's `dead_letter_queue`). The desktop moves it there too.
   */
  deadLetterQueue?: string;
  /**
   * Desktop and box only: the priority class each batch runs at on the host's scheduler, which
   * shares a budget (`RB_PERSONA` at launch) among the host's background work. The edge ignores it.
   * @default "low"
   */
  priority?: "realtime" | "high" | "normal" | "low";
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

/** One of desktop.server's servers. */
export interface DesktopServer {
  entry: string;
  /** vite server.proxy keys: "/api" is a prefix, "^/ws/.*" a regex. */
  paths: string[];
  /** A server that ignores PORT: the port it always listens on. */
  port?: number;
  /** More env for it (ORIGIN, say). The host's own env and PORT, DATA_DIR come first. */
  env?: Record<string, string>;
}

/** desktop.server as a list, empty when there's none. */
export const desktopServers = (d: DesktopTarget | undefined): DesktopServer[] => d?.server ? [d.server].flat() : [];

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
   * spa: the app's own Node server, run beside the host. The build bundles `entry` with Bun
   * (its imports and node_modules with it) into the binary; the host starts it as a child with
   * PORT (a free port, or `port`) and DATA_DIR (the host's data dir), and proxies `paths` to it,
   * WebSocket upgrades too, as the Vite dev server's server.proxy did:
   *   server: { entry: "../api/server.js", paths: ["/api"] }
   * A list when the proxy sent paths to more than one server; the first whose paths match wins:
   *   server: [{ entry: "../api/server.js", paths: ["/api"] }, { entry: "../media/index.js", paths: ["/img", "/gif"] }]
   * A native addon (.node) it requires by a fixed path ships beside it; one a package finds at
   * run time (bindings, node-gyp-build), or one not built for a target, stops the build.
   * Desktop and box only: a Worker can't run a node:http server, so the edge needs it ported.
   */
  server?: DesktopServer | DesktopServer[];
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
  /**
   * URL of this app's own advisories.json: releases of the app to move off.
   * At launch (once a day, never blocking) the host checks the app's version
   * (package.json) against it and, on a listed one, tells the app's users how
   * to move, in release builds too: one log line, and `update` in /__rb/info.
   *   { "latest": "1.4.0", "download": "https://example.com/app",
   *     "advisories": [{ "versions": "1.3.0", "do": "upgrade", "to": "latest", "why": "saves are lost on quit" }] }
   * Same range rules as RustyBuns' own advisories.json.
   */
  advisories?: string;
  /** Extra --define values baked into the binary (RB_VERSION is always set). */
  define?: Record<string, string>;
  /**
   * Worker-thread modules the host starts, as project paths. Each is bundled on
   * its own and shipped beside the host, and host code that names one with
   * `new URL("./worker.ts", import.meta.url)` is pointed at that copy, so
   * `new Worker(url)` or `hostScheduler().worker(priority, url, data)` find it
   * in the binary too:
   *   workers: ["src/rig/worker.ts"]
   */
  workers?: string[];
  /**
   * Finished workers the host's scheduler keeps loaded for the next job on the same module, as
   * `RB_WARM`, which overrides it. A warm worker skips the thread's startup and keeps its JIT'd
   * code (auto-rig rigs about twice as fast), but each idle one counts against the memory budget.
   * @default 0
   */
  warm?: number;
}

/**
 * targets.box: one server running the same Bun host the desktop build uses.
 *
 * Hetzner: one Hetzner Cloud server running the same Bun host the desktop build uses,
 * public on 0.0.0.0:<port>, with sqlite on an attached Volume.
 */
export interface HetznerBoxTarget {
  provider: "hetzner";
  /** RSS ceiling in MB. Above it the box writes a heap snapshot to <data>/heap and exits, so it restarts before it runs out. RB_MEM_MAX_MB overrides. Unset: watch only (/__rb/mem). */
  memMaxMb?: number;
  /**
   * Triage tools on the box's pages, over WebMCP: an agent in the browser gets mem_stats,
   * and take_cpu_profile and mem_history once the visitor opens the page with #rb_prof=<RB_PROF_SECRET>.
   * It adds a script tag to every HTML page the box serves. @default false
   */
  webmcp?: boolean;
  /**
   * The budget the box's background work (crons, queue batches) shares, as `RB_PERSONA`, which
   * overrides it: `background-burner` for a build box that should use all but a core.
   * @default "balanced" (60% of CPU, 50% of memory)
   */
  persona?: Persona;
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
  /** RSS ceiling in MB. Above it the box writes a heap snapshot to <data>/heap and exits, so it restarts before it runs out. RB_MEM_MAX_MB overrides. Unset: watch only (/__rb/mem). */
  memMaxMb?: number;
  /**
   * Triage tools on the box's pages, over WebMCP: an agent in the browser gets mem_stats,
   * and take_cpu_profile and mem_history once the visitor opens the page with #rb_prof=<RB_PROF_SECRET>.
   * It adds a script tag to every HTML page the box serves. @default false
   */
  webmcp?: boolean;
  /**
   * The budget the box's background work (crons, queue batches) shares, as `RB_PERSONA`, which
   * overrides it: `background-burner` for a build box that should use all but a core.
   * @default "balanced" (60% of CPU, 50% of memory)
   */
  persona?: Persona;
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
    /** Entry as wrangler sees it (RWSDK: src/worker.tsx). Omitted: an assets-only Worker, a static site with no code of its own. */
    main?: string;
    /** Prebuilt worker bundle after `vite build`; deployed byte-for-byte. */
    builtMain?: string;
    /** Built client assets after `vite build`. */
    assets?: string;
    /** A path no asset matches: index.html (an SPA's client-side routes), the nearest 404.html, or a plain 404. */
    notFoundHandling?: "single-page-application" | "404-page" | "none";
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
     * Desktop and box only: the priority class the crons run at on the host's scheduler, as for a
     * queue consumer's `priority`. The edge ignores it. @default "low"
     */
    cronPriority?: "realtime" | "high" | "normal" | "low";
    /**
     * CPU time one invocation may use, in ms (`limits.cpu_ms`). Workers Paid
     * defaults to 30,000 and allows up to 300,000; the free plan is fixed at 10.
     * Billed per CPU ms used, not per ms allowed. The desktop has no limit.
     */
    cpuMs?: number;
    /**
     * Where the Worker runs (`placement`). `{ mode: "smart" }` is Smart Placement:
     * Cloudflare runs it near the D1 database and Durable Objects it calls rather than
     * near the visitor, which pays off when a request makes several round trips.
     * Free on every plan. The desktop and box hosts ignore it.
     */
    placement?: { mode: "smart" };
    /**
     * Workers Logs and traces (wrangler's `observability`). `{ enabled: true }` keeps every
     * invocation's logs; a `headSamplingRate` below 1 keeps that share of requests. The
     * desktop and box hosts ignore it.
     */
    observability?: {
      enabled: boolean;
      headSamplingRate?: number;
      logs?: { enabled: boolean; invocationLogs?: boolean; headSamplingRate?: number; persist?: boolean };
      traces?: { enabled?: boolean; headSamplingRate?: number; persist?: boolean };
    };
    /**
     * Workers Logs keep each request's URL without its query string
     * (`observability.redact_query_string`), so codes and tokens passed in a URL
     * aren't logged. Alchemy can't set it and each upload resets it, so
     * `rustybuns deploy` sets it after every deploy (src/redact.ts).
     */
    redactQueryStrings?: boolean;
    /**
     * Upload the `.map` files beside builtMain with the script (wrangler's
     * `upload_source_maps`), so Workers Logs traces of a minified bundle name the
     * source. Alchemy's `bundle: false` leaves maps out unless asked. Cloudflare
     * keeps them for remapping traces; they aren't served.
     */
    sourceMaps?: boolean;
  };
  bindings: Record<string, Binding>;
  targets: {
    edge?: {
      provider: "cloudflare";
      /**
       * Custom domains the Worker serves on, DNS and certificate managed; their zones must
       * be in the account. A list serves on each, the first being the Worker's URL.
       */
      domain?: string | string[];
      /**
       * Zone routes that send matching requests to the Worker, as wrangler's `routes`:
       *   routes: [{ pattern: "example.com/api/*", zoneName: "example.com" }]
       * The zone needs a proxied DNS record for the host already. The desktop ignores them.
       */
      routes?: { pattern: string; zoneName?: string; zoneId?: string }[];
      /**
       * Give the Worker the config's `name`, D1 its `databaseName` and R2 its
       * `bucketName`, and take over ones that already exist under those names
       * (made with wrangler, or left behind by a lost Alchemy state).
       * Off, Alchemy names them `<app>-<id>-<stage>-<random>` itself. Don't turn
       * it on for a stack Alchemy already deployed: the names change, so those
       * resources are replaced.
       */
      adopt?: boolean;
      /**
       * The Worker's name on Cloudflare, when it differs from the app's `name`
       * (which also names the Alchemy state and the desktop's data dir, so it
       * stays put). With `adopt` on, changing it replaces the Worker: Alchemy
       * makes the new one, then deletes the old one and its workers.dev URL.
       * @default name
       */
      workerName?: string;
      /**
       * The Worker's previous name, while renaming it with `workerName`. Each
       * Durable Object it bound moves to the new Worker with its data
       * (Cloudflare's `transferred_classes`). Container classes can't move:
       * theirs start empty. Inert once the move is done, so it can stay.
       */
      renamedFrom?: string;
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

/** The Worker's name on Cloudflare: `targets.edge.workerName`, else the app's `name`. */
export function workerName(c: Pick<RustyBunsConfig, "name" | "targets">): string { return c.targets.edge?.workerName ?? c.name; }

/** The env var a hyperdrive binding's desktop and box twin reads its Postgres URL from. */
export function hyperdriveUrlEnv(name: string, b: { urlSecret?: string }): string { return b.urlSecret ?? `${name}_URL`; }
