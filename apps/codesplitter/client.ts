// codeSplitter's typed client (#3804): each call is an Effect whose failure type names the ways that operation
// can fail, so a caller handles BranchProtected or Conflicts on purpose instead of reading a status and a sentence.
//
//   const cs = codesplitter({ url: "https://<site>", token: "cst_…" });
//   cs.call("merge_branch", { owner, repo, branch, body: {} }).pipe(
//     Effect.catchTag("Conflicts", (e) => settle(e.reply)),
//     Effect.catchTag("ChecksHold", () => waitForChecks()),
//   )
//
// The server sends `{error, tag}` (env.ts fail); which tags an operation declares is openapi.ts OP_ERRORS, and
// each is its own class here. Route files move onto tags one at a time: an operation that declares none fails with
// the common ones only. Transient (a 5xx or the network) is the only one retried. It runs outside the Worker: the
// Worker sends tags and never imports effect (EFFECT.md ruling 9).

import { Effect, Schedule, Schema } from "effect";
import { ERRORS, OP_ERRORS, type ErrorTag, type OpWithErrors } from "./src/openapi.ts";
import { tool, toRequest } from "./src/mcp.ts";
import { isPlainObject } from "./src/util.ts";

// A named failure's fields: the server's sentence, its status, and the whole reply (conflicts, files, hash), unchecked.
const named = { message: Schema.String, status: Schema.Number, reply: Schema.Unknown };
export class BadInput extends Schema.TaggedError<BadInput>()("BadInput", named) {}
export class BadBranchName extends Schema.TaggedError<BadBranchName>()("BadBranchName", named) {}
export class NoHarness extends Schema.TaggedError<NoHarness>()("NoHarness", named) {}
export class TextOnlyMainOrBranch extends Schema.TaggedError<TextOnlyMainOrBranch>()("TextOnlyMainOrBranch", named) {}
export class NoWriteAccess extends Schema.TaggedError<NoWriteAccess>()("NoWriteAccess", named) {}
export class OwnerOnly extends Schema.TaggedError<OwnerOnly>()("OwnerOnly", named) {}
export class PersonOnly extends Schema.TaggedError<PersonOnly>()("PersonOnly", named) {}
export class BranchProtected extends Schema.TaggedError<BranchProtected>()("BranchProtected", named) {}
export class AgentRunBatch extends Schema.TaggedError<AgentRunBatch>()("AgentRunBatch", named) {}
export class RunBranchLocked extends Schema.TaggedError<RunBranchLocked>()("RunBranchLocked", named) {}
export class AuthorCantSay extends Schema.TaggedError<AuthorCantSay>()("AuthorCantSay", named) {}
export class AdminsOnly extends Schema.TaggedError<AdminsOnly>()("AdminsOnly", named) {}
export class PolicyFile extends Schema.TaggedError<PolicyFile>()("PolicyFile", named) {}
export class NoSuchBranch extends Schema.TaggedError<NoSuchBranch>()("NoSuchBranch", named) {}
export class NoSuchFile extends Schema.TaggedError<NoSuchFile>()("NoSuchFile", named) {}
export class NoSuchChange extends Schema.TaggedError<NoSuchChange>()("NoSuchChange", named) {}
export class NoSuchConflict extends Schema.TaggedError<NoSuchConflict>()("NoSuchConflict", named) {}
export class NoSuchHook extends Schema.TaggedError<NoSuchHook>()("NoSuchHook", named) {}
export class BranchExists extends Schema.TaggedError<BranchExists>()("BranchExists", named) {}
export class FileExists extends Schema.TaggedError<FileExists>()("FileExists", named) {}
export class BranchClosed extends Schema.TaggedError<BranchClosed>()("BranchClosed", named) {}
export class BranchMoved extends Schema.TaggedError<BranchMoved>()("BranchMoved", named) {}
export class Stacked extends Schema.TaggedError<Stacked>()("Stacked", named) {}
export class StrandedFork extends Schema.TaggedError<StrandedFork>()("StrandedFork", named) {}
export class BuildFiles extends Schema.TaggedError<BuildFiles>()("BuildFiles", named) {}
export class ChecksHold extends Schema.TaggedError<ChecksHold>()("ChecksHold", named) {}
export class BinaryMoved extends Schema.TaggedError<BinaryMoved>()("BinaryMoved", named) {}
export class Conflicts extends Schema.TaggedError<Conflicts>()("Conflicts", named) {}
export class MergeBroken extends Schema.TaggedError<MergeBroken>()("MergeBroken", named) {}
export class TestsFail extends Schema.TaggedError<TestsFail>()("TestsFail", named) {}
export class HookHold extends Schema.TaggedError<HookHold>()("HookHold", named) {}
export class HookOff extends Schema.TaggedError<HookOff>()("HookOff", named) {}
export class NothingToMerge extends Schema.TaggedError<NothingToMerge>()("NothingToMerge", named) {}
export class PipelineInvalid extends Schema.TaggedError<PipelineInvalid>()("PipelineInvalid", named) {}
export class BudgetSpent extends Schema.TaggedError<BudgetSpent>()("BudgetSpent", named) {}
export class AgentsUnavailable extends Schema.TaggedError<AgentsUnavailable>()("AgentsUnavailable", named) {}
export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", named) {}
export class MainProtected extends Schema.TaggedError<MainProtected>()("MainProtected", named) {}
export class NotYourCollection extends Schema.TaggedError<NotYourCollection>()("NotYourCollection", named) {}
export class NoSuchRepo extends Schema.TaggedError<NoSuchRepo>()("NoSuchRepo", named) {}
export class NoSuchUser extends Schema.TaggedError<NoSuchUser>()("NoSuchUser", named) {}
export class NotInCrew extends Schema.TaggedError<NotInCrew>()("NotInCrew", named) {}
export class NoPushClash extends Schema.TaggedError<NoPushClash>()("NoPushClash", named) {}
export class NoSuchCollection extends Schema.TaggedError<NoSuchCollection>()("NoSuchCollection", named) {}
export class NoSuchRoute extends Schema.TaggedError<NoSuchRoute>()("NoSuchRoute", named) {}
export class NoGit extends Schema.TaggedError<NoGit>()("NoGit", named) {}
export class PushClash extends Schema.TaggedError<PushClash>()("PushClash", named) {}
export class HoldingLines extends Schema.TaggedError<HoldingLines>()("HoldingLines", named) {}
export class TooBig extends Schema.TaggedError<TooBig>()("TooBig", named) {}
export class BinaryFile extends Schema.TaggedError<BinaryFile>()("BinaryFile", named) {}
export class NoEuStorage extends Schema.TaggedError<NoEuStorage>()("NoEuStorage", named) {}
export class NoSuchRun extends Schema.TaggedError<NoSuchRun>()("NoSuchRun", named) {}
export class NotTheAgent extends Schema.TaggedError<NotTheAgent>()("NotTheAgent", named) {}
export class PathLocked extends Schema.TaggedError<PathLocked>()("PathLocked", named) {}
export class RunEnded extends Schema.TaggedError<RunEnded>()("RunEnded", named) {}
export class NotesFull extends Schema.TaggedError<NotesFull>()("NotesFull", named) {}
export class NothingWaiting extends Schema.TaggedError<NothingWaiting>()("NothingWaiting", named) {}
export class AlreadyLanding extends Schema.TaggedError<AlreadyLanding>()("AlreadyLanding", named) {}
export class BatchHeld extends Schema.TaggedError<BatchHeld>()("BatchHeld", named) {}
export class UpstreamRefused extends Schema.TaggedError<UpstreamRefused>()("UpstreamRefused", named) {}
export class NotAMirror extends Schema.TaggedError<NotAMirror>()("NotAMirror", named) {}
export class NoUpstreamBranch extends Schema.TaggedError<NoUpstreamBranch>()("NoUpstreamBranch", named) {}
export class NoSuchTag extends Schema.TaggedError<NoSuchTag>()("NoSuchTag", named) {}
export class NoSuchFolder extends Schema.TaggedError<NoSuchFolder>()("NoSuchFolder", named) {}
export class FolderMirror extends Schema.TaggedError<FolderMirror>()("FolderMirror", named) {}
export class NotUpstream extends Schema.TaggedError<NotUpstream>()("NotUpstream", named) {}
export class PullOnly extends Schema.TaggedError<PullOnly>()("PullOnly", named) {}
export class PrivateLines extends Schema.TaggedError<PrivateLines>()("PrivateLines", named) {}
export class MirrorMain extends Schema.TaggedError<MirrorMain>()("MirrorMain", named) {}
export class UpstreamClash extends Schema.TaggedError<UpstreamClash>()("UpstreamClash", named) {}
export class UpstreamMoved extends Schema.TaggedError<UpstreamMoved>()("UpstreamMoved", named) {}
export class TagExists extends Schema.TaggedError<TagExists>()("TagExists", named) {}
export class RepoExists extends Schema.TaggedError<RepoExists>()("RepoExists", named) {}
export class AlreadyMirror extends Schema.TaggedError<AlreadyMirror>()("AlreadyMirror", named) {}
export class NotAFork extends Schema.TaggedError<NotAFork>()("NotAFork", named) {}
export class NoSyncBase extends Schema.TaggedError<NoSyncBase>()("NoSyncBase", named) {}
export class CommitsAhead extends Schema.TaggedError<CommitsAhead>()("CommitsAhead", named) {}
export class GitUnavailable extends Schema.TaggedError<GitUnavailable>()("GitUnavailable", named) {}

