// The setup page's shared contract (#2498): everything you connect is one of these, drawn as a card with a status
// light, Test and Revoke. A new connection is read-only; `write` comes only after the owner allows it.

export type Access = "read" | "write";
/** ok: works; down: was set up but doesn't answer now; unset: nothing connected yet; pending: waiting on you (a code to type). */
export type Status = "ok" | "down" | "unset" | "pending";

export interface Connection {
  id: string;
  /** "github", "builder", … */
  kind: string;
  /** Who it signs in as: a GitHub login, a builder's user@host. */
  account: string;
  status: Status;
  access: Access;
}
