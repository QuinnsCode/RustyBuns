// The page: apps down the side, the five lanes across the top, jobs in the middle with a ticking countdown,
// the latest runs (and so every reminder) on the right. The editor previews the next runs with the same
// engine the server ticks with, so what it shows is what will happen.
import { esc } from "@rustybuns/util";
import { Bad } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import { createElement, AlarmClock, Bell, Check, Cloud, Pause, Pencil, Play, Plus, Search, Webhook, X, CircleAlert, type IconNode } from "lucide";
import { FLOWS, describe, flow, upcoming, type Cadence, type Flow } from "./bacron.ts";
import { Job, JobInput, JobsReply, Refusal, type Run } from "./api.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (node: IconNode, size = 16) => createElement(node, { width: size, height: size, "stroke-width": 2, "aria-hidden": "true" }).outerHTML;

// ---- token ----

const TOKEN_KEY = "cron-swanson-token";
let token = "";
try { token = localStorage.getItem(TOKEN_KEY) ?? ""; } catch { /* private window */ }
const auth = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

// ---- state ----

type Row = JobsReply["jobs"][number];
const state = { rows: [] as Row[], runs: [] as Run[], skew: 0, app: null as string | null, lane: "all" as Flow | "all", tag: null as string | null, q: "" };
const serverNow = () => Date.now() + state.skew;

const LANE_LABEL: Record<Flow | "all", string> = { all: "All", async: "Async", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

async function load() {
  const res = await fetch("/api/jobs", { headers: auth() }).catch(() => null);
  if (!res) return;
  $("gate").hidden = res.status !== 401;
  if (!res.ok) return;
  const data = await readJson(res, JobsReply);
  if (!data) return;
  state.rows = data.jobs;
  state.runs = data.runs;
  state.skew = data.now - Date.now();
  render();
}

// ---- filters ----

const matches = (r: Row, o: { app?: boolean; lane?: boolean } = {}) => {
  const j = r.job, q = state.q.trim().toLowerCase();
  if (o.app !== false && state.app && j.app !== state.app) return false;
  if (o.lane !== false && state.lane !== "all" && flow(j.cadence) !== state.lane) return false;
  if (state.tag && !j.tags.includes(state.tag)) return false;
  return !q || [j.name, j.app, j.note, j.why, describe(j.cadence), ...j.tags].some((s) => s.toLowerCase().includes(q));
};

const count = <T>(list: T[], key: (t: T) => string) => list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>());

// ---- time words ----

const clock = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pad = (n: number) => String(n).padStart(2, "0");

function until(at: number): string {
  const s = Math.round((at - serverNow()) / 1000);
  if (s <= 0) return "due";
  if (s < 3600) return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} m`;
  return `${Math.floor(s / 86_400)} d ${pad(Math.floor((s % 86_400) / 3600))} h`;
}

function drift(r: Run): string {
  if (r.manual) return "by hand";
  const s = (r.firedAt - r.scheduledAt) / 1000;
  return s < 60 ? `+${s.toFixed(1)} s` : `+${Math.round(s / 60)} min late`;
}

const STATUS_ICON: Record<Run["status"], IconNode> = { ok: Check, failed: CircleAlert, reminded: Bell };

// ---- render ----

function render() {
  const all = state.rows;
  const apps = [...count(all, (r) => r.job.app)].sort(([a], [b]) => a.localeCompare(b));
  $("apps").innerHTML = [[null, all.length] as const, ...apps].map(([app, n]) =>
    `<button type="button" data-app="${esc(app ?? "")}" class="${state.app === app ? "on" : ""}"><span>${esc(app ?? "All apps")}</span><em>${n}</em></button>`).join("");
  $("app-list").innerHTML = apps.map(([a]) => `<option value="${esc(a)}">`).join("");

  const tags = [...count(all.flatMap((r) => r.job.tags), (t) => t)].sort(([a], [b]) => a.localeCompare(b));
  $("tags").innerHTML = tags.length ? tags.map(([t, n]) => `<button type="button" data-tag="${esc(t)}" class="chip ${state.tag === t ? "on" : ""}">#${esc(t)} <em>${n}</em></button>`).join("") : `<p class="quiet">No tags yet</p>`;

  const lanes = count(all.filter((r) => matches(r, { lane: false })), (r) => flow(r.job.cadence));
  const inView = all.filter((r) => matches(r, { lane: false })).length;
  $("flows").innerHTML = (["all", ...FLOWS] as const).map((f) =>
    `<button type="button" data-lane="${f}" class="lane lane-${f} ${state.lane === f ? "on" : ""}"><i></i>${LANE_LABEL[f]}<em>${f === "all" ? inView : lanes.get(f) ?? 0}</em></button>`).join("");

  const shown = all.filter((r) => matches(r)).sort((a, b) => (a.job.nextAt ?? Infinity) - (b.job.nextAt ?? Infinity));
  const groups = state.app ? [[state.app, shown] as const] : [...Map.groupBy(shown, (r) => r.job.app)].sort(([a], [b]) => a.localeCompare(b));
  $("list").innerHTML = shown.length
    ? groups.map(([app, rows]) => `${state.app ? "" : `<h2 class="group">${esc(app)}<em>${rows.length}</em></h2>`}<ul class="jobs">${rows.map(jobRow).join("")}</ul>`).join("")
    : `<div class="empty">${icon(AlarmClock, 28)}<p>${all.length ? "Nothing matches." : "No jobs yet. Make one with New."}</p></div>`;

  const names = new Map(all.map((r) => [r.job.id, r.job]));
  $("runs").innerHTML = state.runs.length ? state.runs.slice(0, 60).map((r) => {
    const j = names.get(r.jobId);
    return `<li class="run run-${r.status}" title="${esc(r.error || (r.code ? `HTTP ${r.code}` : r.status))}">${icon(STATUS_ICON[r.status], 14)}
      <span class="what"><b>${esc(j?.name ?? "deleted job")}</b><small>${esc(j?.app ?? "")} · ${clock(r.firedAt)}</small></span><span class="num">${drift(r)}</span></li>`;
  }).join("") : `<li class="quiet">Nothing has run yet.</li>`;
  tickClocks();
}

