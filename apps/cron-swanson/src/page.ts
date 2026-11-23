// The page: clouds up top with the big add (what, when, how often), then the roll (the coming alarms as glowing
// notes a playhead sweeps across, an 808 on each), then every alarm in a list you can sort. Reminders that fired
// stack up as toasts on the right until they're ticked off or snoozed. A pixel yule log burns at the bottom.
// The editor previews the next runs with the same engine the server ticks with, so what it shows is what will happen.
import { esc } from "@rustybuns/util";
import { Bad } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { eqosys } from "@rustybuns/util/eqosys";
import { LiveMsg, PROTOCOL } from "./live.ts";
import { createElement, AlarmClock, AlarmClockPlus, Bell, BellOff, BellRing, Check, Cloud, LogIn, Monitor, Moon, Sun, Volume2, VolumeX, AlarmClockOff, Pause, Pencil, Play, Search, Webhook, X, CircleAlert, type IconNode } from "lucide";
import { FLOWS, describe, flow, upcoming, type Cadence, type Flow } from "./bacron.ts";
import { boom, alarm } from "./boom.ts";
import { roll, tracks, type Lane } from "./roll.ts";
import { yule } from "./yule.ts";
import { FURTHEST_MS, OFTEN, cadenceFor, isOften, local, needsTime, quickTimes, type Often } from "./quick.ts";
import { APP, EQOSYS, Job, JobInput, JobsReply, NOT_OWNER, Refusal, SIGN_IN, type Run } from "./api.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (node: IconNode, size = 16) => createElement(node, { width: size, height: size, "stroke-width": 2, "aria-hidden": "true" }).outerHTML;

// ---- sign-in ----

// The page signs in through eqosys and sends its token; the server lets in only the owner's account. A local eqosys
// stands in with the `cron-swanson.eqosys` setting in localStorage (its URL).
const eq = eqosys({ app: APP, url: EQOSYS, from: [location.origin], prefix: "cron-swanson" });
const auth = (): Record<string, string> => { const l = eq.login(); return l ? { authorization: `Bearer ${l.token}` } : {}; };

/** The bar that asks for a sign-in: nobody yet, or someone who isn't the owner (switch accounts). */
function gate(why: string | null, note = "") {
  const el = $("gate");
  el.hidden = why === null;
  if (why === null) return;
  const l = eq.login();
  const say = note || (why === NOT_OWNER && l ? `Signed in as ${l.name || l.email}, but this Cron Swanson is someone else's.` : "Sign in to see your jobs.");
  el.innerHTML = `<span>${esc(say)}</span><button class="primary" type="button" id="sign-in">${icon(LogIn)} ${l && why === NOT_OWNER ? "Switch account" : "Sign in with eqosys"}</button>`;
}
const why401 = async (res: Response) => (await readJson(res, Refusal))?.error ?? SIGN_IN;

// ---- state ----

type Row = JobsReply["jobs"][number];
const state = { rows: [] as Row[], runs: [] as Run[], skew: 0, app: null as string | null, lane: "all" as Flow | "all", tag: null as string | null, q: "", sort: "next" as Sort };
const serverNow = () => Date.now() + state.skew;

// ---- sorts ----

// Next up keeps the apps as groups; every other order is one list, so the top of it is the answer.
const SORTS = { next: "Next up", interval: "Shortest interval", done: "Done most", fired: "Fired most", ignored: "Ignored most", idle: "Idle longest" } as const;
type Sort = keyof typeof SORTS;
const isSort = (v: unknown): v is Sort => typeof v === "string" && Object.hasOwn(SORTS, v);
const SORT_KEY = "cron-swanson-sort";
try { const v = localStorage.getItem(SORT_KEY); if (isSort(v)) state.sort = v; } catch { /* private window */ }

/** How far apart its next two runs are (a one-off sorts last). */
function period(j: Job): number {
  const [a, b] = upcoming(j.cadence, serverNow(), j.tz, 2, j.anchor);
  return a !== undefined && b !== undefined ? b - a : Infinity;
}

/** When it last earned its keep: ticked off, else fired, else made. Idle longest is the oldest of these. */
const lastUsed = (r: Row) => r.stats.lastDoneAt ?? r.stats.lastFiredAt ?? r.job.createdAt;

