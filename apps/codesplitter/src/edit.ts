// POST /api/repos/:o/:r/do/edit?path=&branch=: claim the lines the ops touch (in line if held), apply them naming the claim, release it.
// Every check lives in the routes it calls (do/claims, do/ops), so access, locks, policy and limits answer as they do there.
import { json, need, readBody } from "./env.ts";
import { arr, int, num, obj, opt, raw, str } from "@rustybuns/util/guard";
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
  const whole = opt(int(-Infinity, Infinity));
  const b = need(await readBody(req), obj({ ops: arr(raw, Infinity, { min: 1 }), id: opt(str()), task: opt(str(Infinity, { min: 0 })), ifRev: whole, proto: whole, timeout: opt(num(0, MAX_WAIT_S)) }));
  if (b instanceof Response) return b;

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
