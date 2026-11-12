// Stop hook: a turn that a background-job notice (or any other system event) started may not end the session's
// work. Without this, a session that answers a "task completed" notice with a line and stops sits idle until a
// person looks (nights lost 2026-10-25 and 2026-11-12). It refuses such a stop once, and allows it otherwise:
//   - a person started the turn (the transcript's last prompt has origin.kind "human", or none);
//   - the stop already follows one refusal (stop_hook_active);
//   - something in flight will wake the session again (background_tasks or session_crons non-empty);
//   - the closing message already reports "N of M done".
// Contract (https://code.claude.com/docs/en/hooks#stop): stdin JSON with transcript_path, stop_hook_active,
// last_assistant_message, background_tasks, session_crons; stdout {"decision":"block","reason"} refuses the stop.
// The input doesn't say what started the turn, so that comes from the transcript: its opening prompt is written
// when the turn starts, long before the stop (only the final message may lag).
import { readFileSync } from "node:fs";

export const REASON =
  "This turn was started by a background-job notice or another system event, not by a person. A notice is never a reason to stop: " +
  "carry on with the task you owe. If the work really is finished, end with \"N of M done\" and the links for anything left.";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;

/** Who started the current turn: the latest main-thread prompt (not a tool result, not harness meta) and its origin. */
export function turnStarter(transcript: string): "human" | "system" | null {
  const lines = transcript.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"user"')) continue;
    let o: unknown;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!isObj(o) || o.type !== "user" || o.isSidechain === true || o.isMeta === true || !isObj(o.message)) continue;
    const content = o.message.content;
    if (Array.isArray(content) && content.every((b) => isObj(b) && b.type === "tool_result")) continue;
    const kind = isObj(o.origin) ? o.origin.kind : undefined;
    return typeof kind === "string" && kind !== "human" ? "system" : "human";
  }
  return null;
}

/** A person's message queued into the turn after it started (it rides in as an attachment, not a prompt). */
function humanJoined(transcript: string): boolean {
  const lines = transcript.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"user"') && !lines[i].includes("queued_command")) continue;
    let o: unknown;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!isObj(o)) continue;
    if (o.type === "user" && o.isMeta !== true && isObj(o.message) && !(Array.isArray(o.message.content) && o.message.content.every((b) => isObj(b) && b.type === "tool_result"))) return false;
    if (o.type === "attachment" && isObj(o.attachment) && o.attachment.type === "queued_command" && isObj(o.attachment.origin) && o.attachment.origin.kind === "human") return true;
  }
  return false;
}

/** The refusal reason, or null to let the turn end. */
export function decide(input: unknown, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string | null {
  if (!isObj(input) || input.stop_hook_active === true) return null;
  if (nonEmpty(input.background_tasks) || nonEmpty(input.session_crons)) return null;
  if (typeof input.last_assistant_message === "string" && /\b\d+ of \d+\b/.test(input.last_assistant_message)) return null;
  if (typeof input.transcript_path !== "string") return null;
  let transcript: string;
  try { transcript = read(input.transcript_path); } catch { return null; }
  return turnStarter(transcript) === "system" && !humanJoined(transcript) ? REASON : null;
}

if (import.meta.main) {
  let input: unknown = null;
  try { input = JSON.parse(await Bun.stdin.text()); } catch {}
  const reason = decide(input);
  if (reason) console.log(JSON.stringify({ decision: "block", reason }));
}