const nextAt = (r: Row) => r.job.nextAt ?? Infinity;
const ORDER: Record<Sort, (a: Row, b: Row) => number> = {
  next: (a, b) => nextAt(a) - nextAt(b),
  interval: (a, b) => period(a.job) - period(b.job) || nextAt(a) - nextAt(b),
  done: (a, b) => b.stats.done - a.stats.done || nextAt(a) - nextAt(b),
  fired: (a, b) => b.stats.fired - a.stats.fired || nextAt(a) - nextAt(b),
  ignored: (a, b) => b.stats.ignored - a.stats.ignored || nextAt(a) - nextAt(b),
  idle: (a, b) => lastUsed(a) - lastUsed(b),
};

// ---- desktop alerts ----

// ---- toasts ----

// A reminder that fired and isn't ticked off or snoozed sits in the stack on the right: the newest one per alarm,
// from the last day. Each one that joins the stack (a new firing, or a snooze running out) booms, and pops up as a
// system notification when desktop alerts are on. The first load only marks what's already there.
let shown: Set<number> | null = null;
const canAlert = () => "Notification" in window && Notification.permission === "granted";
const DAY = 86_400_000;

function open(): Run[] {
  const now = serverNow(), newest = new Map<string, Run>();
  for (const r of state.runs) if (!newest.has(r.jobId)) newest.set(r.jobId, r);
  return [...newest.values()].filter((r) => r.status === "reminded" && r.doneAt === null && (r.snoozedUntil === null || r.snoozedUntil <= now) && r.firedAt > now - DAY);
}

function renderToasts() {
  const now = open(), names = new Map(state.rows.map((r) => [r.job.id, r.job]));
  const fresh = shown ? now.filter((r) => !shown!.has(r.id)) : [];
  shown = new Set(now.map((r) => r.id));
  if (fresh.length && loud) alarm();
  if (canAlert()) for (const r of fresh) {
    const j = names.get(r.jobId);
    if (!j) continue;
    const n = new Notification(`${j.app}: ${j.name}`, { body: j.why || j.note || describe(j.cadence), tag: `cron-swanson-${r.id}` });
    n.onclick = () => { window.focus(); n.close(); };
  }
  const key = now.map((r) => r.id).join(",");
  const box = $("toasts");
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = now.map((r) => {
    const j = names.get(r.jobId);
    if (!j) return "";
    return `<div class="toast card" style="--pick: var(--${flow(j.cadence)})" role="alertdialog" aria-label="${esc(j.name)}">
      <div class="toast-top"><i class="dot lane-${flow(j.cadence)}"></i><b>${esc(j.name)}</b></div>
      <small>${esc(j.why || describe(j.cadence))} · ${esc(clock(r.firedAt))}</small>
      <div class="toast-acts">
        <button type="button" class="ghost" data-snooze="${r.id}" data-min="10">${icon(AlarmClockOff, 14)} 10 min</button>
        <button type="button" class="ghost" data-snooze="${r.id}" data-min="60">1 hour</button>
        <button type="button" class="primary" data-done="${r.id}">${icon(Check, 14)} Done</button>
      </div>
    </div>`;
  }).join("");
}

// ---- sound and theme ----

const SOUND_KEY = "cron-swanson-sound", THEME_KEY = "cron-swanson-theme";
let loud = false;
try { loud = localStorage.getItem(SOUND_KEY) === "on"; } catch { /* private window */ }
const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
let theme: Theme = "system";
try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") theme = t; } catch { /* private window */ }

function paintToggles() {
  document.documentElement.dataset.theme = theme;
  $("theme").innerHTML = icon(theme === "light" ? Sun : theme === "dark" ? Moon : Monitor);
  $("theme").title = `Look: ${theme === "system" ? "follows the system" : theme}`;
  $("sound").innerHTML = icon(loud ? Volume2 : VolumeX);
  $("sound").title = loud ? "808s on" : "808s off";
  $("sound").classList.toggle("on", loud);
  painter.sound(loud);
}
function paintAlerts() {
  const el = $("alerts");
  if (!("Notification" in window)) { el.hidden = true; return; }
  const p = Notification.permission;
  el.innerHTML = icon(p === "granted" ? BellRing : BellOff);
  el.title = p === "granted" ? "Desktop alerts on" : p === "denied" ? "Desktop alerts blocked: allow notifications for this site" : "Turn on desktop alerts";
  el.classList.toggle("on", p === "granted");
}

