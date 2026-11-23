// The ssh gate's remote lookup (#5541): GET /api/ssh/remote?user=&repo=owner/name&mode=read|write, bearer
// SSH_GATE_SECRET (a 404 without it, like the drain). The gate's git-serve.sh (ssh/) asks it once per connection,
// for the user its key lookup named (#5504), and reads back two lines: the repo's smart-HTTP remote and a token for
// it. Anything else is an error status whose plain-text body is the reason the git client sees.
//
// read takes read access, as the API's: a private repo you can't see is "not found". The crew get the crew remote
// (private lines' real text) once there is one, as GET /api/repos/:o/:r hands it them; anyone else's token is kept
// so going private recalls it (share-tokens.ts).
//
// write is what the app can land as it would the desktop's Push back (#464, #773): the owner's, on the desktop's
// own git, with no private lines. A push there is heard as it lands (mirror.ts hearPushes) and comes into the open
// files as the owner's edits. Cloudflare Artifacts tells the Worker of no push made outside it, so there a push
// would move git under the files' lines unseen: it is turned away with the reason until that lands (#5699).

import { access as artifactAccess, handleFor } from "./archive.ts";
import type { Env } from "./env.ts";
import { localGit, refuseForcedPushes } from "./mirror.ts";
import { handOut } from "./share-tokens.ts";
import { sha256 } from "./util.ts";

/** A token lasts long enough for one connection's mirror fetch and push, and no longer. */
export const SSH_TOKEN_TTL = 600;
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const HANDLE = /^(?=.{1,39}$)[a-z0-9]+(-[a-z0-9]+)*$/;

type Access = (owner: string, repo: string, user: string) => Promise<{ read: boolean; write: boolean }>;

const say = (status: number, reason: string) => new Response(`${reason}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function sshRemoteRoutes(req: Request, env: Env, p: string[], url: URL, access: Access): Promise<Response | null> {
  if (!(p[1] === "ssh" && p[2] === "remote" && !p[3] && req.method === "GET")) return null;
  const secret = env.SSH_GATE_SECRET, given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  // Compared as digests so the check takes the same time wherever it differs.
  if (!secret || (await sha256(given)) !== (await sha256(secret))) return say(404, "not found");
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const user = q("user"), mode = q("mode"), [owner = "", repo = "", extra] = q("repo").split("/");
  if (!HANDLE.test(user) || !NAME.test(owner) || !NAME.test(repo) || extra !== undefined || (mode !== "read" && mode !== "write"))
    return say(400, "the lookup takes user, repo (owner/name) and mode (read or write)");
  const a = await access(owner, repo, user);
  if (!a.read) return say(404, "not found");
  const h = await handleFor(env, owner, repo).catch(() => null);
  if (!h) return say(404, "it has no git yet");

  if (mode === "read") {
    const crew = a.write ? await handleFor(env, owner, repo, true).catch(() => null) : null;
    const art = crew?.crew ? await artifactAccess(crew.handle, crew.remote, "read", SSH_TOKEN_TTL) : await handOut(env, owner, repo, user, h, SSH_TOKEN_TTL);
    return remote(art);
  }
  if (!a.write) return say(403, "you can read it but not push to it");
  if (user !== owner) return say(403, "only the owner pushes over ssh: the crew's changes go on a branch");
  if ((await handleFor(env, owner, repo, true).catch(() => null))?.crew) return say(403, "it has private lines, which its git holds blank: change it in the app");
  if (!localGit(env)) return say(403, "pushing over ssh lands in the desktop app only for now: change it in the app");
  await refuseForcedPushes(env, owner, repo).catch(() => {});
  return remote(await artifactAccess(h.handle, h.remote, "write", SSH_TOKEN_TTL));
}

/** The two lines git-serve.sh reads: the remote, then its token (without Artifacts' `?expires=` tail, as a clone line has it). */
const remote = (art: { remote: string; token: string }) =>
  new Response(`${art.remote}\n${art.token.split("?")[0]}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
