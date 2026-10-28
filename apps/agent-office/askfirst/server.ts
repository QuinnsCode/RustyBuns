// The grants list's route (built into rb-askfirst.js): GET /__rb/grants lists them, POST /__rb/grants?do=grant|revoke
// &repo=o/n&kind=push&who=* changes one. Signed-in people only, and a POST needs the X-RB-Ask header like an answer to a card.
// the hook port's /office/workers/write reads the worker's command with this
export { commandOf } from "./hook.ts";
import { addGrants, readGrants, removeGrant } from "./grants.ts";
import { isKind, KINDS } from "./kinds.ts";

export function grantsRoute(dir: () => string) {
  return (method: string, url: URL, trusted: boolean): { status: number; body: unknown } | null => {
    if (url.pathname !== "/__rb/grants") return null;
    if (method === "GET") return { status: 200, body: { grants: readGrants(dir()), kinds: KINDS } };
    if (method !== "POST") return { status: 405, body: { error: "GET or POST /__rb/grants" } };
    if (!trusted) return { status: 403, body: { error: "Send x-rb-ask: 1 with the POST" } };
    const what = url.searchParams.get("do"), repo = url.searchParams.get("repo") ?? "", kind = url.searchParams.get("kind"), who = url.searchParams.get("who") || "*";
    if (what !== "grant" && what !== "revoke") return { status: 400, body: { error: "do=grant or do=revoke" } };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { status: 400, body: { error: "repo should look like owner/name" } };
    if (!isKind(kind)) return { status: 400, body: { error: `kind is one of ${KINDS.join(", ")}` } };
    const g = { repo, kind, who };
    return { status: 200, body: { grants: what === "grant" ? addGrants(dir(), [g]) : removeGrant(dir(), g) } };
  };
}