const LANE_LABEL: Record<Flow | "all", string> = { all: "All", async: "Async", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

async function load() {
  const res = await fetch("/api/jobs", { headers: auth() }).catch(() => null);
  if (!res) return;
  if (res.status === 401) { gate(await why401(res)); return; }
  gate(null);
  if (!res.ok) return;
  const data = await readJson(res, JobsReply);
  if (!data) return;
  state.rows = data.jobs;
  state.runs = data.runs;
  state.skew = data.now - Date.now();
  render();
  // A new day's ticket: the socket opens again on it.
  if (data.live && (!link || data.ticket !== held)) { link?.close(); goLive(data.live, data.ticket); }
}

// ---- live ----

// With a relay, every page hears a nudge the moment a job changes or a run lands (on this device or another) and
// fetches again; the minute poll below only runs while that socket is down.
let link: Link<never> | null = null, held: string | null = null;
function goLive(url: string, ticket: string | null) {
  held = ticket;
  link = connectSocket<LiveMsg, never>(url, {
    protocols: ticket ? [PROTOCOL, ticket] : [PROTOCOL],
    decode: (v) => { try { return LiveMsg(v); } catch { return null; } },
    onMessage: () => { void load(); },
    // Catch up on whatever happened while it was down.
    onOpen: (tries) => { if (tries) void load(); },
    onClose: ({ tries }) => Math.min(60_000, 1_000 * 2 ** Math.min(tries, 6)),
  });
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
    `<button type="button" data-app="${esc(app ?? "")}" class="chip ${state.app === app ? "on" : ""}"><span>${esc(app ?? "All apps")}</span><em>${n}</em></button>`).join("");
  $("app-list").innerHTML = apps.map(([a]) => `<option value="${esc(a)}">`).join("");

  const tags = [...count(all.flatMap((r) => r.job.tags), (t) => t)].sort(([a], [b]) => a.localeCompare(b));
  $("tags").innerHTML = tags.length ? tags.map(([t, n]) => `<button type="button" data-tag="${esc(t)}" class="chip ${state.tag === t ? "on" : ""}">#${esc(t)} <em>${n}</em></button>`).join("") : "";

  const lanes = count(all.filter((r) => matches(r, { lane: false })), (r) => flow(r.job.cadence));
  const inView = all.filter((r) => matches(r, { lane: false })).length;
  $("flows").innerHTML = (["all", ...FLOWS] as const).map((f) =>
    `<button type="button" data-lane="${f}" class="lane lane-${f} ${state.lane === f ? "on" : ""}"><i></i>${LANE_LABEL[f]}<em>${f === "all" ? inView : lanes.get(f) ?? 0}</em></button>`).join("");

  const shown = all.filter((r) => matches(r)).sort(ORDER[state.sort]);
  const groups = state.app || state.sort !== "next" ? [[state.app ?? "", shown] as const] : [...Map.groupBy(shown, (r) => r.job.app)].sort(([a], [b]) => a.localeCompare(b));
  $("list").innerHTML = shown.length
    ? groups.map(([app, rows]) => `${state.app || state.sort !== "next" ? "" : `<h2 class="group">${esc(app)}<em>${rows.length}</em></h2>`}<ul class="jobs">${rows.map(jobRow).join("")}</ul>`).join("")
    : `<div class="empty">${icon(AlarmClock, 28)}<p>${all.length ? "Nothing matches." : "No jobs yet. Make one with New."}</p></div>`;

  renderRoll();
  renderToasts();
  tickClocks();
}

// ---- the roll ----

// One 808 pitch per lane, low to high: async, daily, weekly, monthly, yearly.
const HZ: Record<Flow, number> = { async: 41.2, daily: 49, weekly: 55, monthly: 65.4, yearly: 73.4 };
const SPANS = { "6h": ["6 h", 6 * 3_600_000], "1d": ["Day", DAY], "1w": ["Week", 7 * DAY], "1mo": ["Month", 31 * DAY], "3mo": ["3 months", FURTHEST_MS] } as const;
type Span = keyof typeof SPANS;
const SPAN_KEY = "cron-swanson-span";
let span: Span = "1d";
try { const v = localStorage.getItem(SPAN_KEY); if (v && Object.hasOwn(SPANS, v)) span = v as Span; } catch { /* private window */ }
const painter = roll($<HTMLCanvasElement>("roll"), (j) => openEditor(j), (lane) => boom(lane.hz, { len: 0.5, gain: 0.35 }));

