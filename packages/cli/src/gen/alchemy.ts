// RustyBunsConfig -> .rustybuns/alchemy.run.ts
// Targets alchemy 2.0.0-beta.77 (Infrastructure-as-Effects). Async Worker
// form: no Effect in the app bundle; bindings declared via `env`, typed via
// Cloudflare.InferEnv. The generated file is readable and committable; the
// eject path is "keep this file, delete the config".

import { hyperdriveUrlEnv, workerName, type Binding, type RustyBunsConfig } from "../config.ts";
import { BOX_DIR, RAILWAY_DATA, RAILWAY_DIR, boxDefaults, railwayDefaults } from "../box.ts";
import { checkWheel, mintedSecrets } from "../wheel.ts";

const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

/** `, { ... }` from the props that are set, or nothing. */
const propsArg = (props: Record<string, string | number | undefined>) => {
  const set = Object.entries(props).filter(([, v]) => v !== undefined);
  return set.length ? `, { ${set.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} }` : "";
};

/** `adopt`: name D1 and R2 as the config does, so existing ones are found by name. */
function resource(name: string, b: Binding, adopt: boolean): string | null {
  const id = ident(name);
  switch (b.type) {
    case "d1":
      return `export const ${id} = Cloudflare.D1.Database("${name}"${propsArg({ name: adopt ? b.databaseName : undefined, migrations: b.migrationsDir })});`;
    case "kv":
      return `export const ${id} = Cloudflare.KV.Namespace("${name}");`;
    case "r2":
      return `export const ${id} = Cloudflare.R2.Bucket("${name}"${propsArg({ name: adopt ? b.bucketName : undefined })});`;
    case "artifacts":
      // A binding marker: namespaces appear with their first repo, nothing to provision.
      return `export const ${id} = Cloudflare.Artifacts.Namespace("${name}", { namespace: ${JSON.stringify(b.namespace)} });`;
    case "queue":
      // Bound in env as a producer; its consumer is attached to the Worker in the stack below.
      return `export const ${id} = Cloudflare.Queues.Queue("${name}"${propsArg({ name: adopt ? b.queueName : undefined })});`;
    case "images":
      // A Worker-only binding: no resource behind it.
      return `export const ${id} = Cloudflare.Images.Images("${name}");`;
    case "send_email":
      // Worker-only too: the domain is onboarded to Email Sending outside the stack.
      return `export const ${id} = Cloudflare.Email.SendEmail("${name}"${b.allowedSenderAddresses ? `, { allowedSenderAddresses: ${JSON.stringify(b.allowedSenderAddresses)} }` : ""});`;
    case "ratelimit":
      // Worker-only as well: the counters live in Cloudflare's network, not in a resource.
      return `export const ${id} = Cloudflare.RateLimit("${name}", { namespaceId: ${JSON.stringify(b.namespaceId)}, simple: ${JSON.stringify(b.simple)} });`;
    case "vectorize":
      // Its metadata indexes are made in the stack below, once the index exists.
      return `export const ${id} = Cloudflare.Vectorize.Index("${name}", { ${adopt ? `name: ${JSON.stringify(b.indexName)}, ` : ""}dimensions: ${b.dimensions}, metric: ${JSON.stringify(b.metric ?? "cosine")} });`;
    case "hyperdrive": {
      const caching = b.caching === false ? `, caching: { disabled: true }` : b.caching ? `, caching: ${JSON.stringify(b.caching)}` : "";
      const named = adopt && b.configName ? `name: ${JSON.stringify(b.configName)}, ` : "";
      // The stack's own Neon branch (neonResources, above): its origin, once it exists.
      if (b.origin?.neon) return [
        `export const ${id} = Effect.gen(function* () {`,
        `  const db = yield* ${neonDb(name)};`,
        `  return yield* Cloudflare.Hyperdrive.Connection("${name}", { ${named}origin: db.origin${caching} });`,
        `});`,
      ].join("\n");
      // The origin is the secret's URL, read as the stack deploys; the password stays redacted.
      return `export const ${id} = Cloudflare.Hyperdrive.Connection("${name}", { ${named}origin: Config.redacted(${JSON.stringify(b.urlSecret)}).pipe(Config.map(pgOrigin))${caching} });`;
    }
    case "ai":
      // Worker-only: Workers AI has no resource to provision.
      return `export const ${id} = Cloudflare.Workers.AI(${JSON.stringify(name)});`;
    case "durable_object":
      // Async Workers bind a DO exported by `main` with Cloudflare.DurableObject
      // in `env` (src/Cloudflare/Workers/DurableObject.ts, "Async Workers").
      // Not a top-level resource: it is created inline in env below. Its
      // migrations need no history here: Alchemy diffs the deployed Worker's
      // tags, appends the next tag, and treats a changed class as a rename.
      return null;
    case "container": {
      // The Container is the DO binding and its ContainerApplication together;
      // the image builds from the Dockerfile's directory at deploy. Alchemy's
      // ContainerProvider resolves `dockerfile` from the app, not from `context`,
      // so it gets the whole path (#247).
      const at = b.dockerfile.lastIndexOf("/");
      const context = at < 0 ? "." : b.dockerfile.slice(0, at);
      return `export const ${id} = Cloudflare.Container("${name}", { className: ${JSON.stringify(b.className)}, context: ${JSON.stringify(context)}, dockerfile: ${JSON.stringify(b.dockerfile)}, maxInstances: ${b.maxInstances ?? 1}, instanceType: ${JSON.stringify(b.instanceType ?? "lite")} });`;
    }
    case "var":
    case "secret":
      return null;
  }
}

