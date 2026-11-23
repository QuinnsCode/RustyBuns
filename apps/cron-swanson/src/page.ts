// The page: one view at a time under a sky of clouds. The busses (the default) are the coming alarms as fuzzy clouds
// on tracks grouped by lane, a playhead sweeping across that strikes each with lightning (and an 808, sound on). The
// list sorts every alarm; the calendar lays a week out by hour. The + at the bottom left adds one (every N minutes,
// hours, days, weeks or months), the button bottom right picks the view, the gear top right holds the settings, and
// Cmd/Ctrl+K runs any of it, the same commands an agent gets over WebMCP. A reminder that fires floats in as a card to
// tick off or snooze. The editor previews the next runs with the same engine the server ticks with.
import { esc } from "@rustybuns/util";
import { Bad, bool, int, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { eqosys } from "@rustybuns/util/eqosys";
import { LiveMsg, PROTOCOL } from "./live.ts";
import { createElement, AlarmClock, AlarmClockOff, AudioLines, Bell, BellOff, BellRing, CalendarClock, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, CircleAlert, Cloud, LayoutList, LocateFixed, LogIn, LogOut, Monitor, Moon, PartyPopper, Pause, Pencil, Play, Plus, Repeat, Search, Settings, SlidersHorizontal, Sun, SunMedium, Timer, Type, Volume2, VolumeX, Webhook, X, type IconNode } from "lucide";
import { addCommands, type Command } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { FLOWS, describe, flow, upcoming, type Cadence, type Flow } from "./bacron.ts";
import { boom, alarm } from "./boom.ts";
import { roll, tracks, type BusSpot, type Hover, type Lane } from "./roll.ts";
import { weekGrid, weekStart } from "./calendar.ts";
import { findJob, waitingRuns } from "./reminders.ts";
import { yule } from "./yule.ts";
import { FURTHEST_MS, MAX_N, UNITS, every, isUnit, local, startsNow, type Unit } from "./every.ts";
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

const open = () => waitingRuns(state.runs, serverNow());

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
    return `<div class="toast card" style="--pick: var(--${flow(j.cadence)})" role="alertdialog" aria-label="${esc(j.name)}" title="${esc(j.why || describe(j.cadence))} · ${esc(clock(r.firedAt))}">
      <i class="dot lane-${flow(j.cadence)}"></i><b>${esc(j.name)}</b>
      <button type="button" class="ghost digital" data-snooze="${r.id}" data-min="10" title="Snooze 10 minutes">${icon(AlarmClockOff, 14)}10</button>
      <button type="button" class="ghost digital" data-snooze="${r.id}" data-min="60" title="Snooze an hour">1h</button>
      <button type="button" class="primary" data-done="${r.id}" title="Done">${icon(Check, 16)}</button>
    </div>`;
  }).join("");
}

// ---- settings (the gear) ----

const SOUND_KEY = "cron-swanson-sound", THEME_KEY = "cron-swanson-theme", FONT_KEY = "cron-swanson-font";
let loud = false;
try { loud = localStorage.getItem(SOUND_KEY) === "on"; } catch { /* private window */ }
const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);
let theme: Theme = "system";
try { const t = localStorage.getItem(THEME_KEY); if (isTheme(t)) theme = t; } catch { /* private window */ }

/** The two digital faces (Google Fonts) for the numbers and labels: a light mono, or dot-matrix. */
const FONTS: [name: string, weight: number][] = [["Azeret Mono", 300], ["Doto", 500]];
let font = FONTS[0]![0];
try { const v = localStorage.getItem(FONT_KEY); if (v && FONTS.some(([n]) => n === v)) font = v; } catch { /* private window */ }
function wearFont() {
  const [name, weight] = FONTS.find(([n]) => n === font) ?? FONTS[0]!;
  let link = document.getElementById("font-link") as HTMLLinkElement | null;
  if (!link) { link = document.createElement("link"); link.id = "font-link"; link.rel = "stylesheet"; document.head.append(link); }
  // Both faces in one request, so the gear's two buttons each show their own.
  link.href = `https://fonts.googleapis.com/css2?${FONTS.map(([n, w]) => `family=${n.replace(/ /g, "+")}:wght@${w}`).join("&")}&display=swap`;
  document.documentElement.style.setProperty("--digital", `"${name}", ui-monospace, monospace`);
  document.documentElement.style.setProperty("--digital-weight", String(weight));
}

