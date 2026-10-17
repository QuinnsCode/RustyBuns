"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icons.tsx";

// The CRM in the browser: sign in, pick an org, then tables of the four entities, insights from
// SQL, the Rust engine's analysis over rows pulled into the page, and settings (members,
// webhooks, keys, export, delete). Every call goes to /api with the session cookie.

type Row = Record<string, any>;
type View = "contacts" | "companies" | "deals" | "activities" | "insights" | "engine" | "scripts" | "settings";
interface Me { user: { id: string; email: string; name: string } | null; orgs: { id: string; name: string; role: string }[]; superAdmin?: boolean }

const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch("/api" + path, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, credentials: "same-origin" });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as any)?.error ?? body?.message ?? `${res.status}`);
  return body as any;
};
const rowsOf = (r: any): Row[] => (Array.isArray(r) ? r : r?.items ?? r?.rows ?? r?.results ?? (r && typeof r === "object" ? Object.values(r).find(Array.isArray) as Row[] | undefined : undefined) ?? []);
const nextOf = (r: any): string | null => r?.next ?? r?.cursor ?? null;
const money = (cents: unknown, cur = "USD") => typeof cents === "number" ? new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(cents / 100) : "";
const when = (v: unknown) => (typeof v === "number" || typeof v === "string") && v ? new Date(v).toLocaleDateString() : "";
const ROLES = ["seasonal", "employee", "manager", "owner", "admin"] as const;
const RANK: Record<string, number> = { seasonal: 1, employee: 2, manager: 3, owner: 4, admin: 5, super_admin: 6 };
const STAGES = ["lead", "qualified", "proposal", "won", "lost"];

const COLS: Record<string, { key: string; label: string; kind?: "money" | "date" | "stage" | "num" }[]> = {
  contacts: [{ key: "first_name", label: "First" }, { key: "last_name", label: "Last" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "title", label: "Title" }, { key: "updated_at", label: "Updated", kind: "date" }],
  companies: [{ key: "name", label: "Name" }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "size", label: "Size", kind: "num" }, { key: "updated_at", label: "Updated", kind: "date" }],
  deals: [{ key: "name", label: "Deal" }, { key: "stage", label: "Stage", kind: "stage" }, { key: "amount_cents", label: "Amount", kind: "money" }, { key: "close_at", label: "Close", kind: "date" }, { key: "updated_at", label: "Updated", kind: "date" }],
  activities: [{ key: "type", label: "Type" }, { key: "body", label: "Note" }, { key: "at", label: "When", kind: "date" }],
};
const FIELDS: Record<string, { key: string; label: string; type?: string; options?: string[] }[]> = {
  contacts: [{ key: "first_name", label: "First name" }, { key: "last_name", label: "Last name" }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone" }, { key: "title", label: "Title" }, { key: "company_id", label: "Company id" }, { key: "notes", label: "Notes", type: "textarea" }],
  companies: [{ key: "name", label: "Name" }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "size", label: "Size", type: "number" }],
  deals: [{ key: "name", label: "Name" }, { key: "stage", label: "Stage", type: "select", options: STAGES }, { key: "amount_cents", label: "Amount (cents)", type: "number" }, { key: "currency", label: "Currency" }, { key: "contact_id", label: "Contact id" }, { key: "company_id", label: "Company id" }, { key: "close_at", label: "Close (ms)", type: "number" }],
  activities: [{ key: "type", label: "Type", type: "select", options: ["call", "email", "meeting", "note"] }, { key: "body", label: "Body", type: "textarea" }, { key: "contact_id", label: "Contact id" }, { key: "deal_id", label: "Deal id" }],
};

const theme = (t: "light" | "dark" | "auto") => {
  try { t === "auto" ? localStorage.removeItem("qcrm-theme") : localStorage.setItem("qcrm-theme", t); } catch {}
  t === "auto" ? document.documentElement.removeAttribute("data-theme") : document.documentElement.setAttribute("data-theme", t);
};

