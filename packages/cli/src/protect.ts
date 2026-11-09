// `protect: true` on a binding: destroy leaves that resource, and its data, on the account.
//
// Alchemy's RemovalPolicy.retain() does the keeping (gen/alchemy.ts decorates the declaration): the
// provider's delete is never called and the state row is dropped. It is saved with the resource's
// state, so it only counts from the deploy after `protect` was turned on. A Durable Object class can't
// be kept on its own: its storage lives in its Worker, so protecting one keeps the Worker (#3416).
// What this file adds is the part a person sees: a KEPT list in front of every plan, deploy and destroy.

import type { Binding, RustyBunsConfig } from "./config.ts";

type Protectable = Extract<Binding, { protect?: boolean }>;
type Cfg = Pick<RustyBunsConfig, "bindings"> & Partial<Pick<RustyBunsConfig, "name" | "worker" | "targets">>;

/** The bindings that make a resource holding data, which `protect` can keep. */
const KIND: Record<string, string> = { d1: "D1", kv: "KV", r2: "R2", queue: "Queue", vectorize: "Vectorize", hyperdrive: "Hyperdrive" };

/** A binding with `protect: true` on it: a data resource, a container, or one of this Worker's Durable Object classes. */
export const isProtected = (b: Binding): b is Protectable =>
  (b.type in KIND || b.type === "container" || (b.type === "durable_object" && !b.scriptName)) && !!(b as Protectable).protect;

/** The Durable Object classes this Worker hosts (a container is one too). One bound from another Worker (`scriptName`) is that Worker's. */
const ownClasses = (cfg: Cfg) => Object.entries(cfg.bindings ?? {}).flatMap(([n, b]) =>
  b.type === "durable_object" && !b.scriptName ? [`Durable Object ${b.className ?? n}`] : b.type === "container" ? [`Durable Object ${b.className}`] : []);

/**
 * Destroy leaves the Worker: `worker.protect`, or `protect` on a class it hosts. A class's storage lives in its
 * Worker, and deleting the Worker deletes them all, so keeping one class means keeping the Worker and every class in it.
 */
export const workerKept = (cfg: Cfg): boolean =>
  !!cfg.worker?.protect || Object.values(cfg.bindings ?? {}).some((b) => (b.type === "durable_object" || b.type === "container") && isProtected(b));

/** What each binding is called on the account: the config's name under adopt, else the binding's own. */
function label(name: string, b: Binding): string {
  const named = b.type === "d1" ? b.databaseName : b.type === "r2" ? b.bucketName : b.type === "queue" ? b.queueName
    : b.type === "vectorize" ? b.indexName : b.type === "hyperdrive" ? b.configName : undefined;
  return `${KIND[b.type]} ${named ?? name}`;
}

/** Another app's D1 (`app`): a ref into its stack, so this app's destroy never touches it. */
const ref = (b: Binding) => b.type === "d1" && !!b.app;
/** The other apps' resources this config only refs, as "D1 eqosys-db" with the app that owns each. */
export const refNames = (cfg: Pick<RustyBunsConfig, "bindings">) =>
  Object.entries(cfg.bindings ?? {}).flatMap(([n, b]) => b.type === "d1" && b.app ? [{ name: label(n, b), app: b.app }] : []);

/** Each protected resource, as "D1 app-db": data bindings, containers, and the Worker with its classes. */
export function protectedNames(cfg: Cfg): string[] {
  const bindings = Object.entries(cfg.bindings ?? {});
  return [
    ...bindings.filter(([, b]) => b.type in KIND && !ref(b) && isProtected(b)).map(([n, b]) => label(n, b)),
    ...bindings.flatMap(([, b]) => b.type === "container" && b.protect ? [`Container ${b.className}`] : []),
    ...(workerKept(cfg) ? [`Worker ${cfg.targets?.edge?.workerName ?? cfg.name ?? "worker"}`, ...ownClasses(cfg)] : []),
  ];
}

/** Data `protect` cannot keep: Alchemy has no retain for an Artifacts namespace (deleting it deletes its repos). */
export function unprotectableNames(cfg: Pick<RustyBunsConfig, "bindings">): string[] {
  return Object.entries(cfg.bindings ?? {}).flatMap(([n, b]) => b.type === "artifacts" ? [`Artifacts ${b.namespace ?? n}`] : []);
}

/** Names this destroy WILL delete: the data-holding resources that are not protected, and the ones protect can't keep. */
export function destroyedNames(cfg: Cfg): string[] {
  return [
    ...Object.entries(cfg.bindings ?? {}).filter(([, b]) => b.type in KIND && !ref(b) && !isProtected(b)).map(([n, b]) => label(n, b)),
    ...(workerKept(cfg) ? [] : ownClasses(cfg)),
    ...unprotectableNames(cfg),
  ];
}

/**
 * The block printed before a plan, deploy or destroy. Always says what is kept and what goes, so
 * "will this wipe my vector index?" never has to be read out of a plan. Empty when no binding holds data.
 */
export function protectReport(cfg: Cfg, sub: string): string {
  const kept = protectedNames(cfg), gone = destroyedNames(cfg), refs = refNames(cfg);
  if (!kept.length && !gone.length && !refs.length) return "";
  const lines = ["protection (destroy):"];
  for (const n of kept) lines.push(`  [KEPT]    ${n}: destroy leaves it, and its data, on the account`);
  const fixed = new Set(unprotectableNames(cfg));
  const why = (n: string) => fixed.has(n) ? " (protect can't keep this kind)"
    : n.startsWith("Durable Object ") ? " (with the Worker: `protect: true` on the binding or `worker.protect` keeps it)" : "";
  for (const n of gone) lines.push(`  [REMOVED] ${n}: destroy deletes it, and its data${why(n)}`);
  for (const r of refs) lines.push(`  [NOT OURS] ${r.name}: ${r.app} owns it, so this destroy leaves it`);
  if (kept.length && sub !== "destroy") lines.push(`  protect saves with the resource, so a new \`protect: true\` counts from the next deploy: deploy before you destroy.`);
  if (!kept.length && !fixed.size && gone.length) lines.push(`  nothing is protected. Set \`protect: true\` on a binding to keep it through destroy.`);
  return lines.join("\n");
}