function setTheme(t: Theme) { theme = t; try { localStorage.setItem(THEME_KEY, t); } catch { /* this visit only */ } paintSettings(); renderRoll(); }
function setSound(on: boolean) { loud = on; try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* this visit only */ } paintSettings(); if (on) boom(55); }
function setFont(name: string) { if (!FONTS.some(([n]) => n === name)) return; font = name; try { localStorage.setItem(FONT_KEY, name); } catch { /* this visit only */ } wearFont(); paintSettings(); }

function paintSettings() {
  document.documentElement.dataset.theme = theme;
  $("theme-picks").innerHTML = ([["system", Monitor], ["light", Sun], ["dark", Moon]] as const)
    .map(([t, ic]) => `<button type="button" class="${theme === t ? "on" : ""}" data-theme-pick="${t}" title="${t === "system" ? "Follow the system" : t === "light" ? "Light" : "Dark"}">${icon(ic)}</button>`).join("");
  $("sound").innerHTML = icon(loud ? Volume2 : VolumeX);
  $("sound").title = loud ? "808s on" : "808s off";
  $("sound").classList.toggle("on", loud);
  const alerts = $("alerts");
  if (!("Notification" in window)) alerts.closest<HTMLElement>(".set")!.hidden = true;
  else {
    const p = Notification.permission;
    alerts.innerHTML = icon(p === "granted" ? BellRing : BellOff);
    alerts.title = p === "granted" ? "Desktop alerts on" : p === "denied" ? "Blocked: allow notifications for this site" : "Turn on desktop alerts";
    alerts.classList.toggle("on", p === "granted");
  }
  $("font-picks").innerHTML = FONTS.map(([n, wt]) => `<button type="button" class="${font === n ? "on" : ""}" data-font="${esc(n)}" title="${esc(n)}" style="font-family:'${esc(n)}',ui-monospace,monospace;font-weight:${wt}">09:41</button>`).join("");
  const l = eq.login();
  $("set-account").innerHTML = l
    ? `<span>${icon(LogOut)}</span><button type="button" class="toggle wide" id="sign-out" title="Sign out">${esc(l.name || l.email)}</button>`
    : `<span>${icon(LogIn)}</span><button type="button" class="toggle wide" id="sign-in" title="Sign in with eqosys">eqosys</button>`;
  painter.sound(loud);
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
  renderCalendar();
  renderToasts();
  tickClocks();
}

// ---- views ----

const VIEWS = { busses: ["Busses", AudioLines], list: ["List", LayoutList], calendar: ["Calendar", CalendarDays] } as const;
type View = keyof typeof VIEWS;
const isView = (v: unknown): v is View => typeof v === "string" && Object.hasOwn(VIEWS, v);
const VIEW_KEY = "cron-swanson-view";
let view: View = "busses";
try { const v = localStorage.getItem(VIEW_KEY); if (isView(v)) view = v; } catch { /* private window */ }

function setView(v: View) {
  view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* this visit only */ }
  paintViews();
}
function paintViews() {
  for (const k of Object.keys(VIEWS)) $(`v-${k}`).hidden = k !== view;
  $("views").innerHTML = icon(VIEWS[view][1], 22);
  $("view-picks").innerHTML = Object.entries(VIEWS).map(([k, [label, ic]]) => `<button type="button" class="${view === k ? "on" : ""}" data-view="${k}" title="${label}">${icon(ic, 18)}</button>`).join("");
  $("spans").hidden = view !== "busses";
  $("spans").innerHTML = Object.entries(SPANS).map(([k, [label]]) => `<button type="button" class="chip digital ${span === k ? "on" : ""}" data-span="${k}">${label}</button>`).join("");
  renderCalendar();
}

// ---- calendar ----