function kindIcon(j: Job): string {
  const a = j.action;
  if (a.kind === "webhook") return `<span class="kind" title="Calls ${esc(a.url)}">${icon(Webhook, 14)}</span>`;
  if (a.kind === "elsewhere") return `<span class="kind" title="Run by ${esc(a.by)}; listed here so it sits in its lane">${icon(Cloud, 14)}</span>`;
  return `<span class="kind" title="Reminder">${icon(Bell, 14)}</span>`;
}

function jobRow({ job: j, last }: Row): string {
  const lane = flow(j.cadence);
  return `<li class="job ${j.enabled ? "" : "paused"}" data-id="${esc(j.id)}">
    <i class="dot lane-${lane}" title="${LANE_LABEL[lane]}"></i>
    <div class="body">
      <div class="top"><b>${esc(j.name)}</b><span class="cad">${esc(describe(j.cadence))}</span>${kindIcon(j)}</div>
      <div class="sub">${j.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}${j.why ? `<span class="why">${esc(j.why)}</span>` : ""}</div>
    </div>
    <div class="when">
      ${j.nextAt === null ? `<span class="quiet">${j.enabled ? "done" : "paused"}</span>` : `<time class="num" data-at="${j.nextAt}" title="${esc(clock(j.nextAt))}"></time>`}
      ${last ? `<small class="last run-${last.status}" title="${esc(last.error || clock(last.firedAt))}">${icon(STATUS_ICON[last.status], 12)} ${drift(last)}</small>` : `<small class="quiet">never run</small>`}
    </div>
    <div class="acts">
      ${j.action.kind === "elsewhere" ? "" : `<button type="button" class="ghost" data-act="run" title="Run now">${icon(Play)}</button>`}
      <button type="button" class="ghost" data-act="toggle" title="${j.enabled ? "Pause" : "Resume"}">${icon(j.enabled ? Pause : AlarmClock)}</button>
      <button type="button" class="ghost" data-act="edit" title="Edit">${icon(Pencil)}</button>
    </div>
  </li>`;
}

function tickClocks() {
  for (const el of document.querySelectorAll<HTMLElement>("time[data-at]")) el.textContent = until(Number(el.dataset.at));
}

// ---- actions ----