type Named = { message: string; status: number; reply: unknown };
/** One class per tag the server sends: a tag added to ERRORS without one here won't compile. */
export const NAMED = {
  BadInput, BadBranchName, NoHarness, TextOnlyMainOrBranch, NoWriteAccess, OwnerOnly, PersonOnly, BranchProtected, AgentRunBatch,
  RunBranchLocked, AuthorCantSay, AdminsOnly, PolicyFile, NoSuchBranch, NoSuchFile, NoSuchChange, NoSuchConflict, NoSuchHook,
  BranchExists, FileExists, BranchClosed, BranchMoved, Stacked, StrandedFork, BuildFiles, ChecksHold, BinaryMoved, Conflicts,
  MergeBroken, TestsFail, HookHold, HookOff, NothingToMerge, PipelineInvalid, BudgetSpent, AgentsUnavailable, AgentFailed,
  MainProtected, NotYourCollection, NoSuchRepo, NoSuchUser, NotInCrew, NoPushClash, NoSuchCollection, NoSuchRoute, NoGit, PushClash,
  HoldingLines, TooBig, BinaryFile, NoEuStorage,
  NoSuchRun, NotTheAgent, PathLocked, RunEnded, NotesFull, NothingWaiting, AlreadyLanding, BatchHeld,
  UpstreamRefused, NotAMirror, NoUpstreamBranch, NoSuchTag, NoSuchFolder, FolderMirror, NotUpstream, PullOnly, PrivateLines, MirrorMain,
  UpstreamClash, UpstreamMoved, TagExists, RepoExists, AlreadyMirror, NotAFork, NoSyncBase, CommitsAhead, GitUnavailable,
} satisfies { [K in ErrorTag]: new (a: Named) => { readonly _tag: K } };