let weekOffset = 0;
function renderCalendar() {
  if (view !== "calendar") return;
  const now = serverNow(), start = weekStart(now, weekOffset);
  const end = new Date(start + 6 * DAY);
  $("cal-label").textContent = `${new Date(start).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  $("cal").innerHTML = weekGrid(state.rows.filter((r) => matches(r)).map((r) => ({ job: r.job, flow: flow(r.job.cadence) })), start, now);
  const body = $("cal").querySelector<HTMLElement>(".cal-body");
  if (body && !body.dataset.scrolled) { body.scrollTop = body.scrollHeight * (7 / 24); body.dataset.scrolled = "1"; }
}

// ---- the roll ----

// One 808 pitch per lane, low to high: async, daily, weekly, monthly, yearly.
const HZ: Record<Flow, number> = { async: 41.2, daily: 49, weekly: 55, monthly: 65.4, yearly: 73.4 };
const SPANS = { "6h": ["6h", 6 * 3_600_000], "1d": ["1d", DAY], "1w": ["1w", 7 * DAY], "1mo": ["1mo", 31 * DAY], "3mo": ["3mo", FURTHEST_MS] } as const;
const BUS_ICON: Record<Flow, IconNode> = { async: Timer, daily: SunMedium, weekly: CalendarDays, monthly: CalendarRange, yearly: PartyPopper };
type Span = keyof typeof SPANS;
const SPAN_KEY = "cron-swanson-span";
let span: Span = "1d";
try { const v = localStorage.getItem(SPAN_KEY); if (v && Object.hasOwn(SPANS, v)) span = v as Span; } catch { /* private window */ }
const painter = roll($<HTMLCanvasElement>("roll"), {
  height: () => Math.max(240, window.innerHeight - $("roll").getBoundingClientRect().top - 120),
  pick: (j) => openEditor(j),
  hit: (lane) => boom(lane.hz, { len: 0.5, gain: 0.35 }),
  hover: showTip,
  laid: (busses: BusSpot[]) => {
    $("bus-icons").innerHTML = busses.map((b) => `<span class="bus-icon lane-${b.flow}" style="top:${b.top}px;height:${b.height}px" title="${LANE_LABEL[b.flow]}">${icon(BUS_ICON[b.flow], 18)}</span>`).join("");
  },
});

function showTip(h: Hover | null) {
  const tip = $("tip");
  if (!h) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.innerHTML = `<b>${esc(h.job.name)}</b><span class="digital">${h.at ? esc(clock(h.at)) : esc(describe(h.job.cadence))}</span>`;
  tip.style.left = `${Math.min(window.innerWidth - 220, h.x + 14)}px`;
  tip.style.top = `${h.y + 14}px`;
}

function renderRoll() {
  const styles = getComputedStyle(document.documentElement), now = serverNow(), ms = SPANS[span][1];
  const lanes: Lane[] = state.rows.filter((r) => matches(r) && r.job.enabled && r.job.nextAt !== null && r.job.nextAt < now + ms)
    .sort((a, b) => FLOWS.indexOf(flow(a.job.cadence)) - FLOWS.indexOf(flow(b.job.cadence)) || nextAt(a) - nextAt(b))
    .map((r) => ({ job: r.job, flow: flow(r.job.cadence), color: styles.getPropertyValue(`--${flow(r.job.cadence)}`).trim(), hz: HZ[flow(r.job.cadence)] }));
  $("roll-empty").hidden = lanes.length > 0;
  if (!lanes.length) $("bus-icons").innerHTML = "";
  $("roll").hidden = lanes.length === 0;
  painter.draw(tracks(lanes, now, ms), now, ms);
}

// ---- the + (add) ----

const adder = $<HTMLDialogElement>("adder"), whenBox = $<HTMLInputElement>("when"), nBox = $<HTMLInputElement>("n");
let unit: Unit = "day";
const UNIT_LABEL: Record<Unit, string> = { minute: "min", hour: "hour", day: "day", week: "week", month: "month" };
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function openAdder(name = "") {
  $<HTMLInputElement>("what").value = name;
  if (!whenBox.value) { const d = new Date(serverNow() + 3_600_000); d.setMinutes(0, 0, 0); whenBox.value = local(d); }
  paintAdder();
  adder.showModal();
  $("what").focus();
}

/** The line read back: what it will do and when first, in the engine's own words. */
function paintAdder() {
  const now = serverNow(), n = Number(nBox.value);
  whenBox.min = local(new Date(now));
  whenBox.max = local(new Date(now + FURTHEST_MS));
  $("units").innerHTML = UNITS.map((u) => `<button type="button" class="${unit === u ? "on" : ""}" data-unit="${u}">${UNIT_LABEL[u]}${n === 1 ? "" : "s"}</button>`).join("");
  $("start-line").classList.toggle("off", startsNow(n, unit));
  const e = every(n, unit, new Date(whenBox.value), now);
  if (typeof e === "string") { $("quick-hint").textContent = e; return; }
  const next = upcoming(e.cadence, now, tz(), 1, now);
  $("quick-hint").textContent = `${e.rounded ? "≈ " : ""}${describe(e.cadence)}${next[0] ? ` · ${clock(next[0])}` : ""}`;
}

/** Makes an alarm from the add form's fields (or a command's), and says why not when it can't. */
async function addAlarm(name: string, n: number, u: Unit, start: Date): Promise<string | null> {
  if (!name.trim()) return "What should it nag you about?";
  const e = every(n, u, start, serverNow());
  if (typeof e === "string") return e;
  const err = await send("POST", "/api/jobs", { app: state.app ?? "me", name: name.trim(), tags: [], cadence: e.cadence, tz: tz(), action: { kind: "remind" } });
  if (!err && loud) { boom(49, { len: 0.4 }); setTimeout(() => boom(65.4, { len: 0.6 }), 160); }
  return err;
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
  else if (el.id === "sign-out") { eq.signOut(); paintSettings(); void load(); }
  else if (el.dataset.span) {
    if (Object.hasOwn(SPANS, el.dataset.span)) span = el.dataset.span as Span;
    try { localStorage.setItem(SPAN_KEY, span); } catch { /* kept for this visit only */ }
    paintViews();
    renderRoll();
  }
  else if (isView(el.dataset.view)) { setView(el.dataset.view); $("views-menu").hidden = true; }
  else if (isUnit(el.dataset.unit)) { unit = el.dataset.unit; paintAdder(); }
  else if (isTheme(el.dataset.themePick)) setTheme(el.dataset.themePick);
  else if (el.dataset.font) setFont(el.dataset.font);
  else if (el.id === "sound") setSound(!loud);
  else if (el.id === "alerts") void Notification.requestPermission().then(paintSettings);
  else if (el.id === "plus" || el.dataset.openAdder !== undefined) openAdder();
  else if (el.id === "adder-close") adder.close();
  else if (el.id === "gear") { $("settings").hidden = !$("settings").hidden; $("views-menu").hidden = true; }
  else if (el.id === "views") { $("views-menu").hidden = !$("views-menu").hidden; $("settings").hidden = true; }
  else if (el.id === "cal-prev" || el.id === "cal-next" || el.id === "cal-today") { weekOffset = el.id === "cal-today" ? 0 : weekOffset + (el.id === "cal-next" ? 1 : -1); renderCalendar(); }
  else if (el.dataset.job) { const row = state.rows.find((r) => r.job.id === el.dataset.job); if (row) openEditor(row.job); }
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

// A click outside a pop-up closes it.
document.addEventListener("pointerdown", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  for (const [pop, opener] of [["settings", "gear"], ["views-menu", "views"]] as const)
    if (!$(pop).hidden && !t?.closest(`#${pop}, #${opener}`)) $(pop).hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("settings").hidden = true; $("views-menu").hidden = true; } });

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
$("add").innerHTML = icon(Check, 22);
$("add").title = "Add";
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
$("new").addEventListener("click", () => { adder.close(); openEditor(null); });
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
  const what = $<HTMLInputElement>("what");
  const err = await addAlarm(what.value, Number(nBox.value), unit, new Date(whenBox.value));
  if (err) { $("quick-hint").textContent = err; return; }
  what.value = "";
  adder.close();
});
for (const box of [whenBox, nBox]) box.addEventListener("input", paintAdder);

