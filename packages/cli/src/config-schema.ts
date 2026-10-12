// rustybuns.config.ts checked at load, by every command. config.ts's types only help an editor
// or a type checker someone remembers to run, and an agent editing the config often runs
// neither, so a typo'd binding type or a missing databaseName used to generate a stack and fail
// minutes later on Cloudflare's side (or never). This mirrors config.ts, adds the ranges its
// docs state, and rejects unknown keys. It lives apart from config.ts so an app's config, which
// imports defineConfig, never loads effect.
import { Effect, Schema, SchemaAST, SchemaIssue } from "effect";
import { PERSONAS, type Persona } from "@rustybuns/shell-bun/priority";
import type { RustyBunsConfig } from "./config.ts";

const opt = Schema.optional;
const Str = Schema.String;
const Strs = Schema.Array(Str);
const Bool = Schema.Boolean;
const StrMap = Schema.Record(Str, Str);
const int = (minimum: number, maximum: number) => Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum, maximum }));
const Port = int(1, 65535);

const Priority = Schema.Literals(["realtime", "high", "normal", "low"]);
const QueueConsumer = Schema.Struct({
  batchSize: opt(int(1, 100)),
  maxWaitTimeMs: opt(int(0, 60_000)),
  maxRetries: opt(int(0, 100)),
  retryDelay: opt(int(0, 86_400)),
  maxConcurrency: opt(int(1, 250)),
  priority: opt(Priority),
});

const Binding = Schema.Union([
  Schema.Struct({ type: Schema.Literal("d1"), databaseName: Str, migrationsDir: opt(Str), renamedFrom: opt(Str) }),
  Schema.Struct({ type: Schema.Literal("kv") }),
  Schema.Struct({ type: Schema.Literal("r2"), bucketName: Str }),
  Schema.Struct({ type: Schema.Literal("durable_object"), className: Str, scriptName: opt(Str) }),
  Schema.Struct({ type: Schema.Literal("artifacts"), namespace: Str }),
  Schema.Struct({ type: Schema.Literal("images") }),
  Schema.Struct({ type: Schema.Literal("send_email"), allowedSenderAddresses: opt(Strs) }),
  Schema.Struct({
    type: Schema.Literal("ratelimit"),
    namespaceId: Str.check(Schema.isPattern(/^[1-9]\d*$/, { expected: "a positive integer as a string, like \"1001\"" })),
    simple: Schema.Struct({ limit: int(1, Number.MAX_SAFE_INTEGER), period: Schema.Literals([10, 60]) }),
  }),
  Schema.Struct({
    type: Schema.Literal("vectorize"), indexName: Str, dimensions: int(1, 1536),
    metric: opt(Schema.Literals(["cosine", "euclidean", "dot-product"])),
    metadataIndexes: opt(Schema.Record(Str, Schema.Literals(["string", "number", "boolean"]))),
  }),
  Schema.Struct({ type: Schema.Literal("ai") }),
  Schema.Struct({ type: Schema.Literal("container"), className: Str, dockerfile: Str, maxInstances: opt(int(1, 1000)), instanceType: opt(Str) }),
  Schema.Struct({ type: Schema.Literal("queue"), queueName: Str, renamedFrom: opt(Str), consumer: opt(Schema.Union([QueueConsumer, Schema.Literal(false)])) }),
  Schema.Struct({
    type: Schema.Literal("hyperdrive"), urlSecret: Str, configName: opt(Str),
    caching: opt(Schema.Union([Schema.Literal(false), Schema.Struct({ maxAge: opt(int(1, 3600)), staleWhileRevalidate: opt(int(0, 3600)) })])),
    local: opt(Schema.Literal("pglite")), migrationsDir: opt(Str),
  }),
  Schema.Struct({ type: Schema.Literal("var"), value: Str }),
  Schema.Struct({ type: Schema.Literal("secret"), op: opt(Str), optional: opt(Bool), boxOnly: opt(Bool) }),
]);

