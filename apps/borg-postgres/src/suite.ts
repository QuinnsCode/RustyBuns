// Thick borg, story 1, from outside: drive the Worker's /api routes against a target and say
// whether Postgres behaved like Postgres. The same checks run on PGlite and on a deploy.
export type Target = { url: string; headers?: Record<string, string> };
export type Result = { check: string; ok: boolean; detail: string };

const nonce = () => crypto.randomUUID().slice(0, 8);

async function call(t: Target, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(new URL(path, t.url), {
    method, headers: { ...t.headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json() as any;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${out?.error ?? ""}`);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const CHECKS: Record<string, (t: Target) => Promise<string | true>> = {
  // insert ... returning, with bound values, reads back what went in
  async insert(t) {
    const owner = nonce();
    await call(t, "POST", "/api/notes", { owner, body: "hello" });
    const rows = await call(t, "GET", `/api/notes?owner=${owner}`);
    return rows.length === 1 && rows[0].body === "hello" || `got ${JSON.stringify(rows)}`;
  },
  // Postgres-only types: text[] and jsonb round-trip as arrays and objects
  async types(t) {
    const owner = nonce(), meta = { a: [1, 2], b: { c: "d" } };
    await call(t, "POST", "/api/notes", { owner, body: "typed", tags: ["x", "y"], meta });
    const [row] = await call(t, "GET", `/api/notes?owner=${owner}`);
    return same(row.tags, ["x", "y"]) && same(row.meta, meta) || `got ${JSON.stringify(row)}`;
  },
  // a failing statement rolls back the ones before it in a transaction
  async transaction(t) {
    const { left } = await call(t, "POST", `/api/rollback?owner=${nonce()}`);
    return left === 0 || `${left} rows survived the rollback`;
  },
  // ten concurrent upserts land as ten counts
  async concurrent(t) {
    const name = nonce();
    await Promise.all(Array.from({ length: 10 }, () => call(t, "POST", `/api/count?name=${name}`)));
    const { n } = await call(t, "POST", `/api/count?name=${name}`);
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