// ---- commands: Cmd/Ctrl+K for a person, WebMCP tools for an agent, the same list ----

/** The alarm a command names. */
const named = (name: unknown) => findJob(state.rows.map((r) => r.job), str(120)(name));
/** The newest waiting reminder: the named alarm's, or the newest of all. */
function waiting(name?: unknown): Run {
  const runs = open();
  const run = name === undefined || name === "" ? runs[0] : runs.find((r) => r.jobId === named(name).id);
  if (!run) throw new Bad("nothing is waiting to be ticked off");
  return run;
}
const fail = async (p: Promise<string | null>) => { const err = await p; if (err) throw new Bad(err); return "done"; };
const NAME = { name: { type: "string", description: "The alarm's name, or words in it" } };
const AddArgs = obj({ name: str(120), every: int(0, MAX_N, 1), unit: oneOf(UNITS, "day"), start: str(16, { min: 0, dflt: "" }) });

function commands(): Command[] {
  const read = { readOnlyHint: true } as const;
  return [
    { name: "cs_add_alarm", title: "New alarm", group: "Alarms", icon: "plus", ask: "What?",
      description: `Add a reminder: every N (0 to ${MAX_N}, 0 = once) minutes, hours, days, weeks or months, starting at a local time (YYYY-MM-DDTHH:MM, within three months; minutes, hours and every-N-days start now). 31 days becomes a month, 60 minutes an hour.`,
      inputSchema: { type: "object", properties: { ...NAME, every: { type: "number", minimum: 0, maximum: MAX_N }, unit: { type: "string", enum: [...UNITS] }, start: { type: "string", description: "Local start, YYYY-MM-DDTHH:MM" } }, required: ["name"] },
      execute: async (args, via) => {
        if (via === "palette") { openAdder(str(120, { min: 0, dflt: "" })((args as { name?: unknown }).name ?? "")); return; }
        const a = AddArgs(args);
        return fail(addAlarm(a.name, a.every, a.unit, a.start ? new Date(a.start) : new Date(serverNow() + 3_600_000)));
      } },
    { name: "cs_list_alarms", title: "List alarms", group: "Alarms", icon: "list", annotations: read,
      description: "Every alarm: name, app, how often, next run, paused or not, and how often it was done or ignored.",
      execute: () => state.rows.map(({ job: j, stats }) => ({ name: j.name, app: j.app, every: describe(j.cadence), next: j.nextAt && new Date(j.nextAt).toISOString(), paused: !j.enabled, ...stats })) },
    { name: "cs_pause", title: "Pause alarm", group: "Alarms", icon: "pause", ask: "Which alarm?", description: "Pause an alarm: it stops going off until resumed.",
      inputSchema: { type: "object", properties: NAME, required: ["name"] },
      execute: (a) => { const j = named(obj(NAME_GUARD)(a).name); return fail(send("PUT", `/api/jobs/${j.id}`, { ...toInput(j), enabled: false })); } },
    { name: "cs_resume", title: "Resume alarm", group: "Alarms", icon: "play", ask: "Which alarm?", description: "Start a paused alarm again.",
      inputSchema: { type: "object", properties: NAME, required: ["name"] },
      execute: (a) => { const j = named(obj(NAME_GUARD)(a).name); return fail(send("PUT", `/api/jobs/${j.id}`, { ...toInput(j), enabled: true })); } },
    { name: "cs_ring_now", title: "Ring it now", group: "Alarms", icon: "zap", ask: "Which alarm?", description: "Set an alarm off right now, by hand.",
      inputSchema: { type: "object", properties: NAME, required: ["name"] },
      execute: (a) => fail(send("POST", `/api/jobs/${named(obj(NAME_GUARD)(a).name).id}/run`)) },
    { name: "cs_delete_alarm", title: "Delete alarm", group: "Alarms", icon: "trash", ask: "Which alarm?", annotations: { destructiveHint: true },
      description: "Delete an alarm and its history. Ask the person first.", inputSchema: { type: "object", properties: NAME, required: ["name"] },
      execute: (a) => fail(send("DELETE", `/api/jobs/${named(obj(NAME_GUARD)(a).name).id}`)) },
    { name: "cs_edit_alarm", title: "Edit alarm", group: "Alarms", icon: "pencil", ask: "Which alarm?", agent: false, description: "Open an alarm in the editor.",
      inputSchema: { type: "object", properties: NAME, required: ["name"] }, execute: (a) => openEditor(named(obj(NAME_GUARD)(a).name)) },
    { name: "cs_waiting", title: "What's waiting", group: "Reminders", icon: "bell", annotations: read,
      description: "Reminders that went off and wait to be ticked off or snoozed.",
      execute: () => open().map((r) => ({ name: state.rows.find((x) => x.job.id === r.jobId)?.job.name ?? "", firedAt: new Date(r.firedAt).toISOString() })) },
    { name: "cs_done", title: "Done", group: "Reminders", icon: "check", ask: "Which alarm? (blank: the newest)",
      description: "Tick off the newest waiting reminder, or the named alarm's.", inputSchema: { type: "object", properties: NAME },
      execute: (a) => fail(send("POST", `/api/runs/${waiting(obj({ name: opt(str(120)) })(a).name).id}/done`)) },
    { name: "cs_snooze", title: "Snooze", group: "Reminders", icon: "alarm-clock-off", ask: "Which alarm? (blank: the newest)",
      description: "Put off the newest waiting reminder (or the named alarm's) for some minutes (default 10, up to 1440).",
      inputSchema: { type: "object", properties: { ...NAME, minutes: { type: "number", minimum: 1, maximum: 1440 } } },
      execute: (a) => { const v = obj({ name: opt(str(120)), minutes: int(1, 1440, 10) })(a); return fail(send("POST", `/api/runs/${waiting(v.name).id}/snooze`, { minutes: v.minutes })); } },
    ...Object.entries(VIEWS).map(([k, [label]]): Command => ({ name: `cs_view_${k}`, title: `${label} view`, group: "View", icon: k,
      description: `Show the ${label.toLowerCase()} view.`, annotations: { readOnlyHint: true }, answers: false, execute: () => setView(k as View) })),
    { name: "cs_window", title: "Busses window", group: "View", icon: "clock", ask: "6h, 1d, 1w, 1mo or 3mo", annotations: { readOnlyHint: true }, answers: false,
      description: "How far ahead the busses look: 6h, 1d, 1w, 1mo or 3mo.", inputSchema: { type: "object", properties: { span: { type: "string", enum: Object.keys(SPANS) } }, required: ["span"] },
      execute: (a) => { span = oneOf(Object.keys(SPANS) as Span[])(obj({ span: str(4) })(a).span); setView("busses"); renderRoll(); } },
    { name: "cs_theme", title: "Look: system, light or dark", group: "Settings", icon: "sun", ask: "system, light or dark", answers: false,
      description: "Pick the look.", inputSchema: { type: "object", properties: { theme: { type: "string", enum: [...THEMES] } }, required: ["theme"] },
      execute: (a) => setTheme(oneOf(THEMES)(obj({ theme: str(10) })(a).theme)) },
    { name: "cs_sound", title: "808s on or off", group: "Settings", icon: "audio-lines", answers: false, description: "Turn the 808s on or off (toggles without an argument).",
      inputSchema: { type: "object", properties: { on: { type: "boolean" } } }, execute: (a) => setSound(obj({ on: bool(!loud) })(a).on) },
    { name: "cs_font", title: "Font", group: "Settings", icon: "type", ask: FONTS.map(([n]) => n).join(" or "), answers: false,
      description: `Pick the font: ${FONTS.map(([n]) => n).join(" or ")} (or 1, 2).`, inputSchema: { type: "object", properties: { font: { type: "string" } }, required: ["font"] },
      execute: (a) => { const v = String((a as { font?: unknown }).font ?? "").trim(); const byNo = FONTS[Number(v) - 1]; const hit = byNo ?? FONTS.find(([n]) => n.toLowerCase().includes(v.toLowerCase())); if (!hit) throw new Bad(`no font "${v}"`); setFont(hit[0]); } },
    { name: "cs_state", title: "What's on screen", group: "Settings", icon: "info", annotations: read, palette: false,
      description: "The page's view, window, look, sound, font, and how many alarms and waiting reminders there are.",
      execute: () => ({ view, span, theme, sound: loud, font, alarms: state.rows.length, waiting: open().length }) },
  ];
}
const NAME_GUARD = { name: str(120) };