async function send(method: string, path: string, body?: unknown): Promise<string | null> {
  const res = await fetch(path, { method, headers: { ...auth(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!res) return "Can't reach the server.";
  if (res.status === 401) { $("gate").hidden = false; return "Token needed."; }
  if (!res.ok) return (await readJson(res, Refusal))?.error ?? `HTTP ${res.status}`;
  await load();
  return null;
}

const toInput = (j: Job): JobInput => ({ app: j.app, name: j.name, note: j.note, why: j.why, tags: j.tags, cadence: j.cadence, tz: j.tz, action: j.action, enabled: j.enabled });

document.body.addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("button") : null;
  if (!el) return;
  if (el.dataset.app !== undefined) { state.app = el.dataset.app || null; render(); }
  else if (el.dataset.tag !== undefined) { state.tag = state.tag === el.dataset.tag ? null : el.dataset.tag; render(); }
  else if (el.dataset.lane) { state.lane = el.dataset.lane as Flow | "all"; render(); }
  else if (el.dataset.act) {
    const id = el.closest<HTMLElement>(".job")?.dataset.id, row = state.rows.find((r) => r.job.id === id);
    if (!row) return;
    if (el.dataset.act === "run") void send("POST", `/api/jobs/${row.job.id}/run`);
    if (el.dataset.act === "toggle") void send("PUT", `/api/jobs/${row.job.id}`, { ...toInput(row.job), enabled: !row.job.enabled });
    if (el.dataset.act === "edit") openEditor(row.job);
  }
});

$<HTMLInputElement>("q").addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; render(); });
$<HTMLFormElement>("gate").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $<HTMLInputElement>("token").value.trim();
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* kept for this visit only */ }
  void load();
});

// ---- editor ----