export function Crm() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [org, setOrg] = useState<string | null>(null);
  const [view, setView] = useState<View>("contacts");
  const [err, setErr] = useState("");
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    try { const m = await api("/me"); setMe(m); if (!org && m.orgs?.[0]) setOrg(m.orgs[0].id); }
    catch { setMe({ user: null, orgs: [] }); }
  }, [org]);

  useEffect(() => {
    try { const t = localStorage.getItem("qcrm-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}
    const q = new URLSearchParams(location.search);
    if (q.get("demo") === "1") {
      setDemo(true);
      // The demo frame: ask for a throwaway org, then carry on as that account.
      api("/me").then((m) => (m?.user && m.orgs?.some((o: Row) => o.plan === "demo") ? m : Promise.reject(new Error("no demo"))))
        .catch(() => api("/demo", { method: "POST" }))
        .then(() => api("/me")).then((m) => { setMe(m); setOrg(m.orgs.find((o: Row) => o.plan === "demo")?.id ?? m.orgs[0]?.id ?? null); })
        .catch((e) => setErr(e.message));
    } else void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (me === undefined) return <div className="empty">Loading…</div>;
  if (!me.user) return <Auth onDone={load} demo={demo} err={err} />;
  const current = me.orgs.find((o) => o.id === org) ?? me.orgs[0];
  if (!current) return <NewOrg onDone={load} />;
  const role = me.superAdmin ? "super_admin" : current.role;
  const can = (min: string) => RANK[role]! >= RANK[min]!;
  const items: [View, string, string][] = [["contacts", "Contacts", "users"], ["companies", "Companies", "building"], ["deals", "Deals", "badge-dollar-sign"], ["activities", "Activities", "activity"], ["insights", "Insights", "chart-column"], ["engine", "Engine", "cpu"], ["scripts", "Scripts", "scroll-text"], ["settings", "Settings", "key-round"]];
  return (
    <div className="crm">
      <aside className="rail" data-tour="rail">
        <div className="org"><span className="tag">Org</span><b title={current.id}>{current.name}</b><span>{role} · <code>{current.id.slice(0, 12)}…</code></span></div>
        {items.map(([v, label, icon]) => <button key={v} type="button" className={"nav-item" + (view === v ? " on" : "")} onClick={() => setView(v)} data-tour={`nav-${v}`}><Icon name={icon} /> {label}</button>)}
        {me.orgs.length > 1 && <select value={current.id} onChange={(e) => setOrg(e.target.value)} aria-label="Switch org">{me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <button type="button" className="nav-item" onClick={async () => { await api("/auth/sign-out", { method: "POST", body: "{}" }); location.href = "/"; }}><Icon name="log-out" /> Sign out</button>
      </aside>
      <section className="pane">
        {err && <p className="err">{err}</p>}
        {view in COLS && <Table key={current.id + view} org={current.id} entity={view} can={can} />}
        {view === "insights" && <Insights org={current.id} />}
        {view === "engine" && <Engine org={current.id} />}
        {view === "scripts" && <Scripts org={current.id} can={can} />}
        {view === "settings" && <Settings me={me} org={current} role={role} can={can} reload={load} />}
      </section>
    </div>
  );
}

function Auth({ onDone, demo, err }: { onDone: () => Promise<void>; demo: boolean; err: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState(err);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { email: f.get("email"), password: f.get("password"), name: f.get("name") || String(f.get("email")).split("@")[0] };
    try { await api(mode === "in" ? "/auth/sign-in/email" : "/auth/sign-up/email", { method: "POST", body: JSON.stringify(body) }); await onDone(); }
    catch (x) { setMsg((x as Error).message); }
  };
  if (demo && !msg) return <div className="empty">Setting up your demo org, 2,000 contacts and all…</div>;
  return (
    <div className="auth" data-tour="auth">
      <h2>{mode === "in" ? "Sign in" : "Create your account"}</h2>
      <p className="muted">Email and password, kept by Better Auth. Your first org is made when you sign up.</p>
      <form onSubmit={submit}>
        {mode === "up" && <label><span>Name</span><input name="name" autoComplete="name" /></label>}
        <label><span>Email</span><input name="email" type="email" required autoComplete="email" /></label>
        <label><span>Password</span><input name="password" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
        {msg && <p className="err">{msg}</p>}
        <div className="row"><button className="primary" type="submit">{mode === "in" ? "Sign in" : "Sign up"}</button><button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "New here? Sign up" : "Have an account? Sign in"}</button></div>
      </form>
      <p className="muted">Just looking? <a href="/demo">Try the demo</a> instead.</p>
    </div>
  );
}

function NewOrg({ onDone }: { onDone: () => Promise<void> }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="auth">
      <h2>Name your org</h2>
      <p className="muted">Its id is a hash of your account and the server secret: nothing in the URL names you.</p>
      <form onSubmit={async (e) => { e.preventDefault(); try { await api("/orgs", { method: "POST", body: JSON.stringify({ name: new FormData(e.currentTarget).get("name") }) }); await onDone(); } catch (x) { setMsg((x as Error).message); } }}>
        <label><span>Org name</span><input name="name" required maxLength={80} /></label>
        {msg && <p className="err">{msg}</p>}
        <button className="primary" type="submit">Create</button>
      </form>
    </div>
  );
}

function Table({ org, entity, can }: { org: string; entity: string; can: (r: string) => boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState("");
  const cols = COLS[entity]!;
  const fetchPage = useCallback(async (cursor: string | null, replace: boolean) => {
    const t = performance.now();
    const p = new URLSearchParams({ limit: "50" });
    if (q) p.set("q", q);
    if (cursor) p.set("cursor", cursor);
    try {
      const r = await api(`/orgs/${org}/${entity}?${p}`);
      setMs(Math.round(performance.now() - t));
      setRows((old) => (replace ? rowsOf(r) : [...old, ...rowsOf(r)]));
      setNext(nextOf(r));
      if (typeof r?.total === "number") setTotal(r.total);
    } catch (e) { setMsg((e as Error).message); }
  }, [org, entity, q]);
  useEffect(() => { const h = setTimeout(() => void fetchPage(null, true), q ? 120 : 0); return () => clearTimeout(h); }, [fetchPage, q]);
  const save = async (data: Row) => {
    const id = edit?.id;
    await api(`/orgs/${org}/${entity}${id ? "/" + id : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    setEdit(null); await fetchPage(null, true);
  };
  const remove = async (id: string) => { await api(`/orgs/${org}/${entity}/${id}`, { method: "DELETE" }); setEdit(null); await fetchPage(null, true); };
  const minCreate = entity === "activities" ? "seasonal" : "employee";
  return (
    <>
      <div className="toolbar" data-tour="toolbar">
        <h2 style={{ textTransform: "capitalize" }}>{entity}</h2>
        <input type="search" placeholder={`Search ${entity}…`} value={q} onChange={(e) => setQ(e.target.value)} data-tour="search" aria-label="Search" />
        {ms !== null && <span className="num" title="Round trip to the edge, this page">{ms} ms</span>}
        {total !== null && <span className="num">{total.toLocaleString()} rows</span>}
        {can(minCreate) && <button className="primary" type="button" onClick={() => setEdit({})}><Icon name="plus" /> New</button>}
      </div>
      {msg && <p className="err">{msg}</p>}
      <div className="table">
        <table>
          <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setEdit(r)}>
                {cols.map((c) => <td key={c.key} className={c.kind === "money" || c.kind === "num" ? "num" : ""}>{cell(r[c.key], c.kind, r.currency)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{q ? "Nothing matches." : `No ${entity} yet.`}</div>}
      </div>
      {next && <button type="button" onClick={() => fetchPage(next, false)}>Load more</button>}
      {edit && <Sheet entity={entity} row={edit} onClose={() => setEdit(null)} onSave={save} onDelete={can("manager") && edit.id ? () => remove(edit.id) : undefined} canEdit={can("employee") || !edit.id} />}
    </>
  );
}

const Stage = ({ v }: { v: unknown }) => { const t = typeof v === "string" && v.trim() ? v : "no stage"; return <span className={`stage ${STAGES.includes(t as never) ? t : "none"}`}>{t}</span>; };

const cell = (v: unknown, kind?: string, cur?: string) => {
  if (kind === "stage") return <Stage v={v} />;
  if (v == null) return "";
  if (kind === "money") return money(v, cur || "USD");
  if (kind === "date") return when(v);
  return String(v);
};

function Sheet({ entity, row, onClose, onSave, onDelete, canEdit }: { entity: string; row: Row; onClose: () => void; onSave: (d: Row) => Promise<void>; onDelete?: () => Promise<void>; canEdit: boolean }) {
  const [msg, setMsg] = useState("");
  const fields = FIELDS[entity]!;
  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget); const d: Row = {};
        for (const x of fields) { const v = f.get(x.key); if (v === null || v === "") continue; d[x.key] = x.type === "number" ? Number(v) : v; }
        try { await onSave(d); } catch (x) { setMsg((x as Error).message); }
      }}>
        <div className="row"><h2 style={{ textTransform: "capitalize" }}>{row.id ? `Edit ${entity.slice(0, -1)}` : `New ${entity.slice(0, -1)}`}</h2><span className="grow" /><button type="button" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {row.id && <p className="muted mono">{row.id}</p>}
        {fields.map((x) => (
          <label key={x.key}><span>{x.label}</span>
            {x.type === "select" ? <select name={x.key} defaultValue={row[x.key] ?? x.options![0]} disabled={!canEdit}>{x.options!.map((o) => <option key={o}>{o}</option>)}</select>
              : x.type === "textarea" ? <textarea name={x.key} defaultValue={row[x.key] ?? ""} rows={4} disabled={!canEdit} />
              : <input name={x.key} type={x.type ?? "text"} defaultValue={row[x.key] ?? ""} disabled={!canEdit} />}
          </label>
        ))}
        {msg && <p className="err">{msg}</p>}
        <div className="row">
          {onDelete && <button type="button" onClick={async () => { try { await onDelete(); } catch (x) { setMsg((x as Error).message); } }} style={{ color: "var(--bad)" }}>Delete</button>}
          <span className="grow" />
          {canEdit && <button className="primary" type="submit">Save</button>}
        </div>
      </form>
    </div>
  );
}

function Insights({ org }: { org: string }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api(`/orgs/${org}/insights`).then(setD).catch((e) => setMsg(e.message)); }, [org]);
  if (msg) return <p className="err">{msg}</p>;
  if (!d) return <div className="empty">Counting…</div>;
  const counts: Record<string, number> = d.counts ?? {};
  const stages: { stage: string; n: number; amount_cents: number }[] = d.deals_by_stage ?? [];
  const max = Math.max(1, ...stages.map((s) => s.amount_cents));
  const weeks: { weeks_ago: number; total: number }[] = [...(d.activities_per_week ?? [])].reverse();
  const wmax = Math.max(1, ...weeks.map((w) => w.total));
  const top: { name: string; amount_cents: number; deals: number }[] = d.top_companies_by_open_pipeline ?? [];
  const tmax = Math.max(1, ...top.map((c) => c.amount_cents));
  const winRate = d.last_90_days?.win_rate;
  return (
    <>
      <h2>Insights</h2>
      <div className="kpis">
        {Object.entries(counts).map(([k, v]) => <div className="kpi" key={k}><span className="tag">{k}</span><span className="num">{Number(v).toLocaleString()}</span></div>)}
        <div className="kpi"><span className="tag">Win rate, 90 d</span><span className="num">{winRate == null ? "–" : `${Math.round(Number(winRate) * 100)}%`}</span></div>
      </div>
      {stages.length > 0 && <div className="card"><h3>Pipeline by stage</h3><div className="bars">{stages.map((s) => <div className="bar" key={s.stage}><Stage v={s.stage} /><i style={{ width: `${(100 * s.amount_cents) / max}%` }} /><span className="num">{money(s.amount_cents)} · {s.n}</span></div>)}</div></div>}
      {weeks.length > 0 && <div className="card"><h3>Activities, last 12 weeks</h3><div className="spark">{weeks.map((w) => <i key={w.weeks_ago} title={`${w.weeks_ago} weeks ago: ${w.total}`} style={{ height: `${(100 * w.total) / wmax}%` }} />)}</div></div>}
      {top.length > 0 && <div className="card"><h3>Open pipeline by company</h3><div className="bars">{top.map((c) => <div className="bar" key={c.name}><span>{c.name}</span><i style={{ width: `${(100 * c.amount_cents) / tmax}%` }} /><span className="num">{money(c.amount_cents)} · {c.deals}</span></div>)}</div></div>}
    </>
  );
}

/** Every row of an entity, 200 a page, for the engine. Stays in this tab; never sent anywhere. */
async function allRows(org: string, entity: string, cap = 20_000) {
  const out: Row[] = []; let cursor: string | null = null;
  do {
    const p = new URLSearchParams({ limit: "200" }); if (cursor) p.set("cursor", cursor);
    const r = await api(`/orgs/${org}/${entity}?${p}`);
    out.push(...rowsOf(r)); cursor = nextOf(r);
  } while (cursor && out.length < cap);
  return out;
}

function Engine({ org }: { org: string }) {
  const [out, setOut] = useState<{ kind: string; ms: number; rows: number; data: any } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const run = async (kind: "dedupe" | "forecast" | "stale") => {
    setBusy(kind); setMsg("");
    try {
      const eng = await import("../engine.ts");
      const t = performance.now();
      let data: any, rows = 0;
      if (kind === "dedupe") { const c = await allRows(org, "contacts"); rows = c.length; data = await eng.dedupe(c as never); }
      else if (kind === "forecast") { const d = await allRows(org, "deals"); rows = d.length; data = await eng.forecast(d as never, Date.now()); }
      else { const [d, a] = await Promise.all([allRows(org, "deals"), allRows(org, "activities")]); rows = d.length + a.length; data = await eng.stale(d as never, a as never, Date.now(), 30); }
      setOut({ kind, ms: Math.round(performance.now() - t), rows, data });
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  return (
    <>
      <h2>Engine</h2>
      <p className="muted">Rust, compiled to wasm, running in this tab. Rows are pulled from your org and analysed here; nothing goes back up. Capped at 20,000 rows per run for now.</p>
      <div className="row">
        <button type="button" className="primary" disabled={!!busy} onClick={() => run("dedupe")}><Icon name="users" /> Find duplicates</button>
        <button type="button" disabled={!!busy} onClick={() => run("forecast")}><Icon name="chart-column" /> Forecast pipeline</button>
        <button type="button" disabled={!!busy} onClick={() => run("stale")}><Icon name="activity" /> Stale deals, 30 d</button>
        {busy && <span className="muted">Running {busy}…</span>}
      </div>
      {msg && <p className="err">{msg}</p>}
      {out && <div className="card"><h3>{out.kind} · {out.rows.toLocaleString()} rows in · {out.ms} ms</h3><pre className="code">{JSON.stringify(out.data, null, 2).slice(0, 20_000)}</pre></div>}
    </>
  );
}

/** Stored scripts: small async functions an org keeps and runs, by hand here, from the API, or from an agent through MCP. */
function Scripts({ org, can }: { org: string; can: (r: string) => boolean }) {
  const [list, setList] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [runs, setRuns] = useState<Row[]>([]);
  const [out, setOut] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const base = `/orgs/${org}/scripts`;
  const refresh = useCallback(() => api(base).then((r) => setList(rowsOf(r))).catch((e) => setMsg(e.message)), [base]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (open?.id) api(`${base}/${open.id}/runs`).then((r) => setRuns(rowsOf(r))).catch(() => setRuns([])); else setRuns([]); }, [open?.id, base, out]);
  const act = async (fn: () => Promise<unknown>) => { setMsg(""); try { await fn(); await refresh(); } catch (e) { setMsg((e as Error).message); } };
  const run = (id: string) => act(async () => setOut(await api(`${base}/${id}/run`, { method: "POST", body: JSON.stringify({ input: {} }) })));
  return (
    <>
      <div className="toolbar"><h2>Scripts</h2><span className="grow" />
        {can("manager") && list.length === 0 && <button type="button" onClick={() => act(() => api(`${base}/examples`, { method: "POST" }))}><Icon name="download" /> Install the examples</button>}
        {can("manager") && <button className="primary" type="button" onClick={() => setOpen({ name: "", body: "async ({ input, qcrm, log }) => {\n  const { items } = await qcrm.list(\"contacts\", { limit: 5 });\n  log(items.length, \"contacts\");\n  return items.map((c) => c.email);\n}" })}><Icon name="plus" /> New script</button>}
      </div>
      <p className="muted">Each run is its own isolated Worker with no network: the script sees <code>qcrm</code> (list, get, create, update, remove, insights, scoped to this org and your role), <code>input</code> and <code>log</code>; 200 calls and 10 s per run. Agents run them through MCP as <code>run_script</code>.</p>
      {msg && <p className="err">{msg}</p>}
      <div className="list">{list.map((s) => (
        <div className="card" key={s.id}><div className="row"><b className="grow">{s.name}</b>{can("employee") && <button className="primary" type="button" onClick={() => run(s.id)}><Icon name="activity" /> Run</button>}<button type="button" onClick={() => setOpen(s)}>Open</button></div>
          <p className="muted mono">{String(s.body ?? "").split("\n")[0]}</p></div>))}
        {!list.length && <div className="empty">No scripts yet.</div>}
      </div>
      {out && <div className="card"><h3>Last run · {out.status ?? "ok"} · {out.calls ?? 0} calls · {out.ms ?? ""} ms</h3>{Array.isArray(out.log) && out.log.length > 0 && <pre className="code">{out.log.join("\n")}</pre>}<pre className="code">{JSON.stringify(out.result ?? out, null, 2).slice(0, 20_000)}</pre></div>}
      {open && <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
        <form onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const d = { name: f.get("name"), body: f.get("body") }; await act(() => api(open.id ? `${base}/${open.id}` : base, { method: open.id ? "PUT" : "POST", body: JSON.stringify(d) })); setOpen(null); }}>
          <div className="row"><h2>{open.id ? "Edit script" : "New script"}</h2><span className="grow" /><button type="button" onClick={() => setOpen(null)} aria-label="Close"><Icon name="x" /></button></div>
          <label><span>Name</span><input name="name" defaultValue={open.name ?? ""} required maxLength={80} disabled={!can("manager")} /></label>
          <label><span>Body: an async function of {"{ input, qcrm, log }"}</span><textarea name="body" defaultValue={open.body ?? ""} rows={16} className="mono" required disabled={!can("manager")} /></label>
          <div className="row">
            {open.id && can("owner") && <button type="button" style={{ color: "var(--bad)" }} onClick={() => act(() => api(`${base}/${open.id}`, { method: "DELETE" })).then(() => setOpen(null))}>Delete</button>}
            <span className="grow" />
            {open.id && can("employee") && <button type="button" onClick={() => run(open.id)}>Run</button>}
            {can("manager") && <button className="primary" type="submit">Save</button>}
          </div>
          {runs.length > 0 && <div className="table"><table><thead><tr><th>When</th><th>Status</th><th>Calls</th><th>Log</th></tr></thead><tbody>{runs.map((r) => <tr key={r.id}><td>{when(r.started_at)}</td><td>{r.status}</td><td className="num">{r.calls}</td><td>{String(r.log ?? "").slice(0, 80)}</td></tr>)}</tbody></table></div>}
        </form>
      </div>}
    </>
  );
}

function Settings({ me, org, role, can, reload }: { me: Me; org: { id: string; name: string }; role: string; can: (r: string) => boolean; reload: () => Promise<void> }) {
  const [members, setMembers] = useState<Row[]>([]);
  const [hooks, setHooks] = useState<Row[]>([]);
  const [keys, setKeys] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [fresh, setFresh] = useState("");
  const [msg, setMsg] = useState("");
  const base = `/orgs/${org.id}`;
  const refresh = useCallback(() => {
    api(`${base}/members`).then((r) => setMembers(rowsOf(r))).catch(() => {});
    if (can("owner")) { api(`${base}/webhooks`).then((r) => setHooks(r.webhooks ?? rowsOf(r))).catch(() => {}); api(`${base}/keys`).then((r) => setKeys(rowsOf(r))).catch(() => {}); }
    if (can("manager")) api(`${base}/audit`).then((r) => setAudit(rowsOf(r))).catch(() => {});
  }, [base, can]);
  useEffect(refresh, [refresh]);
  const act = async (fn: () => Promise<unknown>) => { setMsg(""); try { await fn(); refresh(); } catch (e) { setMsg((e as Error).message); } };
  const mcp = useMemo(() => `claude mcp add --transport http qcrm ${location.origin}/api/mcp --header "Authorization: Bearer ${fresh || "qk_…"}"`, [fresh]);
  return (
    <>
      <h2>Settings</h2>
      <p className="muted">{org.name} · <code>{org.id}</code> · you are <b>{role}</b> · {me.user!.email}</p>
      {msg && <p className="err">{msg}</p>}
      <div className="card" data-tour="members">
        <h3><Icon name="users" /> Members</h3>
        <div className="list">{members.map((m) => (
          <div className="row" key={m.user_id ?? m.id}><span className="grow">{m.name ?? m.email ?? m.user_id} <span className="muted">{m.email}</span></span>
            {can("manager") ? <select value={m.role} onChange={(e) => act(() => api(`${base}/members/${m.user_id ?? m.id}`, { method: "PUT", body: JSON.stringify({ role: e.target.value }) }))}>{ROLES.map((r) => <option key={r} disabled={!can(r === "admin" || r === "owner" ? "admin" : r === "manager" ? "owner" : "manager")}>{r}</option>)}</select> : <span className="pill">{m.role}</span>}
            {can("manager") && <button type="button" aria-label="Remove" onClick={() => act(() => api(`${base}/members/${m.user_id ?? m.id}`, { method: "DELETE" }))}><Icon name="x" /></button>}
          </div>))}</div>
        {can("manager") && <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => api(`${base}/members`, { method: "POST", body: JSON.stringify({ email: f.get("email"), role: f.get("role") }) })); e.currentTarget.reset(); }}>
          <input name="email" type="email" placeholder="colleague@company.com" required className="grow" />
          <select name="role" defaultValue="seasonal">{ROLES.map((r) => <option key={r} disabled={!can(r === "admin" || r === "owner" ? "admin" : r === "manager" ? "owner" : "manager")}>{r}</option>)}</select>
          <button className="primary" type="submit"><Icon name="plus" /> Invite</button>
        </form>}
        <p className="muted">Roles: seasonal (notes only) · employee (edit) · manager (delete, invite) · owner (webhooks, keys, export) · admin (everything in this org).</p>
      </div>
      {can("owner") && <div className="card" data-tour="mcp">
        <h3><Icon name="plug" /> Agents (MCP) and API keys</h3>
        <div className="list">{keys.map((k) => <div className="row" key={k.id}><code>{k.prefix}…</code><span className="grow">{k.name} <span className="muted">{k.last_used_at ? `used ${when(k.last_used_at)}` : "never used"}</span></span><button type="button" onClick={() => act(() => api(`${base}/keys/${k.id}`, { method: "DELETE" }))}>Revoke</button></div>)}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(async () => { const r = await api(`${base}/keys`, { method: "POST", body: JSON.stringify({ name: f.get("name") }) }); setFresh(r.secret ?? r.key ?? ""); }); e.currentTarget.reset(); }}>
          <input name="name" placeholder="Key name, e.g. Claude on my laptop" required className="grow" /><button className="primary" type="submit"><Icon name="key-round" /> New key</button>
        </form>
        {fresh && <label><span className="ok">Your new key. Copy it now; it is shown once.</span><input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} className="mono" /></label>}
        <pre className="code">{mcp}</pre>
      </div>}
      {can("owner") && <div className="card" data-tour="webhooks">
        <h3><Icon name="webhook" /> Webhooks</h3>
        <div className="list">{hooks.map((h) => <div className="row" key={h.id}><span className="grow mono">{h.url}</span><span className="pill">{Array.isArray(h.events) ? h.events.join(", ") : String(h.events ?? "*")}</span><button type="button" onClick={() => act(() => api(`${base}/webhooks/${h.id}`, { method: "DELETE" }))}><Icon name="x" /></button></div>)}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => api(`${base}/webhooks`, { method: "POST", body: JSON.stringify({ url: f.get("url"), events: String(f.get("events") || "*").split(",").map((s) => s.trim()).filter(Boolean) }) })); e.currentTarget.reset(); }}>
          <input name="url" type="url" placeholder="https://example.com/hooks/qcrm" required className="grow" /><input name="events" placeholder="contact.created, deal.updated" style={{ maxWidth: 260 }} /><button className="primary" type="submit"><Icon name="plus" /> Add</button>
        </form>
        <p className="muted">Each delivery carries x-qcrm-signature (HMAC-SHA256 of the body with the webhook's secret), retried with backoff for a day.</p>
      </div>}
      <div className="card">
        <h3><Icon name="monitor" /> Look and feel</h3>
        <div className="row"><button type="button" onClick={() => theme("light")}>Cream</button><button type="button" onClick={() => theme("dark")}>Blackest black</button><button type="button" onClick={() => theme("auto")}>Follow system</button></div>
      </div>
      {can("manager") && audit.length > 0 && <div className="card">
        <h3><Icon name="scroll-text" /> Audit log</h3>
        <div className="table"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead><tbody>{audit.slice(0, 50).map((a) => <tr key={a.id}><td>{when(a.at)}</td><td>{a.actor_email ?? a.actor_user_id}</td><td>{a.action}</td><td>{a.target}</td></tr>)}</tbody></table></div>
      </div>}
      <div className="card">
        <h3><Icon name="download" /> Your data</h3>
        <div className="row">
          {can("owner") && <a className="btn" href={`/api${base}/export`} download={`qcrm-${org.id}.json`}><Icon name="download" /> Export every row</a>}
          {can("owner") && <button type="button" onClick={() => { const n = Number(prompt("Seed how many contacts? (up to 100000)", "1000")); if (n > 0) act(async () => { await api(`${base}/seed`, { method: "POST", body: JSON.stringify({ n }) }); await reload(); setMsg(`Seeded ${n.toLocaleString()} contacts. Open Contacts to see them.`); }); }}><Icon name="flask-conical" /> Seed sample data</button>}
          <span className="grow" />
          <button type="button" style={{ color: "var(--bad)" }} onClick={() => { const c = prompt(`Delete your account, the orgs you own and all their rows? Type your email to confirm.`); if (c) act(() => api(`/me?confirm=${encodeURIComponent(c)}`, { method: "DELETE" }).then(() => { location.href = "/"; })); }}>Delete my account</button>
        </div>
      </div>
    </>
  );
}
