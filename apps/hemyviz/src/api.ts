// What /api/fleet answers: every Alchemy stack hemyviz found, each stage's resources, cut down to what is safe to
// draw. The server writes `x satisfies Fleet`, the page reads it through `Fleet`. No Bun or DOM here.
//
// Alchemy keeps a secret in its state file as plain text inside `{ "__redacted__": ... }`, and props and attrs hold
// tokens, connection strings and keys. So a resource here carries no prop or attr values at all: its name, type,
// status, edges and counts, plus `name` and `url` from a short list of attr fields that are public by nature (read.ts).
import { arr, bool, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

/** Alchemy's resource statuses (alchemy/src/State/ResourceState.ts). The -ing ones are a deploy in flight, or one that died midway. */
export const STATUSES = ["creating", "created", "updating", "updated", "deleting", "replacing", "replaced"] as const;
export type Status = (typeof STATUSES)[number];
export const BUSY: ReadonlySet<Status> = new Set(["creating", "updating", "deleting", "replacing"]);

export const Resource = obj({
  /** Alchemy's fully qualified name: namespace path + logical id, `/`-separated. Unique in a stage. */
  fqn: str(500),
  /** The resource type, `Cloudflare.Worker`, `Neon.Branch`, ... */
  type: str(200),
  status: oneOf(STATUSES),
  /** FQNs in the same stage that depend on this one. */
  downstream: arr(str(500), 1000),
  /** How many bindings are attached, and how many props it was given: counts only, never the values. */
  bindings: int(0, 10_000),
  props: int(0, 10_000),
  /** removalPolicy retain or protect: a destroy leaves it on the account. */
  kept: bool(),
  /** The provider mode it was last reconciled in: live (the cloud) or local (dev). */
  mode: oneOf(["live", "local"] as const),
  /** When its state file last changed, ms since epoch. */
  updatedAt: int(0, 1e14),
  name: opt(str(200)),
  url: opt(str(500)),
});
export type Resource = Of<typeof Resource>;

export const Stack = obj({
  /** `<stack>/<stage>`: unique across the fleet. */
  id: str(500),
  stack: str(200),
  stage: str(200),
  /** The Rusty Buns app folder this state belongs to (`apps/eqosys`), when it came from the repo's shared state. */
  app: opt(str(300)),
  resources: arr(Resource, 5000),
});
export type Stack = Of<typeof Stack>;

export const Fleet = obj({
  /** Changes whenever any state file does: the page asks `?since=<version>` and gets 204 while it holds. */
  version: str(64),
  at: int(0, 1e14),
  stacks: arr(Stack, 2000),
});
export type Fleet = Of<typeof Fleet>;

/** The provider in a resource type: `Cloudflare.D1.Database` -> `Cloudflare`. */
export const providerOf = (type: string) => type.split(".")[0] || type;
/** A resource type without its provider: `Cloudflare.D1.Database` -> `D1.Database`. */
export const kindOf = (type: string) => type.split(".").slice(1).join(".") || type;
/** The last part of an FQN: the logical id. */
export const shortName = (fqn: string) => fqn.split("/").pop() || fqn;
