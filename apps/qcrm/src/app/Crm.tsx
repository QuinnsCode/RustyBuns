"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icons.tsx";
import { register, type Command } from "./commands.ts";
import { Palette } from "./Palette.tsx";

// The CRM in the browser: sign in, pick an org, then tables of the four entities, insights from
// SQL, the Rust engine's analysis over rows pulled into the page, and settings (members,
// webhooks, keys, export, delete). Every call goes to /api with the session cookie.

type Row = Record<string, any>;
/** Something a command asks the open table to do once it is showing. */
type Intent = { type: "new" } | { type: "search"; q: string };
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
const whenAt = (v: unknown) => (typeof v === "number" || typeof v === "string") && v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
/** What a linked row is called in a table or a picker. */
const nameOf = (r: Row) => r.name ?? ([r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || r.id);
const ROLES = ["seasonal", "employee", "manager", "owner", "admin"] as const;
const RANK: Record<string, number> = { seasonal: 1, employee: 2, manager: 3, owner: 4, admin: 5, super_admin: 6 };
const STAGES = ["lead", "qualified", "proposal", "won", "lost"];

const COLS: Record<string, { key: string; label: string; kind?: "money" | "date" | "stage" | "num"; ref?: string }[]> = {
  contacts: [{ key: "first_name", label: "First" }, { key: "last_name", label: "Last" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "title", label: "Title" }, { key: "company_id", label: "Company", ref: "companies" }, { key: "updated_at", label: "Updated", kind: "date" }],
  companies: [{ key: "name", label: "Name" }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "size", label: "Size", kind: "num" }, { key: "updated_at", label: "Updated", kind: "date" }],
  deals: [{ key: "name", label: "Deal" }, { key: "stage", label: "Stage", kind: "stage" }, { key: "amount_cents", label: "Amount", kind: "money" }, { key: "company_id", label: "Company", ref: "companies" }, { key: "contact_id", label: "Contact", ref: "contacts" }, { key: "close_at", label: "Close", kind: "date" }, { key: "updated_at", label: "Updated", kind: "date" }],
  activities: [{ key: "type", label: "Type" }, { key: "body", label: "Note" }, { key: "contact_id", label: "Contact", ref: "contacts" }, { key: "deal_id", label: "Deal", ref: "deals" }, { key: "at", label: "When", kind: "date" }],
};
const FIELDS: Record<string, { key: string; label: string; type?: string; options?: string[]; ref?: string }[]> = {
  contacts: [{ key: "first_name", label: "First name" }, { key: "last_name", label: "Last name" }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone" }, { key: "title", label: "Title" }, { key: "company_id", label: "Company", ref: "companies" }, { key: "notes", label: "Notes", type: "textarea" }],
  companies: [{ key: "name", label: "Name" }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "size", label: "Size", type: "number" }],
  deals: [{ key: "name", label: "Name" }, { key: "stage", label: "Stage", type: "select", options: STAGES }, { key: "amount_cents", label: "Amount (cents)", type: "number" }, { key: "currency", label: "Currency" }, { key: "contact_id", label: "Contact", ref: "contacts" }, { key: "company_id", label: "Company", ref: "companies" }, { key: "close_at", label: "Close (ms)", type: "number" }],
  activities: [{ key: "type", label: "Type", type: "select", options: ["call", "email", "meeting", "note"] }, { key: "body", label: "Body", type: "textarea" }, { key: "contact_id", label: "Contact", ref: "contacts" }, { key: "deal_id", label: "Deal", ref: "deals" }],
};

const theme = (t: "light" | "dark" | "auto") => {
  try { t === "auto" ? localStorage.removeItem("qcrm-theme") : localStorage.setItem("qcrm-theme", t); } catch {}
  t === "auto" ? document.documentElement.removeAttribute("data-theme") : document.documentElement.setAttribute("data-theme", t);
};

/** Truncated id that copies the whole thing on click; the full id is the tooltip. */
/** Registers what this person can do right now as commands: the Ctrl/Cmd-K menu and `window.crmCommands` both run these. */
function Commands({ items, me, org, can, setView, setOrg, setIntent }: { items: [View, string, string][]; me: Me; org: string; can: (r: string) => boolean; setView: (v: View) => void; setOrg: (id: string) => void; setIntent: (i: Intent | null) => void }) {
  useEffect(() => {
    const entities = ["contacts", "companies", "deals", "activities"] as const;
    const cmds: Command[] = [
      ...items.map(([v, label, icon]): Command => ({ id: `go.${v}`, title: `Go to ${label}`, icon, run: () => setView(v) })),
      ...entities.map((e): Command => ({ id: `${e}.new`, title: `New ${e.replace(/s$/, "")}`, icon: "plus", enabled: can(e === "activities" ? "seasonal" : "employee"), run: () => { setView(e); setIntent({ type: "new" }); } })),
      ...entities.map((e): Command => ({ id: `${e}.search`, title: `Search ${e}`, icon: "search", menu: false, run: (a) => { setView(e); setIntent({ type: "search", q: String(a?.q ?? "") }); } })),
      ...(["light", "dark", "auto"] as const).map((t): Command => ({ id: `theme.${t}`, title: `Theme: ${t}`, icon: "monitor", keywords: "appearance", run: () => theme(t) })),
      { id: "org.switch", title: "Switch org", menu: false, run: (a) => setOrg(String(a?.id)) },
      ...me.orgs.filter((o) => o.id !== org).map((o): Command => ({ id: `org.switch.${o.id}`, title: `Switch to ${o.name}`, icon: "building", keywords: "org", run: () => setOrg(o.id) })),
      { id: "sign-out", title: "Sign out", icon: "log-out", run: async () => { await api("/auth/sign-out", { method: "POST", body: "{}" }); location.href = "/"; } },
    ];
    return register(cmds);
  });
  return null;
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <button type="button" className="copy-id" title={done ? "Copied" : `Copy ${id}`} aria-label={`Copy org id ${id}`} onClick={copy}><code>{id.slice(0, 12)}…</code><Icon name={done ? "check" : "copy"} /></button>;
}