// ---- go ----

$("plus").innerHTML = icon(Plus, 26);
$("gear").innerHTML = icon(Settings, 20);
$("every-icon").innerHTML = icon(Repeat, 18);
$("start-icon").innerHTML = icon(CalendarClock, 18);
$("set-theme-icon").innerHTML = icon(SunMedium);
$("set-sound-icon").innerHTML = icon(AudioLines);
$("set-alert-icon").innerHTML = icon(Bell);
$("set-font-icon").innerHTML = icon(Type);
$("cal-prev").innerHTML = icon(ChevronLeft);
$("cal-next").innerHTML = icon(ChevronRight);
$("cal-today").innerHTML = icon(LocateFixed);
$("adder-close").innerHTML = icon(X);
$("new").innerHTML = icon(SlidersHorizontal);
$("roll-empty").innerHTML = `${icon(Cloud, 40)}<button type="button" class="ghost" data-open-adder>${icon(Plus)}</button>`;
nBox.max = String(MAX_N);
yule($<HTMLCanvasElement>("yule"));
wearFont();
paintSettings();
paintViews();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderRoll);
addCommands(commands());
mountPalette({ placeholder: "Add, find, snooze, switch views…", foot: "Every command here is a WebMCP tool an agent in the browser can call too.", button: false });

// Back from eqosys with a code: trade it for the login first (a failed one says why in the gate).
void eq.finishSignIn().then((back) => { if (back?.error) gate(SIGN_IN, back.error); else void load(); });
setInterval(tickClocks, 1000);
// Just after each minute the ticker fires; fetch then so new runs and countdowns show without waiting.
const refresh = () => setTimeout(() => { if (!link?.open) void load(); refresh(); }, 60_000 - (serverNow() % 60_000) + 2_000);
refresh();