const KINDS: [Cadence["kind"], string][] = [["once", "Once"], ["every", "Every"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"], ["cron", "Cron"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const form = $<HTMLFormElement>("form"), dialog = $<HTMLDialogElement>("editor");
const field = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement = HTMLInputElement>(name: string) => form.elements.namedItem(name) as T;
let editing: Job | null = null, kind: Cadence["kind"] = "daily", act: "remind" | "webhook" = "remind";

$("kinds").innerHTML = KINDS.map(([k, label]) => `<button type="button" data-kind="${k}">${label}</button>`).join("");
$("actions").innerHTML = `<button type="button" data-action="remind">${icon(Bell, 14)} Reminder</button><button type="button" data-action="webhook">${icon(Webhook, 14)} Call a URL</button>`;
$("days").innerHTML = DAYS.map((d, i) => `<label class="day"><input type="checkbox" name="day" value="${i}" ${i >= 1 && i <= 5 ? "checked" : ""}/><span>${d}</span></label>`).join("");
$("mday").innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("") + `<option value="-1">Last day</option>`;
$("month").innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
$("tz-list").innerHTML = Intl.supportedValuesOf("timeZone").map((z) => `<option value="${z}">`).join("");
$("new").innerHTML = `${icon(Plus)} New`;
$("close").innerHTML = icon(X);
$("search-icon").innerHTML = icon(Search);
$("logo").innerHTML = icon(AlarmClock, 22);

function setKind(k: Cadence["kind"]) {
  kind = k;
  for (const b of $("kinds").querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.kind === k);
  for (const w of form.querySelectorAll<HTMLElement>(".when")) w.hidden = !(w.dataset.kind ?? "").split(" ").includes(k);
  preview();
}

function setAction(a: "remind" | "webhook") {
  act = a;
  for (const b of $("actions").querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.action === a);
  $("hook").hidden = a !== "webhook";
}

/** The form's cadence, as the engine takes it (unchecked: the guard says what's wrong). */
function cadence(): unknown {
  const time = field("time").value;
  switch (kind) {
    case "once": return { kind, at: field("at").value };
    case "every": return { kind, minutes: Number(field("every").value) * Number(field<HTMLSelectElement>("unit").value) };
    case "daily": return { kind, time };
    case "weekly": return { kind, time, days: [...form.querySelectorAll<HTMLInputElement>("input[name=day]:checked")].map((c) => Number(c.value)) };
    case "monthly": return { kind, time, day: Number(field<HTMLSelectElement>("mday").value) };
    case "yearly": return { kind, time, month: Number(field<HTMLSelectElement>("month").value), day: Number(field("yday").value) };
    case "cron": return { kind, expr: field("expr").value };
  }
}

function input(): unknown {
  return {
    app: field("app").value.trim(), name: field("name").value.trim(), why: field("why").value.trim(), note: field<HTMLTextAreaElement>("note").value,
    tags: field("tags").value.split(",").map((t) => t.trim()).filter(Boolean), cadence: cadence(), tz: field("tz").value.trim(),
    action: editing?.action.kind === "elsewhere" ? editing.action : act === "webhook" ? { kind: "webhook", url: field("url").value.trim(), method: field<HTMLSelectElement>("method").value } : { kind: "remind" },
    enabled: field("enabled").checked,
  };
}

function preview() {
  const out = $("preview");
  try {
    const raw = input();
    const c = JobInput({ ...(raw as object), app: "x", name: "x" });
    const runs = upcoming(c.cadence, serverNow(), c.tz, 3, editing?.anchor ?? serverNow());
    out.className = `preview lane-${flow(c.cadence)}`;
    out.innerHTML = `<i></i><b>${LANE_LABEL[flow(c.cadence)]}</b> ${esc(describe(c.cadence))}<br><span>${runs.length ? `Next: ${runs.map(clock).join(" · ")}` : "Never runs again"}</span>`;
  } catch (e) {
    out.className = "preview";
    out.textContent = e instanceof Bad ? e.message : String(e);
  }
}

function openEditor(j: Job | null) {
  editing = j;
  form.reset();
  $("error").textContent = "";
  $("editor-title").textContent = j ? "Edit job" : "New job";
  $("delete").hidden = !j;
  field("tz").value = j?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  field("app").value = j?.app ?? state.app ?? "";
  if (j) {
    field("name").value = j.name;
    field("why").value = j.why;
    field<HTMLTextAreaElement>("note").value = j.note;
    field("tags").value = j.tags.join(", ");
    field("enabled").checked = j.enabled;
    const c = j.cadence;
    if ("time" in c) field("time").value = c.time;
    if (c.kind === "once") field("at").value = c.at;
    if (c.kind === "every") {
      const unit = c.minutes % 1440 === 0 ? 1440 : c.minutes % 60 === 0 ? 60 : 1;
      field<HTMLSelectElement>("unit").value = String(unit);
      field("every").value = String(c.minutes / unit);
    }
    if (c.kind === "weekly") for (const box of form.querySelectorAll<HTMLInputElement>("input[name=day]")) box.checked = c.days.includes(Number(box.value));
    if (c.kind === "monthly") field<HTMLSelectElement>("mday").value = String(c.day);
    if (c.kind === "yearly") { field<HTMLSelectElement>("month").value = String(c.month); field("yday").value = String(c.day); }
    if (c.kind === "cron") field("expr").value = c.expr;
    if (j.action.kind === "webhook") { field("url").value = j.action.url; field<HTMLSelectElement>("method").value = j.action.method; }
  } else {
    const d = new Date(serverNow() + 3_600_000);
    field("at").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  }
  // A job something else runs (a Cloudflare cron) keeps that: no reminder-or-URL choice to make.
  const elsewhere = j?.action.kind === "elsewhere";
  $("actions").hidden = elsewhere;
  setAction(!j || j.action.kind === "elsewhere" ? "remind" : j.action.kind);
  if (elsewhere) $("hook").hidden = true;
  setKind(j?.cadence.kind ?? (state.lane === "all" || state.lane === "async" ? "daily" : state.lane));
  dialog.showModal();
}

$("kinds").addEventListener("click", (e) => { const k = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.kind; if (k) setKind(k as Cadence["kind"]); });
$("actions").addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.action; if (a === "remind" || a === "webhook") setAction(a); });
form.addEventListener("input", preview);
$("new").addEventListener("click", () => openEditor(null));
$("cancel").addEventListener("click", () => dialog.close());
$("close").addEventListener("click", () => dialog.close());
$("delete").addEventListener("click", async () => {
  if (!editing) return;
  const err = await send("DELETE", `/api/jobs/${editing.id}`);
  if (err) $("error").textContent = err; else dialog.close();
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let body: JobInput;
  try { body = JobInput(input()); } catch (err) { $("error").textContent = err instanceof Bad ? err.message : String(err); return; }
  const err = await send(editing ? "PUT" : "POST", editing ? `/api/jobs/${editing.id}` : "/api/jobs", body);
  if (err) $("error").textContent = err; else dialog.close();
});

// ---- go ----

void load();
setInterval(tickClocks, 1000);
// Just after each minute the ticker fires; fetch then so new runs and countdowns show without waiting.
const refresh = () => setTimeout(() => { void load(); refresh(); }, 60_000 - (serverNow() % 60_000) + 2_000);
refresh();
