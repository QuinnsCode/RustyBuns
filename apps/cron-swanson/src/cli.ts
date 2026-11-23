// Cron Swanson from a terminal: the page's commands over its API, for a script or an agent with a shell.
//   bun apps/cron-swanson/src/cli.ts list
//   bun apps/cron-swanson/src/cli.ts add "Drink water" --every 90 --unit minute
//   bun apps/cron-swanson/src/cli.ts add "Pay rent" --every 1 --unit month --start 2026-12-01T10:00
//   bun apps/cron-swanson/src/cli.ts waiting | done [name] | snooze [name] [--minutes 10] | pause <name> | resume <name> | ring <name>
// Talks to CRON_SWANSON_URL (default http://localhost:8790) with CRON_SWANSON_TOKEN when set. The add line is the
// page's: every 0 to 60 minutes, hours, days, weeks or months (0 is once), tidied the same way (31 days is a month).
import { parseArgs } from "node:util";
import { Bad } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";
import { describe } from "./bacron.ts";
import { Job, JobsReply, Refusal, type JobInput } from "./api.ts";
import { every, isUnit, UNITS } from "./every.ts";
import { findJob, waitingRuns } from "./reminders.ts";

const BASE = (process.env.CRON_SWANSON_URL || "http://localhost:8790").replace(/\/$/, "");
const TOKEN = process.env.CRON_SWANSON_TOKEN;

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN && { authorization: `Bearer ${TOKEN}` }) },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const data = parseJson(await res.text());
  if (!res.ok) throw new Bad(`${res.status}: ${(() => { try { return Refusal(data).error; } catch { return "no reason given"; } })()}`);
  return data;
}

const board = async () => JobsReply(await call("GET", "/api/jobs"));
const toInput = (j: Job): JobInput => ({ app: j.app, name: j.name, note: j.note, why: j.why, tags: j.tags, cadence: j.cadence, tz: j.tz, action: j.action, enabled: j.enabled });
const when = (t: number | null) => (t === null ? "never" : new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));

async function main(argv: string[]): Promise<string> {
  const { values: o, positionals: [verb = "list", ...rest] } = parseArgs({
    args: argv, allowPositionals: true,
    options: { every: { type: "string", default: "1" }, unit: { type: "string", default: "day" }, start: { type: "string" }, minutes: { type: "string", default: "10" }, help: { type: "boolean" } },
  });
  if (o.help) return (await Bun.file(import.meta.path).text()).split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
  const name = rest.join(" ");
  const b = await board();
  const jobs = b.jobs.map((r) => r.job);
  switch (verb) {
    case "list": return b.jobs.map(({ job: j, stats: s }) => `${j.enabled ? " " : "‖"} ${j.name.padEnd(28)} ${describe(j.cadence).padEnd(30)} next ${when(j.nextAt)}  ${s.done}✓ ${s.ignored}✗`).join("\n") || "No alarms yet.";
    case "add": {
      if (!isUnit(o.unit)) throw new Bad(`--unit is one of ${UNITS.join(", ")}`);
      const e = every(Number(o.every), o.unit, new Date(o.start ?? Date.now() + 3_600_000), Date.now());
      if (typeof e === "string") throw new Bad(e);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const job = Job(await call("POST", "/api/jobs", { app: "me", name, tags: [], cadence: e.cadence, tz, action: { kind: "remind" } }));
      return `Added ${job.name}: ${e.rounded ? "≈ " : ""}${describe(job.cadence)}, first ${when(job.nextAt)}`;
    }
    case "waiting": return waitingRuns(b.runs, b.now).map((r) => `${jobs.find((j) => j.id === r.jobId)?.name ?? "?"}  (${when(r.firedAt)})`).join("\n") || "Nothing waiting.";
    case "done": case "snooze": {
      const open = waitingRuns(b.runs, b.now), run = name ? open.find((r) => r.jobId === findJob(jobs, name).id) : open[0];
      if (!run) throw new Bad("nothing is waiting to be ticked off");
      await call("POST", `/api/runs/${run.id}/${verb}`, verb === "snooze" ? { minutes: Number(o.minutes) } : undefined);
      return verb === "done" ? "Done." : `Snoozed ${o.minutes} min.`;
    }
    case "pause": case "resume": {
      const j = findJob(jobs, name);
      await call("PUT", `/api/jobs/${j.id}`, { ...toInput(j), enabled: verb === "resume" });
      return `${verb === "pause" ? "Paused" : "Resumed"} ${j.name}.`;
    }
    case "ring": { const j = findJob(jobs, name); await call("POST", `/api/jobs/${j.id}/run`); return `Rang ${j.name}.`; }
    default: throw new Bad(`no command "${verb}": list, add, waiting, done, snooze, pause, resume, ring (--help)`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(console.log, (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
