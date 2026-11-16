// Thick borg, story 1, from outside: drive the Worker's /api routes against a target and say
// whether Postgres behaved like Postgres. The same checks run on PGlite and on a deploy.
export type Target = { url: string; headers?: Record<string, string> };
export type Result = { check: string; ok: boolean; detail: string };

const nonce = () => crypto.randomUUID().slice(0, 8);

/** Field `k` of a JSON answer, still `unknown`: each check compares it with what it sent. */
const at = (v: unknown, k: string | number): unknown =>
  typeof v === "object" && v !== null ? Object.entries(v).find(([key]) => key === String(k))?.[1] : undefined;

async function call(t: Target, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(new URL(path, t.url), {
    method, headers: { ...t.headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out: unknown = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${at(out, "error") ?? ""}`);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const CHECKS: Record<string, (t: Target) => Promise<string | true>> = {
  // insert ... returning, with bound values, reads back what went in
  async insert(t) {
    const owner = nonce();
    await call(t, "POST", "/api/notes", { owner, body: "hello" });
    const rows = await call(t, "GET", `/api/notes?owner=${owner}`);
    return Array.isArray(rows) && rows.length === 1 && at(rows[0], "body") === "hello" || `got ${JSON.stringify(rows)}`;
  },
  // Postgres-only types: text[] and jsonb round-trip as arrays and objects
  async types(t) {
    const owner = nonce(), meta = { a: [1, 2], b: { c: "d" } };
    await call(t, "POST", "/api/notes", { owner, body: "typed", tags: ["x", "y"], meta });
    const row = at(await call(t, "GET", `/api/notes?owner=${owner}`), 0);
    return same(at(row, "tags"), ["x", "y"]) && same(at(row, "meta"), meta) || `got ${JSON.stringify(row)}`;
  },
  // a failing statement rolls back the ones before it in a transaction
  async transaction(t) {
    const left = at(await call(t, "POST", `/api/rollback?owner=${nonce()}`), "left");
    return left === 0 || `${left} rows survived the rollback`;
  },
  // ten concurrent upserts land as ten counts
  async concurrent(t) {
    const name = nonce();
    await Promise.all(Array.from({ length: 10 }, () => call(t, "POST", `/api/count?name=${name}`)));
    const n = at(await call(t, "POST", `/api/count?name=${name}`), "n");
    return n === 11 || `expected 11, got ${n}`;
  },
};

export async function runStory(t: Target): Promise<Result[]> {
  await call(t, "POST", "/api/setup");
  const out: Result[] = [];
  for (const [check, fn] of Object.entries(CHECKS)) {
    try {
      const r = await fn(t);
      out.push({ check, ok: r === true, detail: r === true ? "ok" : r });
    } catch (e) {
      out.push({ check, ok: false, detail: (e as Error).message });
    }
  }
  return out;
}

export const formatResults = (rs: Result[]) => rs.map((r) => `${r.ok ? "✓" : "✗"} ${r.check}${r.ok ? "" : `: ${r.detail}`}`).join("\n");
