// What goes over the wire, as guards the server and the page both import: a job (what runs, when, why, for
// which app), a run (when it fired and how far off the minute it was), and the /api/jobs reply.
import { Bad, arr, bool, int, nul, num, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";
import { Cadence, Zone } from "./bacron.ts";

const Remind = obj({ kind: oneOf(["remind"]) });
const Webhook = obj({ kind: oneOf(["webhook"]), url: str(2000, { re: /^https?:\/\/\S+$/ }), method: oneOf(["POST", "GET"], "POST") });
const Elsewhere = obj({ kind: oneOf(["elsewhere"]), by: str(60, { re: /\S/ }) });
/**
 * What a job does when it fires: shows up as a reminder in the feed, calls a URL (and still shows up), or nothing
 * here because something else runs it (a Cloudflare cron trigger): it sits in its lane with its next run, no runs.
 */
type Action = Of<typeof Remind> | Of<typeof Webhook> | Of<typeof Elsewhere>;
const Action: Guard<Action> = (v) => {
  const { kind } = obj({ kind: oneOf(["remind", "webhook", "elsewhere"]) })(v);
  return kind === "webhook" ? Webhook(v) : kind === "elsewhere" ? Elsewhere(v) : Remind(v);
};

const Tag: Guard<string> = (v) => {
  const t = str(30)(v).trim().toLowerCase();
  if (!t) throw new Bad("a tag with some text in it");
  return t;
};

/** Which app a job belongs to: its lane down the side of the page. */
export const AppName = str(40, { re: /\S/ });

const INPUT = {
  app: AppName,
  name: str(120, { re: /\S/ }),
  note: str(4000, { min: 0, dflt: "" }),
  why: str(500, { min: 0, dflt: "" }),
  tags: arr(Tag, 12),
  cadence: Cadence,
  tz: Zone,
  action: Action,
  enabled: bool(true),
};

/** A job as the page sends it to make or change one. */
export const JobInput = obj(INPUT);
export type JobInput = Of<typeof JobInput>;

const TIME = num(0, Number.MAX_SAFE_INTEGER);

const KEY = str(80, { re: /^\S(?:.*\S)?$/ });

/**
 * A stored job: the input plus its id, when it was made (where an "every" count starts) and its next run. `key` is
 * the name an app's own list gives it (see AppJobs); a job made by hand has none, and a sync leaves it alone.
 */
export const Job = obj({ ...INPUT, id: str(40), key: str(80, { min: 0, dflt: "" }), createdAt: TIME, updatedAt: TIME, anchor: TIME, nextAt: nul(TIME) });
export type Job = Of<typeof Job>;

const STATUSES = ["ok", "failed", "reminded"] as const;

/** One firing: when it was due, when it went, and what came back. Drift is firedAt - scheduledAt. */
export const Run = obj({
  id: int(0, Number.MAX_SAFE_INTEGER),
  jobId: str(40),
  scheduledAt: TIME,
  firedAt: TIME,
  manual: bool(false),
  status: oneOf(STATUSES),
  code: nul(int(0, 999)),
  ms: nul(TIME),
  error: str(500, { min: 0, dflt: "" }),
  /** When a reminder was ticked off on the page, or null. One left unticked an hour, or past its job's next firing, counts as ignored. */
  doneAt: nul(TIME),
  /** Until when a reminder is snoozed (its toast comes back then), or null. */
  snoozedUntil: nul(TIME),
});

/** POST /api/runs/:id/snooze: put a reminder off for a while, up to a day. */
export const Snooze = obj({ minutes: int(1, 1440) });
export type Run = Of<typeof Run>;

const COUNT = int(0, Number.MAX_SAFE_INTEGER);

/**
 * A job's track record over its kept runs: how often it fired, how often it was ticked off, how often a reminder
 * was let slide, and when it was last ticked off or fired. The page sorts by these (most ignored, idle longest).
 */
export const Stats = obj({ fired: COUNT, done: COUNT, ignored: COUNT, lastDoneAt: nul(TIME), lastFiredAt: nul(TIME) });
export type Stats = Of<typeof Stats>;

/**
 * GET /api/jobs: every job with its last run, the latest runs across all of them, the server's clock, and the relay's socket
 * URL when there is one, with the day's ticket the relay lets a page in on (live.ts `ticket`) when it is locked.
 */
export const JobsReply = obj({ jobs: arr(obj({ job: Job, last: nul(Run), stats: Stats }), 10_000), runs: arr(Run, 1000), now: TIME, live: nul(str(2000)), ticket: nul(str(200)) });
export type JobsReply = Of<typeof JobsReply>;

const { app: _app, enabled: _enabled, ...DECLARED } = INPUT;

/**
 * One job in an app's own list: a key that stays put across edits, and the job without its app (the URL says
 * which) or paused state (the page owns that, so a sync never wakes a job someone paused).
 */
export const Declared = obj({ key: KEY, ...DECLARED });
export type Declared = Of<typeof Declared>;

/** PUT /api/apps/:app/jobs: the app's whole list. The server adds what's new, changes what moved, drops what's gone. */
export const AppJobs = obj({ jobs: arr(Declared, 500) });
export type AppJobs = Of<typeof AppJobs>;

/** What a sync did, by job name. Jobs made by hand in that app are never touched. */
export const SyncReply = obj({ added: arr(str(120), 500), changed: arr(str(120), 500), removed: arr(str(120), 10_000), same: int(0, 500) });
export type SyncReply = Of<typeof SyncReply>;

/** What a refused request says. */
export const Refusal = obj({ error: str(500) });

/** Cron Swanson's id in eqosys's APPS (apps/eqosys/src/apps.ts), and the eqosys it signs in through (EQOSYS_URL on the server). */
export const APP = "cron-swanson";
export const EQOSYS = "https://eqosys.qntbr.com";
/** What a 401 says: nobody signed in, or someone signed in who isn't the owner (CRON_SWANSON_OWNER). */
export const SIGN_IN = "sign in with eqosys", NOT_OWNER = "not the owner's account";