const DesktopOs = Schema.Literals(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"]);
const DesktopTarget = Schema.Struct({
  mode: opt(Schema.Literals(["spa", "worker"])),
  clientBuild: opt(Str), clientDir: opt(Str),
  world: opt(Schema.Union([Str, Schema.Literal(false)])),
  host: opt(Str), headers: opt(StrMap),
  native: opt(Schema.Union([Strs, Schema.Literal(false)])),
  worldPath: opt(Str), identity: opt(StrMap),
  listen: opt(Schema.Struct({ hostname: opt(Str), port: opt(Port) })),
  guests: opt(Schema.Struct({ join: opt(Str), max: opt(int(1, 10_000)), version: opt(Schema.Union([Str, Schema.Literal(false)])) })),
  targets: opt(Schema.Union([Schema.Literal("all"), Schema.Array(DesktopOs)])),
  window: opt(Schema.Literals(["app", "tab"])),
  dataDir: opt(Str),
  actions: opt(Schema.Struct({ include: opt(Strs), exclude: opt(Strs) })),
  mounts: opt(StrMap), r2: opt(StrMap),
  storageCodec: opt(Schema.Literals(["json", "v8"])),
  advisories: opt(Str), define: opt(StrMap), workers: opt(Strs), warm: opt(int(0, Number.MAX_SAFE_INTEGER)),
});

const BoxCommon = { memMaxMb: opt(int(64, 1_048_576)), webmcp: opt(Bool), persona: opt(Schema.Literals(Object.keys(PERSONAS) as [Persona, ...Persona[]])), region: opt(Str), port: opt(Port) };
const BoxTarget = Schema.Union([
  Schema.Struct({ provider: Schema.Literal("hetzner"), ...BoxCommon, location: opt(Str), serverType: opt(Str), image: opt(Str), volumeSize: opt(int(10, 10_240)), allowLargeServer: opt(Bool) }),
  Schema.Struct({ provider: Schema.Literal("railway"), ...BoxCommon, volume: opt(Bool), sleep: opt(Bool) }),
]);

// Cloudflare's rule for a Worker's name: lowercase letters, digits and dashes, 63 at most.
const WorkerName = Str.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, { expected: "a Worker name: lowercase letters, digits and dashes, at most 63, no dash at either end" }));

export const ConfigSchema = Schema.Struct({
  name: Str.check(Schema.isMinLength(1)),
  source: opt(Schema.Struct({ dir: opt(Str), aliases: opt(StrMap), ignore: opt(Strs) })),
  worker: opt(Schema.Struct({
    main: opt(Str), builtMain: opt(Str), assets: opt(Str),
    notFoundHandling: opt(Schema.Literals(["single-page-application", "404-page", "none"])),
    runWorkerFirst: opt(Strs),
    compatibilityDate: Str.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { expected: "a date as YYYY-MM-DD" })),
    compatibilityFlags: Strs,
    build: opt(Str),
    migrations: opt(Schema.Array(Schema.Struct({
      tag: Str, new_classes: opt(Strs), new_sqlite_classes: opt(Strs),
      renamed_classes: opt(Schema.Array(Schema.Struct({ from: Str, to: Str }))), deleted_classes: opt(Strs),
    }))),
    crons: opt(Strs), cronPriority: opt(Priority),
    cpuMs: opt(int(10, 300_000)),
    placement: opt(Schema.Struct({ mode: Schema.Literal("smart") })),
    redactQueryStrings: opt(Bool), sourceMaps: opt(Bool),
  })),
  bindings: Schema.Record(Str, Binding),
  targets: Schema.Struct({
    edge: opt(Schema.Struct({ provider: Schema.Literal("cloudflare"), domain: opt(Str), adopt: opt(Bool), workerName: opt(WorkerName), renamedFrom: opt(Str) })),
    box: opt(BoxTarget),
    desktop: opt(DesktopTarget),
  }),
  state: opt(Schema.Literals(["shared", "project"])),
  experimental: opt(Schema.Struct({ wheel: opt(Schema.Literals(["agent", "human"])) })),
});

// Drift guard: a config that satisfies config.ts's types must also satisfy the schema's. A field
// added to config.ts and not here fails this line (and an unknown key fails at load).
type _ConfigFitsSchema = RustyBunsConfig extends Schema.Schema.Type<typeof ConfigSchema> ? true : never;
const _drift: _ConfigFitsSchema = true;

const effectFormat = SchemaIssue.makeFormatterDefault();

/** The values a union's members take at `key` (`type` for a binding, `provider` for a target). */
function tags(ast: SchemaAST.Union, key: string): unknown[] {
  return ast.types.flatMap((t) => t._tag !== "Objects" ? [] : t.propertySignatures
    .filter((p) => p.name === key && p.type._tag === "Literal").map((p) => (p.type as SchemaAST.Literal).literal));
}