/** Make the scenario's account and workspace, signed in; resolves with the screen it lands on. */
async function landIn(name: string): Promise<View> {
  const r = await api("/scenario", { method: "POST", body: JSON.stringify({ name }) });
  return r.view as View;
}

export function Crm() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [org, setOrg] = useState<string | null>(null);
  const [view, setView] = useState<View>("contacts");
  const [err, setErr] = useState("");
  const [demo, setDemo] = useState(false);
  const [menu, setMenu] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);

  const load = useCallback(async () => {
    try { const m = await api("/me"); setMe(m); if (!org && m.orgs?.[0]) setOrg(m.orgs[0].id); }
    catch { setMe({ user: null, orgs: [] }); }
  }, [org]);

  useEffect(() => {
    try { const t = localStorage.getItem("qcrm-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}
    const q = new URLSearchParams(location.search);
    const scenario = q.get("scenario");
    if (scenario) {
      // A scenario link (/app?scenario=webhooks): a throwaway account on a populated workspace, landing on its screen. Local only.
      setDemo(true);
      landIn(scenario).then(async (v) => { history.replaceState(null, "", location.pathname); const m = await api("/me"); setMe(m); setOrg(m.orgs.find((o: Row) => o.plan === "demo")?.id ?? m.orgs[0]?.id ?? null); setView(v); })
        .catch((e) => { setDemo(false); setErr(e.message); void load(); });
    } else if (q.get("demo") === "1") {
      setDemo(true);
      // The demo frame: ask for a throwaway org, then carry on as that account.
      api("/me").then((m) => (m?.user && m.orgs?.some((o: Row) => o.plan === "demo") ? m : Promise.reject(new Error("no demo"))))
        .catch(() => api("/demo", { method: "POST" }))
        .then(() => api("/me")).then((m) => { setMe(m); setOrg(m.orgs.find((o: Row) => o.plan === "demo")?.id ?? m.orgs[0]?.id ?? null); })
        .catch((e) => setErr(e.message));
    } else void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (me !== undefined) window.dispatchEvent(new Event("qcrm-session")); }, [me?.user?.id]); // tell the nav

  // What a script or an agent drives the page with (the same state the links above set):
  //   await window.qcrm.scenario("webhooks")   a throwaway account on that scenario (local only), landing on its screen
  //   window.qcrm.goto("scripts")              switch screen
  useEffect(() => {
    const hook = {
      goto: (v: View) => setView(v),
      scenario: async (name: string) => {
        const v = await landIn(name);
        const m = await api("/me");
        setMe(m); setOrg(m.orgs.find((o: Row) => o.plan === "demo")?.id ?? m.orgs[0]?.id ?? null); setView(v);
        return { view: v, org: m.orgs[0]?.id };
      },
    };
    (window as any).qcrm = hook;
    return () => { delete (window as any).qcrm; };
  }, []);

  if (me === undefined) return <div className="empty">Loading…</div>;
  if (!me.user) return <Auth onDone={load} demo={demo} err={err} />;
  const current = me.orgs.find((o) => o.id === org) ?? me.orgs[0];
  if (!current) return <NewOrg onDone={load} />;
  const role = me.superAdmin ? "super_admin" : current.role;
  const can = (min: string) => RANK[role]! >= RANK[min]!;
  const items: [View, string, string][] = [["contacts", "Contacts", "users"], ["companies", "Companies", "building"], ["deals", "Deals", "badge-dollar-sign"], ["activities", "Activities", "activity"], ["insights", "Insights", "chart-column"], ["engine", "Engine", "cpu"], ["scripts", "Scripts", "scroll-text"], ["settings", "Settings", "key-round"]];
  return (
    <div className="crm">
      <Commands items={items} me={me} org={current.id} can={can} setView={setView} setOrg={setOrg} setIntent={setIntent} />
      <Palette />
      <aside className={"rail" + (menu ? " open" : "")} data-tour="rail">
        <div className="org"><span className="tag">Org</span><b title={current.id}>{current.name}</b><span>{role} · <CopyId id={current.id} /></span></div>
        <button type="button" className="nav-item menu-btn" aria-expanded={menu} aria-label="Menu" title="Menu" onClick={() => setMenu(!menu)}><Icon name={menu ? "x" : "menu"} /></button>
        {items.map(([v, label, icon]) => <button key={v} type="button" className={"nav-item" + (view === v ? " on" : "")} onClick={() => { setView(v); setMenu(false); }} data-tour={`nav-${v}`}><Icon name={icon} /> {label}</button>)}
        {me.orgs.length > 1 && <select value={current.id} onChange={(e) => setOrg(e.target.value)} aria-label="Switch org">{me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <button type="button" className="nav-item" onClick={async () => { await api("/auth/sign-out", { method: "POST", body: "{}" }); location.href = "/"; }}><Icon name="log-out" /> Sign out</button>
      </aside>
      <section className="pane">
        {err && <p className="err">{err}</p>}
        {view in COLS && <Table key={current.id + view} org={current.id} entity={view} can={can} intent={intent} onIntent={() => setIntent(null)} />}
        {view === "insights" && <Insights org={current.id} />}
        {view === "engine" && <Engine org={current.id} can={can} />}
        {view === "scripts" && <Scripts org={current.id} can={can} />}
        {view === "settings" && <Settings me={me} org={current} role={role} can={can} reload={load} />}
      </section>
    </div>
  );
}

function Auth({ onDone, demo, err }: { onDone: () => Promise<void>; demo: boolean; err: string }) {
  // The reset link lands on /app?token=… (Better Auth redirects there from the emailed link).
  const token = new URLSearchParams(location.search).get("token");
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">(token ? "reset" : "in");
  const [msg, setMsg] = useState(err);
  const [note, setNote] = useState("");
  const go = (m: typeof mode) => { setMsg(""); setNote(""); setMode(m); };
  const [social, setSocial] = useState<string[]>([]);
  useEffect(() => { api("/providers").then((p: string[]) => setSocial(p.filter((x) => x !== "email"))).catch(() => {}); }, []);
  const via = async (provider: string) => {
    try { const r = await api("/auth/sign-in/social", { method: "POST", body: JSON.stringify({ provider, callbackURL: location.pathname + location.search }) }); if (r?.url) location.href = r.url; }
    catch (x) { setMsg((x as Error).message); }
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { email: f.get("email"), password: f.get("password"), name: f.get("name") || String(f.get("email")).split("@")[0] };
    const post = (path: string, b: unknown) => api(path, { method: "POST", body: JSON.stringify(b) });
    try {
      if (mode === "forgot") { await post("/auth/request-password-reset", { email: body.email, redirectTo: "/app" }); setNote("If that email has an account, a reset link is on its way."); return; }
      if (mode === "reset") { await post("/auth/reset-password", { newPassword: body.password, token }); history.replaceState(null, "", location.pathname); go("in"); setNote("Password changed. Sign in with it."); return; }
      await post(mode === "in" ? "/auth/sign-in/email" : "/auth/sign-up/email", body); await onDone();
    } catch (x) { setMsg((x as Error).message); }
  };
  if (demo && !msg) return <div className="empty">Setting up your demo org, 2,000 contacts and all…</div>;
  return (
    <div className="auth" data-tour="auth">
      <h2>{{ in: "Sign in", up: "Create your account", forgot: "Reset your password", reset: "Pick a new password" }[mode]}</h2>
      {social.length > 0 && <div className="row">{social.map((p) => <button key={p} type="button" onClick={() => via(p)}><Icon name={p === "github" ? "github" : "mail"} /> Continue with {p === "github" ? "GitHub" : "Google"}</button>)}</div>}
      <p className="muted">Email and password, kept by Better Auth. Your first org is made when you sign up.</p>
      <form onSubmit={submit}>
        {mode === "up" && <label><span>Name</span><input name="name" aria-label="Name" autoComplete="name" /></label>}
        {mode !== "reset" && <label><span>Email</span><input name="email" type="email" aria-label="Email" required autoComplete="email" /></label>}
        {mode !== "forgot" && <label><span>{mode === "reset" ? "New password" : "Password"}</span><input name="password" type="password" aria-label={mode === "reset" ? "New password" : "Password"} required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>}
        {msg && <p className="err">{msg}</p>}
        {note && <p className="muted">{note}</p>}
        <div className="row"><button className="primary" type="submit">{{ in: "Sign in", up: "Sign up", forgot: "Send link", reset: "Change password" }[mode]}</button>
          {mode !== "reset" && <button type="button" onClick={() => go(mode === "in" ? "up" : "in")}>{mode === "in" ? "New here? Sign up" : "Have an account? Sign in"}</button>}
          {mode === "in" && <button type="button" onClick={() => go("forgot")}>Forgot password?</button>}</div>
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
        <label><span>Org name</span><input name="name" aria-label="Org name" required maxLength={80} /></label>
        {msg && <p className="err">{msg}</p>}
        <button className="primary" type="submit">Create</button>
      </form>
    </div>
  );
}

function Table({ org, entity, can, intent, onIntent }: { org: string; entity: string; can: (r: string) => boolean; intent: Intent | null; onIntent: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [msg, setMsg] = useState("");
  const [board, setBoard] = useState(false);
  const [rev, setRev] = useState(0);
  const cols = COLS[entity]!;
  const [names, setNames] = useState<Record<string, string>>({});
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
  // Rows hold ids of linked rows; look up the ones this page shows and put names in their place.
  useEffect(() => {
    const want = new Set<string>();
    for (const c of cols) if (c.ref) for (const r of rows) { const id = r[c.key]; if (id && !(c.ref + id in names)) want.add(c.ref + "/" + id); }
    if (!want.size) return;
    let live = true;
    void Promise.all([...want].map((k) => api(`/orgs/${org}/${k}`).then((r) => [k.replace("/", ""), nameOf(r)] as const).catch(() => [k.replace("/", ""), ""] as const)))
      .then((got) => { if (live) setNames((n) => ({ ...n, ...Object.fromEntries(got) })); });
    return () => { live = false; };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (data: Row) => {
    const id = edit?.id;
    await api(`/orgs/${org}/${entity}${id ? "/" + id : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    setEdit(null); setRev((n) => n + 1); await fetchPage(null, true);
  };
  const remove = async (id: string) => { await api(`/orgs/${org}/${entity}/${id}`, { method: "DELETE" }); setEdit(null); setRev((n) => n + 1); await fetchPage(null, true); };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setMsg("");
    try {
      const r = await api(`/orgs/${org}/${entity}/import`, { method: "POST", body: JSON.stringify({ csv: await file.text() }) });
      setMsg(`Imported ${r.created.toLocaleString()}, skipped ${r.duplicates.toLocaleString()} duplicates${r.failed ? `, ${r.failed} rows failed (first: row ${r.errors[0].row}, ${r.errors[0].error})` : ""}.`);
      await fetchPage(null, true);
    } catch (e) { setMsg((e as Error).message); }
  };
  const [over, setOver] = useState(false);
  const minCreate = entity === "activities" ? "seasonal" : "employee";
  useEffect(() => {
    if (!intent) return;
    if (intent.type === "new" && can(minCreate)) setEdit({});
    if (intent.type === "search") setQ(intent.q);
    onIntent();
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="toolbar" data-tour="toolbar">
        <h2 style={{ textTransform: "capitalize" }}>{entity}</h2>
        <input type="search" placeholder={`Search ${entity}…`} value={q} onChange={(e) => setQ(e.target.value)} data-tour="search" aria-label="Search" />
        {ms !== null && <span className="num" title="Round trip to the edge, this page">{ms} ms</span>}
        {total !== null && <span className="num">{total.toLocaleString()} rows</span>}
        {entity === "deals" && <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={!board} title="Table" aria-label="Table" onClick={() => setBoard(false)}><Icon name="table" /></button>
          <button type="button" aria-pressed={board} title="Board by stage" aria-label="Board" onClick={() => setBoard(true)}><Icon name="kanban" /></button>
        </div>}
        {(entity === "contacts" || entity === "companies") && can("employee") && <label className="btn" title="Import a CSV"><Icon name="upload" /> Import<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>}
        {can(minCreate) && <button className="primary" type="button" onClick={() => setEdit({})}><Icon name="plus" /> New</button>}
      </div>
      {msg && <p className="err">{msg}</p>}
      {(entity === "contacts" || entity === "companies") && can("employee") && <div className={`dropzone${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void importFile(e.dataTransfer.files[0]); }}>Drop a CSV here to import {entity}</div>}
      {entity === "deals" && board ? <Board org={org} q={q} rev={rev} canEdit={can("employee")} onOpen={setEdit} onError={setMsg} /> : <div className="table">
        <table>
          <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setEdit(r)}>
                {cols.map((c) => <td key={c.key} className={c.kind === "money" || c.kind === "num" ? "num" : ""}>{c.ref ? (names[c.ref + r[c.key]] ?? "") : cell(r[c.key], c.kind, r.currency)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{q ? "Nothing matches." : `No ${entity} yet.`}</div>}
      </div>}
      {next && !(entity === "deals" && board) && <button type="button" onClick={() => fetchPage(next, false)}>Load more</button>}
      {edit && <Sheet org={org} entity={entity} row={edit} onClose={() => setEdit(null)} onSave={save} onDelete={can("manager") && edit.id ? () => remove(edit.id) : undefined} canEdit={can("employee") || !edit.id} />}
    </>
  );
}

/** Deals as columns by stage. Dropping a card on another column is one PUT of its stage. */
function Board({ org, q, rev, canEdit, onOpen, onError }: { org: string; q: string; rev: number; canEdit: boolean; onOpen: (r: Row) => void; onError: (m: string) => void }) {
  const [cols, setCols] = useState<Record<string, { rows: Row[]; next: string | null }>>({});
  const [over, setOver] = useState("");
  const load = useCallback(async (stage: string, cursor: string | null) => {
    const p = new URLSearchParams({ limit: "50", stage });
    if (q) p.set("q", q);
    if (cursor) p.set("cursor", cursor);
    const r = await api(`/orgs/${org}/deals?${p}`);
    setCols((c) => ({ ...c, [stage]: { rows: cursor ? [...(c[stage]?.rows ?? []), ...rowsOf(r)] : rowsOf(r), next: nextOf(r) } }));
  }, [org, q]);
  useEffect(() => { void Promise.all(STAGES.map((s) => load(s, null))).catch((e) => onError((e as Error).message)); }, [load, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = async (stage: string, id: string) => {
    setOver("");
    const from = STAGES.find((s) => cols[s]?.rows.some((r) => r.id === id));
    if (!from || from === stage) return;
    const row = cols[from]!.rows.find((r) => r.id === id)!;
    setCols((c) => ({ ...c, [from]: { ...c[from]!, rows: c[from]!.rows.filter((r) => r.id !== id) }, [stage]: { ...c[stage]!, rows: [{ ...row, stage }, ...(c[stage]?.rows ?? [])] } }));
    try { await api(`/orgs/${org}/deals/${id}`, { method: "PUT", body: JSON.stringify({ stage }) }); }
    catch (e) { onError((e as Error).message); await Promise.all([load(from, null), load(stage, null)]).catch(() => {}); }
  };
  return (
    <div className="board" data-testid="board">
      {STAGES.map((s) => {
        const col = cols[s]?.rows ?? [];
        const sum = col.reduce((a, r) => a + (typeof r.amount_cents === "number" ? r.amount_cents : 0), 0);
        return (
          <section key={s} className={`lane${over === s ? " over" : ""}`} data-stage={s}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver("")}
            onDrop={(e) => { e.preventDefault(); void drop(s, e.dataTransfer.getData("text/plain")); }}>
            <header><Stage v={s} /><span className="num">{col.length}{cols[s]?.next ? "+" : ""} · {money(sum)}</span></header>
            {col.map((r) => (
              <article key={r.id} className="deal" draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => onOpen(r)}>
                <strong>{r.name}</strong><span className="num">{money(r.amount_cents, r.currency || "USD")}</span>
              </article>
            ))}
            {cols[s]?.next && <button type="button" onClick={() => void load(s, cols[s]!.next)}>More</button>}
          </section>
        );
      })}
    </div>
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

function Sheet({ org, entity, row, onClose, onSave, onDelete, canEdit }: { org: string; entity: string; row: Row; onClose: () => void; onSave: (d: Row) => Promise<void>; onDelete?: () => Promise<void>; canEdit: boolean }) {
  const [msg, setMsg] = useState("");
  const [sure, setSure] = useState(false);
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
            {x.ref ? <Picker org={org} entity={x.ref} name={x.key} initial={row[x.key]} disabled={!canEdit} />
              : x.type === "select" ? <select name={x.key} defaultValue={row[x.key] ?? x.options![0]} disabled={!canEdit}>{x.options!.map((o) => <option key={o}>{o}</option>)}</select>
              : x.type === "textarea" ? <textarea name={x.key} defaultValue={row[x.key] ?? ""} rows={4} disabled={!canEdit} />
              : <input name={x.key} type={x.type ?? "text"} defaultValue={row[x.key] ?? ""} disabled={!canEdit} />}
          </label>
        ))}
        {msg && <p className="err">{msg}</p>}
        <div className="row actions">
          {onDelete && !sure && <button type="button" onClick={() => setSure(true)} style={{ color: "var(--bad)" }}>Delete</button>}
          {onDelete && sure && <>
            <span className="muted">Delete this {entity.slice(0, -1)}?</span>
            <button type="button" onClick={async () => { try { await onDelete(); } catch (x) { setMsg((x as Error).message); setSure(false); } }} style={{ color: "var(--bad)" }}>Yes, delete</button>
            <button type="button" onClick={() => setSure(false)}>Keep</button>
          </>}
          <span className="grow" />
          {canEdit && <button className="primary" type="submit">Save</button>}
        </div>
      </form>
    </div>
  );
}

/** Date `ago` weeks back, as "Oct 9": the axis label of that week bucket. */
const weekLabel = (ago: number) => new Date(Date.now() - ago * 7 * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
      {weeks.length > 0 && <div className="card"><h3>Activities, last 12 weeks</h3><div className="spark">{weeks.map((w) => <div className="col" key={w.weeks_ago} title={`${weekLabel(w.weeks_ago)}: ${w.total} activities`}><span className="num">{w.total}</span><i style={{ height: `${(100 * w.total) / wmax}%` }} /><span className="axis">{weekLabel(w.weeks_ago)}</span></div>)}</div></div>}
      {top.length > 0 && <div className="card"><h3>Open pipeline by company</h3><div className="bars">{top.map((c) => <div className="bar" key={c.name}><span className="name" title={c.name}>{c.name}</span><i style={{ width: `${(100 * c.amount_cents) / tmax}%` }} /><span className="num">{money(c.amount_cents)} · {c.deals}</span></div>)}</div></div>}
    </>
  );
}

/** Pick a linked row by typing its name; the form gets its id. */
function Picker({ org, entity, name, initial, disabled }: { org: string; entity: string; name: string; initial?: string; disabled: boolean }) {
  const [id, setId] = useState<string>(initial ?? "");
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (initial) api(`/orgs/${org}/${entity}/${initial}`).then((r) => setText(nameOf(r))).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => api(`/orgs/${org}/${entity}?${new URLSearchParams({ limit: "8", ...(text ? { q: text } : {}) })}`).then((r) => setHits(rowsOf(r))).catch(() => setHits([])), 120);
    return () => clearTimeout(h);
  }, [text, open, org, entity]);
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input type="hidden" name={name} value={id} />
      <input type="search" value={text} placeholder={`Search ${entity}…`} disabled={disabled} autoComplete="off"
        onChange={(e) => { setText(e.target.value); setId(""); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <ul role="listbox" style={{ position: "absolute", left: 0, right: 0, zIndex: 5, margin: 0, padding: 4, listStyle: "none", background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
          {hits.map((h) => <li key={h.id} role="option" style={{ padding: "6px 8px", cursor: "pointer" }} onMouseDown={() => { setId(h.id); setText(nameOf(h)); setOpen(false); }}>{nameOf(h)}</li>)}
        </ul>
      )}
    </span>
  );
}

/** Every row of an entity, 200 a page, for the engine. Stays in this tab; never sent anywhere. */
async function allRows(org: string, entity: string, cap = 100_000) {
  const out: Row[] = []; let cursor: string | null = null;
  do {
    const p = new URLSearchParams({ limit: "200" }); if (cursor) p.set("cursor", cursor);
    const r = await api(`/orgs/${org}/${entity}?${p}`);
    out.push(...rowsOf(r)); cursor = nextOf(r);
  } while (cursor && out.length < cap);
  return out;
}

type EngineOut =
  | { kind: "dedupe"; pairs: any[]; people: Map<string, Row> }
  | { kind: "forecast"; f: any }
  | { kind: "stale"; deals: any[]; rows: Map<string, Row>; days: number };

function Engine({ org, can }: { org: string; can: (r: string) => boolean }) {
  const [out, setOut] = useState<{ res: EngineOut; load: number; ms: number; rows: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<{ entity: string; row: Row } | null>(null);
  const run = async (kind: "dedupe" | "forecast" | "stale") => {
    setBusy(kind); setMsg("");
    try {
      const eng = await import("../engine.ts");
      const t0 = performance.now();
      let res: EngineOut, rows = 0, t1 = 0;
      const byId = (l: Row[]) => new Map(l.map((r) => [String(r.id), r]));
      if (kind === "dedupe") { const c = await allRows(org, "contacts"); rows = c.length; t1 = performance.now(); res = { kind, pairs: await eng.dedupe(c as never), people: byId(c) }; }
      else if (kind === "forecast") { const d = await allRows(org, "deals"); rows = d.length; t1 = performance.now(); res = { kind, f: await eng.forecast(d as never, Date.now()) }; }
      else { const [d, a] = await Promise.all([allRows(org, "deals"), allRows(org, "activities")]); rows = d.length + a.length; t1 = performance.now(); res = { kind, deals: await eng.stale(d as never, a as never, Date.now(), 30), rows: byId(d), days: 30 }; }
      setOut({ res, rows, load: Math.round(t1 - t0), ms: Math.round(performance.now() - t1) });
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const open = (entity: string, id: unknown, m: Map<string, Row>) => { const row = m.get(String(id)); if (row) setEdit({ entity, row }); };
  const link = (entity: string, id: unknown, m: Map<string, Row>, label: string) => <button type="button" className="link" onClick={() => open(entity, id, m)}>{label}</button>;
  const res = out?.res;
  const label = (r: Row | undefined, id: unknown) => (r ? nameOf(r) : String(id));
  return (
    <>
      <h2>Engine</h2>
      <p className="muted">Rust, compiled to wasm, running in this tab. Rows are pulled from your org and analysed here; nothing goes back up. Duplicate search spreads over every core; capped at 100,000 rows per run.</p>
      <div className="row">
        <button type="button" className="primary" disabled={!!busy} onClick={() => run("dedupe")}><Icon name="users" /> Find duplicates</button>
        <button type="button" disabled={!!busy} onClick={() => run("forecast")}><Icon name="chart-column" /> Forecast pipeline</button>
        <button type="button" disabled={!!busy} onClick={() => run("stale")}><Icon name="activity" /> Stale deals, 30 d</button>
        {busy && <span className="muted">Running {busy}…</span>}
      </div>
      {msg && <p className="err">{msg}</p>}
      {out && res && (
        <div className="card">
          <h3>{res.kind === "dedupe" ? `${res.pairs.length.toLocaleString()} likely duplicate pairs` : res.kind === "stale" ? `${res.deals.length.toLocaleString()} open deals idle over ${res.days} days` : "Pipeline forecast"}</h3>
          <p className="muted num">{out.rows.toLocaleString()} rows in · {out.load} ms to fetch · {out.ms} ms in the engine</p>
          {res.kind === "dedupe" && (res.pairs.length ? <div className="table"><table>
            <thead><tr><th>Contact</th><th>Looks like</th><th>Match</th><th>Why</th></tr></thead>
            <tbody>{res.pairs.slice(0, 500).map((p) => (
              <tr key={`${p.a}-${p.b}`}>
                <td>{link("contacts", p.a, res.people, label(res.people.get(String(p.a)), p.a))}<br /><span className="muted">{res.people.get(String(p.a))?.email}</span></td>
                <td>{link("contacts", p.b, res.people, label(res.people.get(String(p.b)), p.b))}<br /><span className="muted">{res.people.get(String(p.b))?.email}</span></td>
                <td className="num">{Math.round(p.score * 100)}%</td><td>{(p.why ?? []).join(", ")}</td>
              </tr>))}</tbody></table></div> : <div className="empty">No duplicates found.</div>)}
          {res.kind === "stale" && (res.deals.length ? <div className="table"><table>
            <thead><tr><th>Deal</th><th>Stage</th><th>Amount</th><th>Last touch</th><th>Days idle</th></tr></thead>
            <tbody>{res.deals.slice(0, 500).map((d) => (
              <tr key={d.id}><td>{link("deals", d.id, res.rows, d.name || String(d.id))}</td><td><Stage v={d.stage} /></td><td className="num">{money(d.amount_cents, res.rows.get(String(d.id))?.currency || "USD")}</td>
                <td>{d.last_touch_at ? when(d.last_touch_at) : "never"}</td><td className="num">{d.days_idle == null ? "" : Math.round(d.days_idle)}</td></tr>))}</tbody></table></div> : <div className="empty">Nothing stale.</div>)}
          {res.kind === "forecast" && <>
            <div className="table"><table><thead><tr><th>Stage</th><th>Weight</th><th>Deals</th><th>Amount</th><th>Weighted</th></tr></thead>
              <tbody>{res.f.stages.map((s: any) => <tr key={s.stage}><td><Stage v={s.stage} /></td><td className="num">{Math.round(s.weight * 100)}%</td><td className="num">{s.count}</td><td className="num">{money(s.amount_cents)}</td><td className="num">{money(s.weighted_cents)}</td></tr>)}</tbody></table></div>
            <div className="table"><table><thead><tr><th>Close month</th><th>Deals</th><th>Amount</th><th>Weighted</th></tr></thead>
              <tbody>{res.f.months.map((m: any) => <tr key={m.month}><td>{m.month}</td><td className="num">{m.count}</td><td className="num">{money(m.amount_cents)}</td><td className="num">{money(m.weighted_cents)}</td></tr>)}
                <tr><td>No close date</td><td></td><td className="num">{money(res.f.unscheduled_cents)}</td><td className="num">{money(res.f.unscheduled_weighted_cents)}</td></tr></tbody></table></div>
            <p><b>Total weighted: {money(res.f.total_weighted_cents)}</b></p>
          </>}
        </div>
      )}
      {edit && <Sheet org={org} entity={edit.entity} row={edit.row} onClose={() => setEdit(null)}
        onSave={async (data) => { await api(`/orgs/${org}/${edit.entity}/${edit.row.id}`, { method: "PUT", body: JSON.stringify(data) }); setEdit(null); }}
        onDelete={can("manager") ? async () => { await api(`/orgs/${org}/${edit.entity}/${edit.row.id}`, { method: "DELETE" }); setEdit(null); } : undefined}
        canEdit={can("employee")} />}
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
          <div className="row actions">
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
  const [auditNext, setAuditNext] = useState<string | null>(null);
  const [auditActor, setAuditActor] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditSince, setAuditSince] = useState("");
  const [fresh, setFresh] = useState("");
  const [msg, setMsg] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [hookPick, setHookPick] = useState<string[]>([]);
  const [hookUrl, setHookUrl] = useState("");
  const [hookErr, setHookErr] = useState("");
  const [inviteErr, setInviteErr] = useState("");
  const [seeding, setSeeding] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);
  const [withDeleted, setWithDeleted] = useState(false);
  /** Webhook id → its deliveries, once its list is opened. */
  const [sent, setSent] = useState<Record<string, Row[]>>({});
  const base = `/orgs/${org.id}`;
  const refresh = useCallback(() => {
    api(`${base}/members`).then((r) => setMembers(rowsOf(r))).catch(() => {});
    if (can("owner")) { api(`${base}/webhooks`).then((r) => { setHooks(r.webhooks ?? rowsOf(r)); if (Array.isArray(r.events)) { setHookEvents(r.events); setHookPick((p) => (p.length ? p : r.events)); } }).catch(() => {}); api(`${base}/keys`).then((r) => setKeys(rowsOf(r))).catch(() => {}); }
  }, [base, can]);
  useEffect(refresh, [refresh]);
  const loadSent = (id: string) => api(`${base}/webhooks/${id}/deliveries`).then((r) => setSent((m) => ({ ...m, [id]: rowsOf(r) })));
  const loadAudit = useCallback((cursor?: string) => {
    const q = new URLSearchParams({ limit: "50" });
    if (auditActor.trim()) q.set("actor", auditActor.trim());
    if (auditAction) q.set("action", auditAction);
    if (auditSince) q.set("since", auditSince);
    if (cursor) q.set("cursor", cursor);
    api(`${base}/audit?${q}`).then((r) => { setAudit((a) => (cursor ? [...a, ...rowsOf(r)] : rowsOf(r))); setAuditNext(nextOf(r)); }).catch(() => {});
  }, [base, auditActor, auditAction, auditSince]);
  useEffect(() => { if (can("manager")) loadAudit(); }, [can, loadAudit, hooks, keys, members]);
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
        {can("manager") && <form className="row" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); setInviteErr(""); api(`${base}/members`, { method: "POST", body: JSON.stringify({ email: f.get("email"), role: f.get("role") }) }).then(() => { form.reset(); refresh(); }).catch((x) => setInviteErr((x as Error).message)); }}>
          <input name="email" type="email" placeholder="colleague@company.com" required className="grow" aria-describedby="invite-note" />
          <select name="role" defaultValue="seasonal">{ROLES.map((r) => <option key={r} disabled={!can(r === "admin" || r === "owner" ? "admin" : r === "manager" ? "owner" : "manager")}>{r}</option>)}</select>
          <button className="primary" type="submit"><Icon name="plus" /> Invite</button>
        </form>}
        {can("manager") && <p id="invite-note" className={inviteErr ? "err" : "muted"}>{inviteErr || "They need a qCRM account first: ask them to sign up, then invite the email they used."}</p>}
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
        <div className="list">{hooks.map((h) => <div key={h.id}>
          <div className="row"><span className="grow mono">{h.url}</span><span className="pill" title={Array.isArray(h.events) ? h.events.join(", ") : undefined}>{Array.isArray(h.events) ? `${h.events.length} event${h.events.length === 1 ? "" : "s"}` : String(h.events ?? "*")}</span>
            <button type="button" title="Deliveries" aria-label="Deliveries" aria-expanded={!!sent[h.id]} onClick={() => (sent[h.id] ? setSent(({ [h.id]: _, ...rest }) => rest) : void loadSent(h.id))}><Icon name="chevron-down" /></button>
            <button type="button" title="Remove webhook" aria-label="Remove webhook" onClick={() => act(() => api(`${base}/webhooks/${h.id}`, { method: "DELETE" }))}><Icon name="x" /></button></div>
          {sent[h.id] && (sent[h.id]!.length ? <div className="table"><table><thead><tr><th>Event</th><th>Status</th><th>Code</th><th>Tries</th><th>When</th><th /></tr></thead><tbody>{sent[h.id]!.map((d) => <tr key={d.id}>
            <td className="mono">{d.event}</td><td><span className="pill">{d.status}</span></td><td>{d.last_code || ""}</td><td>{d.attempts}</td><td>{whenAt(d.created_at)}</td>
            <td><button type="button" title={d.status === "pending" ? "Waiting for its next try" : "Send again"} aria-label="Replay" disabled={d.status === "pending"} onClick={() => act(async () => { await api(`${base}/webhooks/${h.id}/deliveries/${d.id}/replay`, { method: "POST", body: "{}" }); await loadSent(h.id); })}><Icon name="rotate-ccw" /></button></td>
          </tr>)}</tbody></table></div> : <p className="muted">No deliveries yet.</p>)}
        </div>)}</div>
        <form onSubmit={async (e) => { e.preventDefault(); setHookErr(""); if (!hookPick.length) { setHookErr("Pick at least one event."); return; } try { await api(`${base}/webhooks`, { method: "POST", body: JSON.stringify({ url: hookUrl, events: hookPick }) }); setHookUrl(""); refresh(); } catch (er) { setHookErr((er as Error).message); } }}>
          <div className="row">
            <input name="url" type="url" placeholder="https://example.com/hooks/qcrm" required className="grow" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} /><button className="primary" type="submit"><Icon name="plus" /> Add</button>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {hookEvents.map((ev) => <label key={ev} className="mono"><input type="checkbox" checked={hookPick.includes(ev)} onChange={(e) => setHookPick((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))} /> {ev}</label>)}
          </div>
          {hookErr && <p className="err">{hookErr}</p>}
        </form>
        <p className="muted">Each delivery carries x-qcrm-signature (HMAC-SHA256 of the body with the webhook's secret), retried with backoff for a day.</p>
      </div>}
      <div className="card">
        <h3><Icon name="monitor" /> Look and feel</h3>
        <div className="row"><button type="button" onClick={() => theme("light")}>Cream</button><button type="button" onClick={() => theme("dark")}>Blackest black</button><button type="button" onClick={() => theme("auto")}>Follow system</button></div>
      </div>
      {can("manager") && (audit.length > 0 || auditActor || auditAction || auditSince) && <div className="card">
        <h3><Icon name="scroll-text" /> Audit log</h3>
        <div className="row">
          <input value={auditActor} onChange={(e) => setAuditActor(e.target.value)} placeholder="Who (email)" aria-label="Filter by who" />
          <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)} aria-label="Filter by action"><option value="">Any action</option>{["member", "key", "webhook", "export", "seed"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <input type="date" value={auditSince} onChange={(e) => setAuditSince(e.target.value)} aria-label="Since" />
        </div>
        <div className="table"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead><tbody>{audit.map((a) => <tr key={a.id}><td>{whenAt(a.at)}</td><td>{a.actor_name ?? a.actor_email ?? a.actor_user_id ?? "system"}{a.actor_name && <span className="muted"> {a.actor_email}</span>}</td><td>{a.action}</td><td>{a.target_name ?? a.target}{a.target_type && <span className="muted"> {a.target_type}</span>}</td></tr>)}</tbody></table></div>
        {auditNext && <button type="button" onClick={() => loadAudit(auditNext)}>Load more</button>}
      </div>}
      <div className="card">
        <h3><Icon name="download" /> Your data</h3>
        <div className="row">
          {can("owner") && <a className="btn" href={`/api${base}/export${withDeleted ? "?deleted=1" : ""}`} download={`qcrm-${org.id}${withDeleted ? "-with-deleted" : ""}.json`}><Icon name="download" /> Export {withDeleted ? "every row, deleted too" : "every row"}</a>}
          {can("owner") && <label className="mono" title="Rows you deleted stay in the database for sync; leave them out of the download unless you ask"><input type="checkbox" checked={withDeleted} onChange={(e) => setWithDeleted(e.target.checked)} /> include deleted rows</label>}
          {can("owner") && !seeding && <button type="button" onClick={() => setSeeding("1000")}><Icon name="flask-conical" /> Seed sample data</button>}
          {can("owner") && seeding && <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Math.floor(Number(seeding)); if (!(n > 0 && n <= 100000)) { setMsg("Seed between 1 and 100,000 contacts."); return; } act(async () => { setSeedBusy(true); try { await api(`${base}/seed`, { method: "POST", body: JSON.stringify({ n }) }); await reload(); setMsg(`Seeded ${n.toLocaleString()} contacts. Open Contacts to see them.`); setSeeding(""); } finally { setSeedBusy(false); } }); }}>
            <input type="number" min={1} max={100000} aria-label="How many contacts (up to 100,000)" value={seeding} onChange={(e) => setSeeding(e.target.value)} disabled={seedBusy} autoFocus />
            <button type="submit" disabled={seedBusy}><Icon name="flask-conical" /> {seedBusy ? "Seeding..." : "Seed"}</button>
            <button type="button" disabled={seedBusy} onClick={() => setSeeding("")}>Cancel</button>
          </form>}
          <span className="grow" />
          <button type="button" style={{ color: "var(--bad)" }} onClick={() => { const c = prompt(`Delete your account, the orgs you own and all their rows? Type your email to confirm.`); if (c) act(() => api(`/me?confirm=${encodeURIComponent(c)}`, { method: "DELETE" }).then(() => { location.href = "/"; })); }}>Delete my account</button>
        </div>
      </div>
    </>
  );
}