function renderRoll() {
  $("spans").innerHTML = Object.entries(SPANS).map(([k, [label]]) => `<button type="button" class="chip ${span === k ? "on" : ""}" data-span="${k}">${label}</button>`).join("");
  const styles = getComputedStyle(document.documentElement), now = serverNow(), ms = SPANS[span][1];
  const lanes: Lane[] = state.rows.filter((r) => matches(r) && r.job.enabled && r.job.nextAt !== null && r.job.nextAt < now + ms)
    .sort((a, b) => FLOWS.indexOf(flow(a.job.cadence)) - FLOWS.indexOf(flow(b.job.cadence)) || nextAt(a) - nextAt(b))
    .map((r) => ({ job: r.job, color: styles.getPropertyValue(`--${flow(r.job.cadence)}`).trim(), hz: HZ[flow(r.job.cadence)] }));
  $("roll-empty").hidden = lanes.length > 0;
  $("roll").hidden = lanes.length === 0;
  painter.draw(tracks(lanes, now, ms), now, ms);
}

// ---- the big add ----

let often: Often = "once";
const whenBox = $<HTMLInputElement>("when");
function paintQuick() {
  const now = serverNow();
  whenBox.min = local(new Date(now));
  whenBox.max = local(new Date(now + FURTHEST_MS));
  $("when-chips").innerHTML = quickTimes(now).map((q) => `<button type="button" class="chip ${whenBox.value === local(q.at) ? "on" : ""}" data-when="${local(q.at)}">${q.label}</button>`).join("");
  $("often-chips").innerHTML = Object.entries(OFTEN).map(([k, label]) => `<button type="button" class="chip ${often === k ? "on" : ""}" data-often="${k}">${label}</button>`).join("");
  whenBox.disabled = !needsTime(often);
  $("quick").classList.toggle("no-time", !needsTime(often));
  const c = cadenceFor(often, new Date(whenBox.value), now);
  if (typeof c === "string") { $("quick-hint").textContent = needsTime(often) && !whenBox.value ? "" : c; return; }
  const next = upcoming(c, now, Intl.DateTimeFormat().resolvedOptions().timeZone, 2, now);
  $("quick-hint").textContent = next.length ? `${describe(c)} · first ${clock(next[0]!)}` : "";
}


function kindIcon(j: Job): string {
  const a = j.action;
  if (a.kind === "webhook") return `<span class="kind" title="Calls ${esc(a.url)}">${icon(Webhook, 14)}</span>`;
  if (a.kind === "elsewhere") return `<span class="kind" title="Run by ${esc(a.by)}; listed here so it sits in its lane">${icon(Cloud, 14)}</span>`;
  return `<span class="kind" title="Reminder">${icon(Bell, 14)}</span>`;
}

