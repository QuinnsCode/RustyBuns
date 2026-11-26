// StopFailure hook (#4311): a turn that ended on an API error (rate limit, server error, a dropped stream) leaves one
// line in ~/.rustybuns/stop-failures.jsonl, so the next stall has a trace beside Dexter's stall watch (#4306).
// Contract (https://code.claude.com/docs/en/hooks): it runs instead of Stop when the turn ends on an API error, with
// stdin JSON session_id, transcript_path, cwd, error (rate_limit, server_error, unknown, ...), and error_details and
// last_assistant_message when there are any. Its output and exit code are ignored, so it never blocks anything.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { check, obj, str, type Of } from "../../packages/util/src/guard.ts";

const text = (max: number) => str(max, { min: 0, dflt: "" });

/** What the hook reads of its input; long fields are cut, missing ones are "". */
export const Failure = obj({ session_id: text(100), cwd: text(1000), transcript_path: text(1000), error: text(100), error_details: text(2000), last_assistant_message: text(500) });
export type Failure = Of<typeof Failure>;

export const LOG = path.join(homedir(), ".rustybuns", "stop-failures.jsonl");

/** The log line for one failed turn, or null for input that isn't a hook's. */
export function line(input: unknown, now = new Date()): string | null {
  const f = check(Failure, input);
  if (!f) return null;
  return JSON.stringify({ at: now.toISOString(), session: f.session_id, cwd: f.cwd, error: f.error || "unknown", details: f.error_details, last: f.last_assistant_message, transcript: f.transcript_path });
}

/** Appends the line for `input` to `log`; false when there was nothing to write. */
export function record(input: unknown, log = LOG, now = new Date()): boolean {
  const l = line(input, now);
  if (!l) return false;
  mkdirSync(path.dirname(log), { recursive: true });
  appendFileSync(log, `${l}\n`);
  return true;
}

if (import.meta.main) {
  let input: unknown = null;
  try { input = JSON.parse(await Bun.stdin.text()); } catch {}
  try { record(input); } catch {}
}