// What any call can meet, whatever the operation: they come from before a route answers, or from no answer at all.
/** No token, or it's expired or revoked. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", { message: Schema.String }) {}
/** Over a rate limit: try again in `retryAfter` seconds. */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", { message: Schema.String, retryAfter: Schema.Number }) {}
/** A 5xx with no tag, or the network: worth a retry, and the only one retried. */
export class Transient extends Schema.TaggedError<Transient>()("Transient", { message: Schema.String, status: Schema.Number }) {}
/** Any other failure: an untagged 4xx from a route not moved onto tags yet, or a tag the operation doesn't declare (a server bug). */
export class Unexpected extends Schema.TaggedError<Unexpected>()("Unexpected", { message: Schema.String, status: Schema.Number, reply: Schema.Unknown }) {}

type Common = Unauthorized | RateLimited | Transient | Unexpected;
/** How operation `Id` can fail: its declared tags' classes, plus the common ones. */
export type Failure<Id extends string> = (Id extends OpWithErrors ? InstanceType<(typeof NAMED)[(typeof OP_ERRORS)[Id][number]]> : never) | Common;

const declares = (id: string, tag: string): tag is ErrorTag => id in OP_ERRORS && (OP_ERRORS[id as OpWithErrors] as readonly string[]).includes(tag);

/** A failed reply, as operation `id`'s error. Plain, so a test can hand it any reply. */
export function failure<Id extends string>(id: Id, status: number, reply: unknown, retryAfter?: string | null): Failure<Id> {
  const body = isPlainObject(reply) ? reply : {};
  const message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : `${id}: ${status}`;
  if (typeof body.tag === "string" && declares(id, body.tag)) return new NAMED[body.tag]({ message, status, reply }) as Failure<Id>;
  if (status === 401) return new Unauthorized({ message });
  if (status === 429 && typeof body.tag !== "string") return new RateLimited({ message, retryAfter: Number(retryAfter ?? body.retryAfter) || 60 });
  if (status >= 500 && typeof body.tag !== "string") return new Transient({ message, status });
  return new Unexpected({ message: typeof body.tag === "string" ? `${id} answered ${body.tag}, which it doesn't declare: ${message}` : message, status, reply });
}

export interface Options {
  url: string;
  token?: string;
  /** Stands in for fetch (a test's local server). */
  send?: (req: Request) => Promise<Response>;
  /** Tries for a Transient failure before it's handed back. */
  retries?: number;
}

/** A client for one site, as one token. */
export function codesplitter(o: Options) {
  const send = o.send ?? ((r: Request) => fetch(r));
  const headers: Record<string, string> = o.token ? { authorization: `Bearer ${o.token}` } : {};
  const once = <Id extends string>(id: Id, args: Record<string, unknown>): Effect.Effect<unknown, Failure<Id>> => {
    const t = tool(id);
    const req = t ? toRequest(t, args, o.url.replace(/\/$/, ""), headers) : `no operation ${id}`;
    if (typeof req === "string") return Effect.fail(new Unexpected({ message: req, status: 0, reply: null }));
    return Effect.tryPromise({ try: () => send(req), catch: (e) => new Transient({ message: String(e), status: 0 }) }).pipe(
      Effect.flatMap((res) => Effect.promise(async () => ({ res, body: await res.json().catch((): unknown => null) }))),
      Effect.flatMap(({ res, body }) => res.ok ? Effect.succeed(body) : Effect.fail(failure(id, res.status, body, res.headers.get("retry-after")))),
    );
  };
  return {
    /** Operation `id` (an operationId, as `codesplitter tools` lists them), its path, query and `body` args by name. */
    call: <Id extends string>(id: Id, args: Record<string, unknown> = {}): Effect.Effect<unknown, Failure<Id>> =>
      once(id, args).pipe(Effect.retry({ while: (e) => e._tag === "Transient", schedule: Schedule.exponential("200 millis"), times: o.retries ?? 3 })),
  };
}

