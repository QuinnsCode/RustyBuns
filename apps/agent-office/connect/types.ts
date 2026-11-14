// The setup page's shared contract (#2498): everything you connect is one of these, drawn as a card with a status
// light, Test and Revoke. A new connection is read-only; `write` comes only after the owner allows it.
// One guard per reply: the office writes `x satisfies SetupReply`, the page reads it through the same guard.
import { arr, bool, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

export const Access = oneOf(["read", "write"], "read");
export type Access = Of<typeof Access>;
/** ok: works; down: was set up but doesn't answer now; unset: nothing connected yet; pending: waiting on you (a code to type). */
export const Status = oneOf(["ok", "down", "unset", "pending"]);
export type Status = Of<typeof Status>;

export const Connection = obj({
  id: str(200),
  /** "github", "builder", … */
  kind: str(40),
  /** Who it signs in as: a GitHub login, a builder's user@host. Empty while nothing is connected. */
  account: str(200, { min: 0 }),
  status: Status,
  access: Access,
});
export type Connection = Of<typeof Connection>;

/** A GitHub sign-in waiting on the code to be typed. */
export const Pending = obj({ id: str(200), userCode: str(40), uri: str(500), expiresAt: num(0, Number.MAX_SAFE_INTEGER) });
export type Pending = Of<typeof Pending>;

/** What GET /__rb/connections answers. A card that doesn't fit is left off rather than failing the page. */
export const SetupReply = obj({
  connections: arr(Connection, 100, { drop: true }),
  pending: arr(Pending, 20, { drop: true }),
  ready: bool(false),
  error: opt(str(2000)),
});
export type SetupReply = Of<typeof SetupReply>;

/** Last night's build on the builder Mac, as scripts/builder-nightly.ts writes it. */
export const Nightly = obj({
  at: str(100),
  commit: str(100, { min: 0, dflt: "" }),
  results: arr(obj({ app: str(100), target: str(100, { min: 0, dflt: "" }), ok: bool(), seconds: num(0, 1e7, 0) }), 1000, { drop: true }),
});
export type Nightly = Of<typeof Nightly>;

/** What GET /__rb/builder answers. */
export const BuilderReply = obj({
  connections: arr(Connection, 10, { drop: true }),
  setup: str(1000),
  /** null until the builder has run a night. */
  nightly: nul(Nightly),
});
export type BuilderReply = Of<typeof BuilderReply>;

/** What a /__rb/ route answers when it refuses. */
export const OfficeError = obj({ error: str(2000) });
