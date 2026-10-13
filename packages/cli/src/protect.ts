// `protect: true` on a binding: destroy leaves that resource, and its data, on the account.
//
// Alchemy's RemovalPolicy.retain() does the keeping (gen/alchemy.ts decorates the declaration): the
// provider's delete is never called and the state row is dropped. It is saved with the resource's
// state, so it only counts from the deploy after `protect` was turned on. What this file adds is the
// part a person sees: a KEPT list in front of every plan, deploy and destroy.

import type { Binding, RustyBunsConfig } from "./config.ts";

type Protectable = Extract<Binding, { protect?: boolean }>;

/** The bindings that make a resource holding data, which `protect` can keep. */
const KIND: Record<string, string> = { d1: "D1", kv: "KV", r2: "R2", queue: "Queue", vectorize: "Vectorize", hyperdrive: "Hyperdrive" };

export const isProtected = (b: Binding): b is Protectable => b.type in KIND && !!(b as Protectable).protect;

/** What each binding is called on the account: the config's name under adopt, else the binding's own. */
function label(name: string, b: Binding): string {
  const named = b.type === "d1" ? b.databaseName : b.type === "r2" ? b.bucketName : b.type === "queue" ? b.queueName
    : b.type === "vectorize" ? b.indexName : b.type === "hyperdrive" ? b.configName : undefined;
  return `${KIND[b.type]} ${named ?? name}`;
}

/** Each protected resource, as "D1 app-db". */
export function protectedNames(cfg: Pick<RustyBunsConfig, "bindings">): string[] {
  return Object.entries(cfg.bindings ?? {}).filter(([, b]) => isProtected(b)).map(([n, b]) => label(n, b));
}

/** Names this destroy WILL delete: the data-holding resources that are not protected. */
export function destroyedNames(cfg: Pick<RustyBunsConfig, "bindings">): string[] {
  return Object.entries(cfg.bindings ?? {}).filter(([, b]) => b.type in KIND && !isProtected(b)).map(([n, b]) => label(n, b));
}

/**
 * The block printed before a plan, deploy or destroy. Always says what is kept and what goes, so
 * "will this wipe my vector index?" never has to be read out of a plan. Empty when no binding holds data.
 */
export function protectReport(cfg: Pick<RustyBunsConfig, "bindings">, sub: string): string {
  const kept = protectedNames(cfg), gone = destroyedNames(cfg);
  if (!kept.length && !gone.length) return "";
  const lines = ["protection (destroy):"];
  for (const n of kept) lines.push(`  [KEPT]    ${n}: destroy leaves it, and its data, on the account`);
  for (const n of gone) lines.push(`  [REMOVED] ${n}: destroy deletes it, and its data`);
  if (kept.length && sub !== "destroy") lines.push(`  protect saves with the resource, so a new \`protect: true\` counts from the next deploy: deploy before you destroy.`);
  if (!kept.length) lines.push(`  nothing is protected. Set \`protect: true\` on a binding to keep it through destroy.`);
  return lines.join("\n");
}
