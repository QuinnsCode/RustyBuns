// POST /api/repos/:o/:r/do/edit?path=&branch=: claim the lines the ops touch (in line if held), apply them naming the claim, release it.
// Every check lives in the routes it calls (do/claims, do/ops), so access, locks, policy and limits answer as they do there.
import { json, readBody } from "./env.ts";
import { actingAs } from "./identity.ts";
import { isPlainObject } from "./util.ts";

const MAX_WAIT_S = 20;

/** The line ids the ops touch: what a set or delete names, and an insert's anchor. */
const touched = (ops: unknown[]): string[] => {
  const ids = new Set<string>();
  for (const o of ops) {
    if (!isPlainObject(o)) continue;
    const id = o.kind === "insert" ? o.after : o.line;
    if (typeof id === "string" && id) ids.add(id);
  }
  return [...ids];
};

const bodyOf = (r: Response): Promise<unknown> => r.json().catch(() => null);

export async function editRoutes(req: Request, p: string[], url: URL, user: string | null, self: (r: Request) => Promise<Response>): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "do" && p[5] === "edit" && !p[6])) return null;
  if (req.method !== "POST") return json({ error: "POST {ops, id?, task?, ifRev?, timeout?}" }, 405);
  if (!user) return json({ error: "sign in to edit" }, 401);
  const b = await readBody<"ops" | "id" | "task" | "ifRev" | "timeout" | "proto">(req);
  if (!Array.isArray(b.ops) || !b.ops.length) return json({ error: "ops: a list of line ops, please" }, 400);
  if (b.id !== undefined && typeof b.id !== "string") return json({ error: "id: your claim's id" }, 400);
  if (b.task !== undefined && typeof b.task !== "string") return json({ error: "task: what you're doing, as text" }, 400);
  if (b.ifRev !== undefined && !Number.isInteger(b.ifRev)) return json({ error: "ifRev: the file's rev, a whole number" }, 400);
  if (b.proto !== undefined && !Number.isInteger(b.proto)) return json({ error: "proto: the ops protocol, a whole number" }, 400);
  if (b.timeout !== undefined && !(typeof b.timeout === "number" && b.timeout >= 0 && b.timeout <= MAX_WAIT_S)) return json({ error: `timeout: seconds to wait in line, 0 to ${MAX_WAIT_S}` }, 400);

  const q = new URLSearchParams({ path: url.searchParams.get("path") ?? "" });
  const branch = url.searchParams.get("branch");
  if (branch) q.set("branch", branch);
  const call = (route: string, payload: unknown) => {
    const r = new Request(`${url.origin}/api/repos/${p[2]}/${p[3]}/do/${route}?${q}`, { method: "POST", body: JSON.stringify(payload) });
    actingAs.set(r, user);
    return self(r);
  };

  const lines = touched(b.ops);
  let claim: string | undefined;
  try {
    if (lines.length) {
      const got = await call("claims", { lines, id: b.id, task: b.task, wait: true, timeout: b.timeout ?? MAX_WAIT_S });
      const reply = await bodyOf(got);
      // Still in line (202) or refused: the caller asks again with the id, or hears why.
      if (got.status !== 201) return json(reply, got.status);
      claim = isPlainObject(reply) && typeof reply.id === "string" ? reply.id : undefined;
      if (!claim) return json({ error: "the claim came back without an id" }, 502);
    }
    const done = await call("ops", { ops: b.ops, ifRev: b.ifRev, claim, proto: b.proto });
    const reply = await bodyOf(done);
    return json(done.ok && isPlainObject(reply) ? { ...reply, claim: claim ?? null } : reply, done.status);
  } finally {
    if (claim) await call("release", { id: claim }).catch(() => {});
  }
}
