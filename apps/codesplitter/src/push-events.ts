// Layout: Artifacts push events (#1580): a push that didn't come from codeSplitter goes in the repo's audit log
// Artifacts tells a Queue about each push to a repo (an event subscription, cf.artifacts.repo.pushed),
// ours as well as anyone's. Until checks hang off it, this only logs: a push made outside the app
// (a laptop's `git push` with a write token, an agent's own git) becomes a `git.push` row in the
// repo's audit log, "pushed from outside: N commits to main". Ours are told apart by their author:
// codeSplitter builds every commit with an email at GIT_EMAIL_DOMAIN (git.ts).
// The event lists only some commits on a big push (commitsTruncated), so then the repo's log is read
// for the rest. Nothing here trusts a commit message, which can be cut short too (messageTruncated).
// The subscription is made outside the deploy: see rustybuns.config.ts ARTIFACT_EVENTS.

import { audit } from "./audit.ts";
import type { Env } from "./env.ts";
import { GIT_EMAIL_DOMAIN } from "./git.ts";
import { isPlainObject, listOf, plural } from "./util.ts";

export const PUSHED = "cf.artifacts.repo.pushed";
/** How far back the repo's log is read when the event's list was cut short. */
const LOG_READ = 100;

/** Whether a queue message is one of Artifacts' events (ARTIFACT_EVENTS), pushed or otherwise. */
export const artifactsEvent = (body: unknown) => isPlainObject(body) && typeof body.type === "string" && body.type.startsWith("cf.artifacts.");

export interface Pushed { repoName: string; ref: string; after: string; total: number; truncated: boolean; emails: string[] }

/** A queue message as a push event, or null when it's something else (another event, another queue's message). */
export function pushedEvent(body: unknown): Pushed | null {
  if (!isPlainObject(body) || body.type !== PUSHED || !isPlainObject(body.source) || !isPlainObject(body.payload)) return null;
  const { repoName } = body.source, { ref, after, totalCommitsCount, commitsTruncated } = body.payload;
  if (typeof repoName !== "string" || typeof ref !== "string" || typeof after !== "string") return null;
  const commits = listOf(body.payload, "commits");
  const emails = commits.map((c) => isPlainObject(c.author) && typeof c.author.email === "string" ? c.author.email : "");
  return { repoName, ref, after, total: typeof totalCommitsCount === "number" ? totalCommitsCount : commits.length, truncated: commitsTruncated === true, emails };
}

const ours = (email: string) => email.toLowerCase().endsWith(`@${GIT_EMAIL_DOMAIN}`);

/** Log each push from outside the app; a push of ours, or to a repo we don't know, is dropped. */
export async function logPushes(env: Env, events: Pushed[]) {
  for (const e of events) {
    const r = await env.DB.prepare("SELECT owner, name, artifact FROM repos WHERE artifact = ? OR crew_artifact = ?").bind(e.repoName, e.repoName).first<{ owner: string; name: string; artifact: string }>();
    if (!r) continue;
    const branch = e.ref.replace(/^refs\/heads\//, "");
    let emails = e.emails;
    if (e.truncated && env.ARTIFACTS) {
      const log = await env.ARTIFACTS.get(e.repoName).then((h) => h.log({ ref: branch, limit: Math.min(e.total, LOG_READ) })).catch(() => null);
      if (log) emails = log.map((c) => c.author.email);
    }
    const outside = emails.filter((m) => !ours(m)).length;
    if (!outside) continue;
    await audit(env, null, {
      actor: null, via: "job", action: "git.push", owner: r.owner, repo: r.name, target: `${e.ref} ${e.after}`,
      detail: `pushed from outside: ${plural(outside, "commit")} to ${branch}${e.repoName === r.artifact ? "" : " on the crew's copy"}`,
    });
  }
}