/** One line per problem: `bindings.KV.type: "kvv" isn't one of d1, kv, …`. */
export function formatIssues(issue: SchemaIssue.Issue): string[] {
  const lines: string[] = [];
  const show = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 59) + "…" : s; };
  const at = (path: ReadonlyArray<PropertyKey>) => path.map(String).join(".") || "(config)";
  // Effect's own first line ("Expected number | undefined, got \"50\""), minus the undefined
  // an optional field adds, which nobody wrote.
  const say = (path: ReadonlyArray<PropertyKey>, i: SchemaIssue.Issue) =>
    lines.push(`${at(path)}: ${effectFormat(i).split("\n")[0]!.replace(/ \| undefined\b/, "").replace(/^Expected/, "expected")}`);
  const walk = (i: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): void => {
    switch (i._tag) {
      case "Pointer": return walk(i.issue, [...path, ...i.path]);
      case "Composite": for (const c of i.issues) walk(c, path); return;
      case "Encoding": return walk(i.issue, path);
      case "MissingKey": lines.push(`${at(path)}: missing`); return;
      case "UnexpectedKey": lines.push(`${at(path)}: not a config key`); return;
      case "AnyOf": {
        // A tagged object whose tag names no member: say that, not "expected <13 shapes>".
        const v = SchemaIssue.hasInput(i) ? i.input : undefined;
        for (const key of ["type", "provider"]) {
          const known = tags(i.ast, key);
          if (known.length && v && typeof v === "object" && key in v && !known.includes((v as Record<string, unknown>)[key]))
            { lines.push(`${at([...path, key])}: ${show((v as Record<string, unknown>)[key])} isn't one of ${known.join(", ")}`); return; }
        }
        // Otherwise the member that matched the tag says what's wrong inside it.
        if (i.issues.length) { walk(i.issues.at(-1)!, path); return; }
        return void say(path, i);
      }
      default: return void say(path, i);
    }
  };
  walk(issue, []);
  return [...new Set(lines)];
}

export class ConfigInvalid extends Schema.TaggedError<ConfigInvalid>()("ConfigInvalid", { problems: Schema.Array(Str) }) {
  override get message() {
    return `rustybuns.config.ts has ${this.problems.length === 1 ? "a problem" : `${this.problems.length} problems`}:\n${this.problems.map((p) => `  ${p}`).join("\n")}`;
  }
}

/** Check a loaded config. Fails with every problem at once, so one fix-and-rerun covers them all. */
export const decodeConfig = (input: unknown): Effect.Effect<RustyBunsConfig, ConfigInvalid> =>
  Schema.decodeUnknownEffect(ConfigSchema)(input, { errors: "all", onExcessProperty: "error", reportInput: true }).pipe(
    Effect.mapError((e) => new ConfigInvalid({ problems: formatIssues(e.issue) })),
    // With an edge Worker and no targets.edge.workerName, `name` is the Worker's name.
    Effect.filterOrFail(
      (c) => !((c.worker || c.targets.edge) && !c.targets.edge?.workerName) || Schema.is(WorkerName)(c.name),
      (c) => new ConfigInvalid({ problems: [`name: ${JSON.stringify(c.name)} is the Worker's name, so it needs to be lowercase letters, digits and dashes (at most 63), or set targets.edge.workerName`] }),
    ),
    // A Hyperdrive's origin URL comes from a secret binding, so the wheel and the box get it too.
    Effect.flatMap((c) => {
      const b = c.bindings;
      const bad = Object.entries(b).flatMap(([n, h]) => h.type === "hyperdrive" && b[h.urlSecret]?.type !== "secret"
        ? [`bindings.${n}.urlSecret: ${JSON.stringify(h.urlSecret)} isn't a secret binding; add ${h.urlSecret}: { type: "secret" } with the postgres:// URL`]
        : h.type === "hyperdrive" && h.migrationsDir && h.local !== "pglite"
        ? [`bindings.${n}.migrationsDir: only a PGlite twin takes migrations at boot; add local: "pglite", or migrate your Postgres yourself`] : []);
      return bad.length ? Effect.fail(new ConfigInvalid({ problems: bad })) : Effect.succeed(c);
    }),
    Effect.as(input as RustyBunsConfig),   // the schema only checks; the config stays what the developer wrote
  );
