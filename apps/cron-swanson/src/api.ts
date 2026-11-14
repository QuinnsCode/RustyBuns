// What goes over the wire, as guards the server and the page both import: a job (what runs, when, why, for
// which app), a run (when it fired and how far off the minute it was), and the /api/jobs reply.
import { Bad, arr, bool, int, nul, num, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";
import { Cadence, Zone } from "./bacron.ts";

const Remind = obj({ kind: oneOf(["remind"]) });
const Webhook = obj({ kind: oneOf(["webhook"]), url: str(2000, { re: /^https?:\/\/\S+$/ }), method: oneOf(["POST", "GET"], "POST") });
/** What a job does when it fires: shows up as a reminder in the feed, or calls a URL (and still shows up). */
export type Action = Of<typeof Remind> | Of<typeof Webhook>;
export const Action: Guard<Action> = (v) => (obj({ kind: oneOf(["remind", "webhook"]) })(v).kind === "webhook" ? Webhook(v) : Remind(v));

const Tag: Guard<string> = (v) => {
  const t = str(30)(v).trim().toLowerCase();
  if (!t) throw new Bad("a tag with some text in it");
  return t;
};

const INPUT = {
  app: str(40, { re: /\S/ }),
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

/** A stored job: the input plus its id, when it was made (where an "every" count starts) and its next run. */
export const Job = obj({ ...INPUT, id: str(40), createdAt: TIME, updatedAt: TIME, anchor: TIME, nextAt: nul(TIME) });
export type Job = Of<typeof Job>;

export const STATUSES = ["ok", "failed", "reminded"] as const;

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
});
export type Run = Of<typeof Run>;

/** GET /api/jobs: every job with its last run, the latest runs across all of them, and the server's clock. */
export const JobsReply = obj({ jobs: arr(obj({ job: Job, last: nul(Run) }), 10_000), runs: arr(Run, 1000), now: TIME });
export type JobsReply = Of<typeof JobsReply>;

/** What a refused request says. */
export const Refusal = obj({ error: str(500) });