/** "3 d", "5 h", "12 min": how long ago, roughly. */
function ago(t: number): string {
  const m = Math.max(0, Math.round((serverNow() - t) / 60_000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/** Its track record in a few words: what it's done so far, and how long since it was last any use. */
function record(r: Row): string {
  const { fired, done, ignored } = r.stats;
  const bits = [fired && `${fired} fired`, done && `${done} done`, ignored && `<b class="ignored">${ignored} ignored</b>`].filter(Boolean);
  if (state.sort === "idle") bits.push(`idle ${ago(lastUsed(r))}`);
  return bits.length ? `<span class="record">${bits.join(" · ")}</span>` : "";
}

function jobRow(row: Row): string {
  const { job: j, last } = row, lane = flow(j.cadence);
  const owed = last?.status === "reminded" && last.doneAt === null;
  return `<li class="job ${j.enabled ? "" : "paused"}" data-id="${esc(j.id)}">
    <i class="dot lane-${lane}" title="${LANE_LABEL[lane]}"></i>
    <div class="body">
      <div class="top"><b>${esc(j.name)}</b><span class="cad">${esc(describe(j.cadence))}</span>${kindIcon(j)}</div>
      <div class="sub">${j.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}${j.why ? `<span class="why">${esc(j.why)}</span>` : ""}${record(row)}</div>
    </div>
    <div class="when">
      ${j.nextAt === null ? `<span class="quiet">${j.enabled ? "done" : "paused"}</span>` : `<time class="num" data-at="${j.nextAt}" title="${esc(clock(j.nextAt))}"></time>`}
      ${last ? `<small class="last run-${last.status}" title="${esc(last.error || clock(last.firedAt))}">${icon(STATUS_ICON[last.status], 12)} ${drift(last)}</small>` : `<small class="quiet">never run</small>`}
    </div>
    <div class="acts">
      ${owed ? `<button type="button" class="ghost done" data-done="${last.id}" title="Done">${icon(Check)}</button>` : ""}
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
  const res = await fetch(path, { method, headers: { ...auth(), "content-type": "application/json" }, body: body === undefined ? null : JSON.stringify(body) }).catch(() => null);
  if (!res) return "Can't reach the server.";
  if (res.status === 401) { gate(await why401(res)); return "Sign in first."; }
  if (!res.ok) return (await readJson(res, Refusal))?.error ?? `HTTP ${res.status}`;
  await load();
  return null;
}

const toInput = (j: Job): JobInput => ({ app: j.app, name: j.name, note: j.note, why: j.why, tags: j.tags, cadence: j.cadence, tz: j.tz, action: j.action, enabled: j.enabled });

document.body.addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("button") : null;
  if (!el) return;
  if (el.id === "sign-in") { if (eq.login()) eq.signOut(); void eq.signIn(); }
  else if (el.dataset.done) { void send("POST", `/api/runs/${el.dataset.done}/done`); if (loud) boom(73.4, { len: 0.35, gain: 0.3 }); }
  else if (el.dataset.snooze) void send("POST", `/api/runs/${el.dataset.snooze}/snooze`, { minutes: Number(el.dataset.min) });
  else if (el.dataset.span) {
    if (Object.hasOwn(SPANS, el.dataset.span)) span = el.dataset.span as Span;
    try { localStorage.setItem(SPAN_KEY, span); } catch { /* kept for this visit only */ }
    renderRoll();
  }
  else if (el.dataset.when) { whenBox.value = el.dataset.when; paintQuick(); }
  else if (isOften(el.dataset.often)) {
    often = el.dataset.often;
    if (needsTime(often) && !whenBox.value) whenBox.value = local(quickTimes(serverNow()).at(-2)!.at);
    paintQuick();
  }
  else if (el.id === "theme") {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* kept for this visit only */ }
    paintToggles();
    renderRoll();
  }
  else if (el.id === "sound") {
    loud = !loud;
    try { localStorage.setItem(SOUND_KEY, loud ? "on" : "off"); } catch { /* kept for this visit only */ }
    paintToggles();
    if (loud) boom(55);
  }
  else if (el.id === "alerts") void Notification.requestPermission().then(paintAlerts);
  else if (el.dataset.app !== undefined) { state.app = el.dataset.app || null; render(); }
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

const sortBox = $<HTMLSelectElement>("sort");
sortBox.innerHTML = Object.entries(SORTS).map(([k, label]) => `<option value="${k}">${label}</option>`).join("");
sortBox.value = state.sort;
sortBox.addEventListener("change", () => {
  if (isSort(sortBox.value)) state.sort = sortBox.value;
  try { localStorage.setItem(SORT_KEY, state.sort); } catch { /* kept for this visit only */ }
  render();
});
paintAlerts();

$<HTMLInputElement>("q").addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; render(); });

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
$("add").innerHTML = `${icon(AlarmClockPlus, 20)} Add alarm`;
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
  dialog.style.setProperty("--pick", j ? `var(--${flow(j.cadence)})` : "var(--accent)");
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

$("quick").addEventListener("submit", async (e) => {
  e.preventDefault();
  const what = $<HTMLInputElement>("what"), c = cadenceFor(often, new Date(whenBox.value), serverNow());
  if (typeof c === "string") { $("quick-hint").textContent = c; return; }
  const err = await send("POST", "/api/jobs", { app: state.app ?? "me", name: what.value.trim(), tags: [], cadence: c, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, action: { kind: "remind" } });
  if (err) { $("quick-hint").textContent = err; return; }
  what.value = "";
  whenBox.value = "";
  paintQuick();
  if (loud) { boom(49, { len: 0.4 }); setTimeout(() => boom(65.4, { len: 0.6 }), 160); }
});
whenBox.addEventListener("input", paintQuick);

// ---- go ----

yule($<HTMLCanvasElement>("yule"));
paintToggles();
paintQuick();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderRoll);

// Back from eqosys with a code: trade it for the login first (a failed one says why in the gate).
void eq.finishSignIn().then((back) => { if (back?.error) gate(SIGN_IN, back.error); else void load(); });
setInterval(tickClocks, 1000);
// Just after each minute the ticker fires; fetch then so new runs and countdowns show without waiting.
const refresh = () => setTimeout(() => { if (!link?.open) void load(); refresh(); }, 60_000 - (serverNow() % 60_000) + 2_000);
refresh();