/** The Neon resource a hyperdrive binding fronts: its branch, else its project's default branch. */
const neonDb = (name: string) => `${ident(name)}_Neon`;

/** `origin: { neon }`: the Neon project, and the branch off it when one is named. */
function neonResources(name: string, b: Extract<Binding, { type: "hyperdrive" }>): string[] {
  const n = b.origin!.neon;
  const project = `Neon.Project("${name}Neon"${propsArg({ name: n.project, region: n.region, pgVersion: n.pgVersion })})`;
  if (!n.branch) return [`export const ${neonDb(name)} = ${project};`];
  return [
    `export const ${neonDb(name)}Project = ${project};`,
    `export const ${neonDb(name)} = Neon.Branch("${name}NeonBranch", { project: ${neonDb(name)}Project, name: ${JSON.stringify(n.branch)} });`,
  ];
}

export function generateAlchemy(c: RustyBunsConfig): string {
  // Edge is on when asked for, or when nothing else is (configs from before targets.box).
  const edge = !!c.targets.edge || !c.targets.box;
  if (edge && !c.worker) throw new Error("this config has no worker section (desktop-only app); there is no edge stack to generate");
  const box = c.targets.box?.provider === "hetzner" ? boxDefaults(c.targets.box) : null;
  const rail = c.targets.box?.provider === "railway" ? railwayDefaults(c.targets.box) : null;
  const w = c.worker!;   // only read when edge is on, which requires it
  const adopt = edge && !!c.targets.edge?.adopt;
  const bindings = c.bindings ?? {};
  const renamedFrom = c.targets.edge?.renamedFrom;
  checkWheel(c);
  // experimental.wheel "agent": these secrets are minted by the stack itself.
  const minted = new Set(mintedSecrets(c));
  for (const [name, b] of Object.entries(bindings))
    if (b.type === "hyperdrive" && b.urlSecret && minted.has(b.urlSecret))
      throw new Error(`${name} reads its Postgres URL from ${b.urlSecret}, and experimental.wheel "agent" would mint that as a random value. Give ${b.urlSecret} an op reference.`);
  const hyperdrives = Object.entries(bindings).flatMap(([n, b]) => b.type === "hyperdrive" ? [[n, b] as const] : []);
  const pg = edge && hyperdrives.some(([, b]) => !b.origin?.neon);
  const neon = hyperdrives.filter(([, b]) => b.origin?.neon);
  // A box in the stack reads the branch's URL where the desktop reads NAME_URL; a urlSecret twin is a secret already.
  const boxPg = neon.filter(([, b]) => !b.urlSecret).map(([n, b]) => [hyperdriveUrlEnv(n, b), neonDb(n)] as const);
  if (box && minted.size)
    throw new Error(`experimental.wheel "agent" can't mint secrets on a Hetzner box yet (${[...minted].join(", ")}). Give them an op reference or a value, or use the railway box.`);
  /** `export const Name = <ctor>(...)`, built inside an Effect when it needs minted secrets (or, `dbs`, Neon branches). */
  const withMinted = (name: string, ctor: string, body: string[], pipe = "", dbs: readonly (readonly [string, string])[] = []) => {
    if (!minted.size && !dbs.length) return [`export const ${name} = ${ctor}(${JSON.stringify(name)}, {`, ...body, `})${pipe};`];
    return [
      `export const ${name} = Effect.gen(function* () {`,
      ...(minted.size ? [`  // experimental.wheel "agent": minted on create, kept in stack state, gone on destroy.`] : []),
      ...[...minted].map((n) => `  const ${ident(n)} = yield* Alchemy.makeRandom(${JSON.stringify(n)});`),
      ...dbs.map(([, db]) => `  const ${db.toLowerCase()} = yield* ${db};`),
      `  return yield* ${ctor}(${JSON.stringify(name)}, {`,
      ...body.map((l) => "  " + l),
      `  })${pipe};`,
      `});`,
    ];
  };
  const lines: string[] = [];
  lines.push(`// GENERATED by rustybuns from rustybuns.config.ts. Edit the config, or eject:`);
  lines.push(`//   rustybuns eject   (keeps this file, you own it from then on)`);
  lines.push(`import * as Alchemy from "alchemy";`);
  if (edge) lines.push(`import * as Cloudflare from "alchemy/Cloudflare";`);
  if (edge && w.build) lines.push(`import * as Command from "alchemy/Command";`);
  if (box) lines.push(`import * as Hetzner from "alchemy/Hetzner";`);
  if (rail) lines.push(`import * as Railway from "alchemy/Railway";`);
  if (neon.length) lines.push(`import * as Neon from "alchemy/Neon";`);
  lines.push(`import * as Effect from "effect/Effect";`);
  if (edge) lines.push(`import * as Config from "effect/Config";`);
  if (pg) lines.push(`import * as Redacted from "effect/Redacted";`);
  // Without the edge, Random's provider has to be named: Railway.providers() registers it but its type doesn't say so.
  const randomProvider = minted.size > 0 && !edge;
  const providerList = [edge && "Cloudflare.providers()", box ? "Hetzner.providers()" : rail ? "Railway.providers()" : null,
    randomProvider && "Alchemy.RandomProvider()", neon.length && "Neon.providers()"].filter((p): p is string => !!p);
  if (providerList.length > 1) lines.push(`import * as Layer from "effect/Layer";`);
  lines.push(``);

  if (pg) {
    // A regex, not URL: the stack is checked with lib ESNext alone.
    lines.push(`/** A postgres://user:password@host:port/database URL as Hyperdrive's origin. */`);
    lines.push(`const pgOrigin = (url: Redacted.Redacted<string>) => {`);
    lines.push(`  const m = /^(postgres(?:ql)?):\\/\\/([^:@]*)(?::(.*))?@([^@:\\/?#]+)(?::(\\d+))?\\/([^?#]+)/.exec(Redacted.value(url));`);
    lines.push(`  if (!m) throw new Error("a Hyperdrive origin needs a postgres://user:password@host:port/database URL");`);
    lines.push(`  const [, scheme, user, password, host, port, database] = m as unknown as string[];`);
    lines.push(`  return { scheme: scheme as "postgres" | "postgresql", host: host!, port: Number(port || 5432), database: decodeURIComponent(database!),`);
    lines.push(`    user: decodeURIComponent(user!), password: Redacted.make(decodeURIComponent(password ?? "")) };`);
    lines.push(`};`);
    lines.push(``);
  }

  if (neon.length) {
    // origin: { neon }: the stack owns the Postgres. Made at deploy (NEON_API_KEY), gone on destroy.
    for (const [name, b] of neon) lines.push(...neonResources(name, b));
    lines.push(``);
  }

  if (edge) {
    const envEntries: string[] = [];
    for (const [name, b] of Object.entries(bindings)) {
      const r = resource(name, b, adopt);
      if (r) { lines.push(r); envEntries.push(`${name}: ${ident(name)}`); }
      else if (b.type === "durable_object")
        envEntries.push(`${name}: Cloudflare.DurableObject("${name}", { className: "${b.className}"${b.scriptName ? `, scriptName: "${b.scriptName}"`
          : renamedFrom ? `, transferredFrom: ${JSON.stringify(renamedFrom)}` : ""} })`);
      else if (b.type === "var") envEntries.push(`${name}: ${JSON.stringify(b.value)}`);
      else if (b.type === "secret" && !b.boxOnly) envEntries.push(minted.has(name) ? `${name}: ${ident(name)}`
        : b.optional ? `...(process.env.${name} ? { ${name}: Config.redacted("${name}") } : {})`
        : `${name}: Config.redacted("${name}")`);
    }
    lines.push(``);

    if (w.build) {
      // rustybuns plan/deploy/dev build before Alchemy hashes the bundle (#362), without the
      // deploy's logins (#1114, #1121), and set RUSTYBUNS_BUILT, so this only records dist instead
      // of rebuilding it under the upload (#424). The resource stays: dropping it would delete dist.
      lines.push(`// Build the app (RWSDK: vite build -> dist/worker + dist/client) before deploy.`);
      lines.push(`// Under rustybuns plan/deploy/dev the app is already built (RUSTYBUNS_BUILT), so this only records dist.`);
      lines.push(`export const Build = Command.Build("Build", { command: process.env.RUSTYBUNS_BUILT ? "true" : ${JSON.stringify(w.build)}, outdir: "dist" });`);
      lines.push(``);
    }

    const wb: string[] = [];
    if (adopt) wb.push(`  name: ${JSON.stringify(workerName(c))},`);
    // No main: assets-only, and Cloudflare's asset layer answers every request.
    if (w.builtMain ?? w.main) wb.push(`  main: ${JSON.stringify(w.builtMain ?? w.main)},`);
    if (w.builtMain) wb.push(`  bundle: false,  // vite already produced a runtime-ready ESM bundle`);
    // Alchemy's default module rules with the source maps added: given rules, it uses only those.
    if (w.builtMain && w.sourceMaps) wb.push(`  rules: [{ globs: ["**/*.js", "**/*.mjs"] }, { globs: ["**/*.wasm"] }, { globs: ["**/*.txt", "**/*.html", "**/*.sql"] }, { globs: ["**/*.bin"] }, { globs: ["**/*.map"] }],  // worker.sourceMaps`);
    if (w.assets) {
      wb.push(`  assets: {`);
      wb.push(`    directory: ${JSON.stringify(w.assets)},`);
      if (w.runWorkerFirst) wb.push(`    runWorkerFirst: ${JSON.stringify(w.runWorkerFirst)},`);
      if (w.notFoundHandling) wb.push(`    notFoundHandling: ${JSON.stringify(w.notFoundHandling)},`);
      wb.push(`  },`);
    }
    wb.push(`  compatibility: { date: ${JSON.stringify(w.compatibilityDate)}, flags: ${JSON.stringify(w.compatibilityFlags)} },`);
    if (w.cpuMs) wb.push(`  limits: { cpuMs: ${w.cpuMs} },`);
    if (w.placement) wb.push(`  placement: ${JSON.stringify(w.placement)},  // Smart Placement: run near D1 and the Durable Objects`);
    if (w.crons?.length) wb.push(`  crons: ${JSON.stringify(w.crons)},  // Cron Triggers: the Worker exports scheduled()`);
    if (c.targets.edge?.domain) wb.push(`  domain: ${JSON.stringify(c.targets.edge.domain)},`);
    wb.push(`  env: { ${envEntries.join(", ")} },`);
    // A wrangler-made Worker has no Alchemy tags, so plan and deploy refuse it as
    // someone else's unless this Worker opts in to taking it over.
    if (adopt) lines.push(`// targets.edge.adopt: an existing Worker named ${JSON.stringify(workerName(c))} is taken over, not duplicated.`);
    lines.push(...withMinted("Worker", "Cloudflare.Worker", wb, adopt ? ".pipe(Alchemy.AdoptPolicy.adopt(true))" : ""));
    lines.push(``);
    lines.push(`/** The typed env the Worker AND the desktop shell compile against. */`);
    lines.push(`export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;`);
    lines.push(``);
  }

  const secrets = Object.entries(bindings).filter(([n, b]) => b.type === "secret" && !minted.has(n)).map(([n]) => n);
  if (box) {
    const env = [
      ...secrets.map((n) => `${n}: process.env[${JSON.stringify(n)}] ?? ""`),
      ...(box.volumeSize > 0 ? [] : [`DATA_DIR: ${JSON.stringify(`/var/lib/${c.name}`)}`]),
      ...boxPg.map(([env, db]) => `${env}: ${db.toLowerCase()}.connectionUri`),
    ];
    lines.push(`// ---- box target (Hetzner) ------------------------------------------------`);
    lines.push(`// One server running the compiled Bun host (\`rustybuns build box\`). Hetzner.Service`);
    lines.push(`// runs \`node launch.mjs\` under systemd; the launcher execs the binary beside it.`);
    lines.push(`// sqlite, KV and R2 dirs live on the Volume. Secrets land in /opt/<unit>/env.`);
    lines.push(`export const Box = Hetzner.Server("Box", { serverType: ${JSON.stringify(box.serverType)}, image: ${JSON.stringify(box.image)}, location: ${JSON.stringify(box.location)} });`);
    if (box.volumeSize > 0) {
      // Hetzner.Volume reads serverId off the CREATED Server; given the Server's
      // definition it attaches nothing and the launcher never finds the mount.
      lines.push(`export const Data = Effect.gen(function* () {`);
      lines.push(`  const box = yield* Box;`);
      lines.push(`  return yield* Hetzner.Volume("Data", { size: ${box.volumeSize}, format: "ext4", server: box, automount: true });`);
      lines.push(`});`);
    }
    lines.push(...withMinted("Service", "Hetzner.Service", [
      `  server: Box,`,
      `  main: ${JSON.stringify(`${BOX_DIR}/launch.mjs`)},`,
      `  extraFiles: [{ source: ${JSON.stringify(BOX_DIR)}, destination: "." }],`,
      `  isExternal: true,  // a finished program, not an Effect entry: pack it as-is`,
      `  port: ${box.port},`,
      `  env: { ${env.join(", ")} },`,
    ], "", boxPg));
    lines.push(``);
  }

  if (rail) {
    const env = [
      `DATA_DIR: ${JSON.stringify(rail.volume ? RAILWAY_DATA : `/var/lib/${c.name}`)}`,
      ...secrets.map((n) => `${n}: process.env[${JSON.stringify(n)}] ?? ""`),
      ...[...minted].map((n) => `${n}: ${ident(n)}`),
      ...boxPg.map(([env, db]) => `${env}: ${db.toLowerCase()}.connectionUri`),
    ];
    const region = rail.region ? `, region: ${JSON.stringify(rail.region)}` : "";
    lines.push(`// ---- box target (Railway) -----------------------------------------------`);
    lines.push(`// One Service running the host bundle (\`rustybuns build box\`) on oven/bun.`);
    lines.push(`// The context dir is uploaded as-is; Railway builds its Dockerfile. sqlite,`);
    lines.push(`// KV and R2 dirs live on the Volume. Secrets are service variables.`);
    lines.push(`export const Project = Railway.Project("Project");`);
    const sb: string[] = [];
    sb.push(`  project: Project,`);
    sb.push(`  context: ${JSON.stringify(RAILWAY_DIR)},`);
    sb.push(`  port: ${rail.port},`);
    if (rail.region) sb.push(`  region: ${JSON.stringify(rail.region)},`);
    sb.push(`  healthcheckPath: "/health",`);
    sb.push(`  sleepApplication: ${rail.sleep},  // idle = asleep = close to free; first request wakes it`);
    sb.push(`  env: { ${env.join(", ")} },`);
    lines.push(...withMinted("Service", "Railway.Service", sb, "", boxPg));
    if (rail.volume && (minted.size || boxPg.length)) {
      // Service is an Effect here, so attach the Volume to the created one.
      lines.push(`export const Data = Effect.gen(function* () {`);
      lines.push(`  const service = yield* Service;`);
      lines.push(`  return yield* Railway.Volume("Data", { project: Project, service, mountPath: ${JSON.stringify(RAILWAY_DATA)}${region} });`);
      lines.push(`});`);
    } else if (rail.volume)
      lines.push(`export const Data = Railway.Volume("Data", { project: Project, service: Service, mountPath: ${JSON.stringify(RAILWAY_DATA)}${region} });`);
    lines.push(``);
  }

  // Box secrets, optional Worker secrets and RUSTYBUNS_BUILT are read from the deploying shell. The
  // stack is checked with types: [], so declare the one piece of node it touches.
  const optional = edge && (!!w.build || Object.values(bindings).some((b) => b.type === "secret" && b.optional));
  if (((box || rail) && secrets.length) || optional)
    lines.splice(lines.findIndex((l) => l === ""), 0, `declare const process: { env: Record<string, string | undefined> };`);

  const providers = providerList.length > 1 ? `Layer.mergeAll(${providerList.join(", ")})` : providerList[0]!;
  const out = [edge && "url: worker.url", (box || rail) && "box: service.url"].filter(Boolean).join(", ");
  lines.push(`export default Alchemy.Stack(`);
  lines.push(`  ${JSON.stringify(c.name)},`);
  lines.push(`  { providers: ${providers}, state: Alchemy.localState() },`);
  lines.push(`  Effect.gen(function* () {`);
  if (edge && w.build) lines.push(`    yield* Build;`);
  // Vectorize metadata indexes: the properties a query may filter on. Before the Worker:
  // Vectorize only indexes metadata of vectors written after the metadata index exists.
  for (const [name, b] of edge ? Object.entries(bindings) : []) {
    if (b.type !== "vectorize") continue;
    for (const [prop, type] of Object.entries(b.metadataIndexes ?? {}))
      lines.push(`    yield* Cloudflare.Vectorize.MetadataIndex(${JSON.stringify(`${name}_${prop}`)}, { indexName: (yield* ${ident(name)}).indexName, propertyName: ${JSON.stringify(prop)}, indexType: ${JSON.stringify(type)} });`);
  }
  if (edge) lines.push(`    const worker = yield* Worker;`);
  // Queues this Worker consumes: its queue() handler gets their batches.
  for (const [name, b] of edge ? Object.entries(bindings) : []) {
    if (b.type !== "queue" || b.consumer === false) continue;
    const s = b.consumer ?? {};
    const settings = Object.entries({ batchSize: s.batchSize, maxWaitTimeMs: s.maxWaitTimeMs, maxRetries: s.maxRetries, retryDelay: s.retryDelay, maxConcurrency: s.maxConcurrency })
      .filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
    lines.push(`    yield* Cloudflare.Queues.Consumer(${JSON.stringify(`${name}Consumer`)}, { queueId: (yield* ${ident(name)}).queueId, scriptName: worker.workerName${settings.length ? `, settings: { ${settings.join(", ")} }` : ""} });`);
  }
  if (box && box.volumeSize > 0) lines.push(`    yield* Data;  // attached and mounted before the unit starts`);
  if (box || rail) lines.push(`    const service = yield* Service;`);
  if (rail?.volume) lines.push(`    yield* Data;  // attaching it redeploys the service onto the mount`);
  lines.push(`    return { ${out} };`);
  lines.push(`  }),`);
  lines.push(`);`);
  return lines.join("\n") + "\n";
}
