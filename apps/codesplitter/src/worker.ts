// Layout: routes, visibility, profiles, playlists, search
// codeSplitter: a code host where each file is a Durable Object and your profile
// is a playlist of code you like. Plain fetch handler: it runs as a Worker on
// Cloudflare and in-process under Bun on the desktop.

import { artifactMoveRoutes } from "./artifact-move.ts";
import { rankOf } from "./policy.ts";
import { fromText } from "./lines.ts";
import { mainClosed, policyClosed, protectRoute } from "./protect.ts";
import {
  ensureCrewRemote,
  fileStub,
  handleFor,
  access as artifactAccess,
  listDir,
  materialize,
  pushCatalogue,
  toFile,
} from "./archive.ts";
import { repoRow } from "./repos.ts";
import {
  code,
  json,
  NAME,
  readBody,
  type DigMessage,
  type Env,
} from "./env.ts";
import {
  accountsOn,
  actingAs,
  changesSession,
  forgetSession,
  identityRoutes,
  identify,
  isAdmin,
  isAgentHandle,
} from "./identity.ts";
import {
  privacyRoutes,
  scrubRoutes,
  sweepSessions,
} from "./privacy.ts";
import {
  feedRoutes,
  runQueuedDigests,
  type DigestMessage,
} from "./feed.ts";
import { sweepLineEvents } from "./line-events.ts";
import {
  levelRoutes,
  runDigs,
} from "./levels.ts";
import {
  evict,
  githubRoutes,
  githubToken,
} from "./github.ts";
import { gameRoutes } from "./game.ts";
import {
  createShare,
  shareRoutes,
} from "./shares.ts";
import {
  followers,
  followRoutes,
  listFollows,
} from "./follows.ts";
import { cityRoutes } from "./city.ts";
import {
  recentStamps,
  stampRoutes,
} from "./stamps.ts";
import { agentProfile } from "./actors.ts";
import {
  createCut,
  cutRoutes,
} from "./cuts.ts";
import {
  ancestors,
  branchRoutes,
  createOn,
  materializeOn,
  openBranch,
  pathPolicy,
} from "./branches.ts";
import {
  agentRoutes,
  runQueuedAgents,
  type AgentMessage,
} from "./agent-routes.ts";
import {
  depRoutes,
  scheduledDoctor,
} from "./deps.ts";
import {
  hearDue,
  listenRoute,
} from "./listen.ts";
import {
  scheduledWatch,
  watchRoutes,
} from "./watch.ts";
import {
  advanceAll,
  freshRoutes,
  startIfFull,
} from "./fresh.ts";
import {
  counted,
  drainJobs,
  jobRoutes,
  limit,
  limitRoutes,
  ruleFor,
  RULES,
  runJobs,
  sweepLimits,
  type JobMessage,
} from "./limits.ts";
import { tierById } from "./tiers.ts";
import { previewRoutes } from "./preview.ts";
import { tryRoutes } from "./try-out.ts";
import {
  deployOnCommit,
  deployRoutes,
} from "./deploy.ts";
import { clearOwn } from "./deploy-review.ts";
import { resealRoutes } from "./deploy-keys.ts";
import { repoFit } from "./fit.ts";
import { gitState } from "./git-state.ts";
import { commitGraph, GRAPH_MAX, sharedGraph } from "./graph.ts";

/** A share link's read token: a day unless asked, a week at most. */
const SHARE_DEFAULT_S = 86400, SHARE_MAX_S = 7 * 86400;
import { watchdogRoutes } from "./watchdog.ts";
import { busiestFiles, fileHistory } from "./gitpath-data.ts";
import { joinHistory, upstreamBusiest, upstreamFileHistory, type UpstreamRepo } from "./gitpath-upstream.ts";
import { tagRoutes } from "./tags.ts";
import { pickRoute } from "./pick.ts";
import {
  deliverHooks,
  emit,
  hookRoutes,
  type HookMessage,
} from "./hooks.ts";
import {
  bearer,
  tokenRoutes,
} from "./tokens.ts";
import {
  audit,
  auditRoutes,
  via,
} from "./audit.ts";
import {
  invitePage,
  inviteRoutes,
  pendingInvites,
  repoInviteRoutes,
} from "./invites.ts";
import { openapi } from "./openapi.ts";
import {
  catalogue,
  mcp,
} from "./mcp.ts";
import {
  oauthRoutes,
  sweepOAuth,
  wellKnown,
} from "./oauth.ts";
import { REFERENCE } from "./api.ts";
import {
  checkRoutes,
  expireQueued,
  pollGithub,
  requeueStale,
  startChecks,
} from "./checks.ts";
import {
  desktopRuns,
  kickQueued,
} from "./ci-runner.ts";
import {
  ciTokenRoutes,
  ghCompatRoutes,
} from "./gh-compat.ts";
import {
  callers,
  insightRoutes,
  record,
  sweepTraffic,
  tallied,
  viaMcp,
} from "./insights.ts";
import { actionsRoutes } from "./actions-bill.ts";
import { scaleRoutes } from "./scale.ts";
import {
  embedDue,
  indexFile,
  restaleSearch,
  searchAll,
  searchRepo,
  searchRoutes,
} from "./search.ts";
import { pulseRoutes } from "./pulse.ts";
import { askUsage, forget, sweepConflicts } from "./usage.ts";
import { hasPage, pageRoutes } from "./page.ts";
import { seenRoutes } from "./seen.ts";
import { settingsRoutes } from "./settings.ts";
import { agentPromptResponse } from "./agent-prompt.ts";
import { installScript } from "./install.ts";
import {
  crossSite,
  edgeLimit,
  secured,
  turnstile,
  wantsTurnstile,
} from "./security.ts";
import { worktreeRoute } from "./worktrees.ts";
import { timed, withTiming } from "./timing.ts";
import { cleanAvatar, PARTS } from "./avatar.ts";
import { beamRoutes } from "./beam.ts";
import {
  kickMirror,
  landPushes,
  mirrorBranchRoute,
  mirrorRepoRoute,
  mirrorTagRoute,
  mirrorRoutes,
  mirrorsOn,
  hearPushes,
  pushClashes,
  pushHolds,
  seeGit,
  settlePush,
  syncDue,
  TRUTHS,
  turnRoute,
  upstreamRemote,
  type Truth,
} from "./mirror.ts";
export { FileDurableObject } from "./file-do.ts";
export { GameRoom } from "./game-do.ts";
export { RepoSearch } from "./search.ts";
export { UserSettings } from "./settings.ts";
export { AgentSandbox } from "./sandbox.ts";
export { DeployRunner } from "./deploy-runner.ts";
export { CiRunner } from "./ci-runner.ts";
export { EgressGate } from "./egress.ts";

async function access(env: Env, owner: string, repo: string, user: string | null) {
  // A visitor's dig that has expired is gone, swept or not.
  const r = await repoRow(env, owner, repo, "visibility", { liveAt: Date.now() });
  if (!r) return { read: false, write: false, exists: false };
  const collab = user ? await env.DB.prepare("SELECT 1 FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, user).first() : null;
  const write = user === owner || !!collab;
  return { read: r.visibility === "public" || write, write, exists: true };
}

// What a page or agent may ask a file's DO directly; forks and merges go through the branch routes.
const DO_ROUTES = new Set(["file", "ops", "log", "at", "commit", "commits", "ws", "private", "claims", "release"]);

// FTS5 treats punctuation as syntax; quote every word so a search is just words.

const HOURLY = "0 * * * *", MIRRORS = "*/5 * * * *";

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // GET /.well-known/oauth-*  where apps and MCP clients find OAuth sign-in (oauth.ts)
  const known = wellKnown(req, p, url.origin);
  if (known) return known;
  // GET /invite/:token  an invite link: the page for a browser, the steps as text for an agent (invites.ts)
  if (p[0] === "invite" && p[1] && !p[2] && req.method === "GET") return invitePage(req, env, p[1]);
  // GET /install.sh  the CLI in one line, fetched from /cli.js on this site (install.ts)
  if (p[0] === "install.sh" && !p[1] && req.method === "GET") return installScript(url.origin);
  // GET /agent.md  a prompt to hand your own agent so it can steer the site for you (agent-prompt.ts)
  if (p[0] === "agent.md" && !p[1] && req.method === "GET") return agentPromptResponse(url.origin);
  if (p[0] !== "api") return new Response("not found", { status: 404 });
  // GET /api/health, POST /api/watchdog/rolled-back  the watchdog Worker's check and its rollback report (watchdog.ts)
  const dog = await watchdogRoutes(req, env, p);
  if (dog) return dog;
  // A cookie-signed write from another site goes no further (security.ts).
  const foreign = crossSite(req, env);
  if (foreign) return foreign;
  // GET /api  the API reference (src/api.ts), for anyone building their own UI or agent
  if (!p[1] && req.method === "GET") return json(REFERENCE);

  // Rules counted by IP (signing in, signing up, claiming a handle) go before
  // anyone is known; the rest count against the handle.
  const rule = ruleFor(req.method, p), byIp = RULES.find((r) => r.name === rule)?.per === "ip";
  // The edge's in-memory count goes first, so a flood never reaches D1's (security.ts).
  const early = byIp ? (await edgeLimit(req, env, rule!)) ?? (await limit(req, env, rule, null, false)) : null;
  if (early) return early;
  // Sign-up and reset links want Turnstile's answer, when the site has it.
  const bot = wantsTurnstile(req.method, p) ? await turnstile(req, env) : null;
  if (bot) return bot;
  // GET /api/openapi.json  this API, for agents and their gateways (openapi.ts)
  if (p[1] === "openapi.json" && !p[2] && req.method === "GET") return json(openapi(url.origin));
  // POST /api/mcp  the same operations as an MCP server's tools, for a personal API token (mcp.ts)
  // GET /api/mcp/tools  every MCP tool, in words, for the /mcp page
  if (p[1] === "mcp" && p[2] === "tools" && !p[3] && req.method === "GET") return json(catalogue());
  if (p[1] === "mcp" && !p[2]) return mcp(req, url.origin, (r) => { viaMcp.set(r, req); return app.fetch(r, env); });
  // /api/gh/v3/repos/:o/:r/*  GitHub's status and check-run API for external CI, with a repo's CI token, not a personal one (gh-compat.ts)
  const gh = await ghCompatRoutes(req, env, p, url);
  if (gh) return gh;
  // /api/oauth/*  an app signs in as you, and gets tokens like the ones below (oauth.ts)
  const oauth = await oauthRoutes(req, env, p, url);
  if (oauth) return oauth;
  // A personal API token (tokens.ts) stands in for the cookie, and is never an admin.
  const token = await bearer(req, env, p);
  if (token instanceof Response) return token;
  const ident = token ? null : await identityRoutes(req, env, p);
  if (ident) return ident;
  const user = token ? token.user : await timed(req, "identify", () => identify(req, env));
  const admin = !token && isAdmin(env, user);
  callers.set(req, user);
  via.set(req, actingAs.has(req) ? "job" : token ? (token.oauth ? "oauth" : "token") : "cookie");
  if (token && p[1] === "session") return json({ mode: "token", user, token: { id: token.id, label: token.label, scope: token.scope, expires_at: token.expires_at } });
  const slow = byIp ? null : await timed(req, "limit", () => limit(req, env, rule, user, admin, token?.id));
  if (slow) return slow;
  const tokens = await tokenRoutes(req, env, p, user);
  if (tokens) return tokens;
  // GET /api/tokens/audit, /api/repos/:o/:r/audit  the security audit log, yours or a repo's; a deleted repo's too (audit.ts)
  const trail = await auditRoutes(req, env, p, user);
  if (trail) return trail;
  // /api/invites[/:token|/claim]  an invite, and coming in through it as a person or an agent (invites.ts)
  const invites = await inviteRoutes(req, env, p, user);
  if (invites) return invites;
  const limits = await limitRoutes(req, env, p, admin);
  if (limits) return limits;
  const reseal = await resealRoutes(req, env, p, admin);
  if (reseal) return reseal;
  // POST /api/admin/artifacts/copy|rewrite  move the Artifacts namespace (artifact-move.ts, #823)
  const artifactMove = await artifactMoveRoutes(req, env, p, admin);
  if (artifactMove) return artifactMove;
  // GET /api/admin/insights  people vs agents, the site's health, how far each person got (insights.ts)
  const insights = await insightRoutes(req, env, p, url, admin);
  if (insights) return insights;
  // GET /api/admin/actions  this month's GitHub Actions bill: free while it says $0 (actions-bill.ts)
  const actions = await actionsRoutes(req, env, p, user, admin);
  if (actions) return actions;
  // POST /api/admin/scrub {handle}  put @ghost where a deleted account's handle still shows (privacy.ts)
  // POST /api/admin/scrub/backfill {after?}  wake a page of file DOs to note their authors (#770)
  const scrub = await scrubRoutes(req, env, p, admin);
  if (scrub) return scrub;
  // GET /api/admin/scale  the scale sideboard: each wall, how close we are, the next step (scale.ts)
  const scale = await scaleRoutes(req, env, p, admin);
  if (scale) return scale;
  // POST /api/admin/scale/search-embed  one round of the cron's embedding (search.ts)
  const searchAdmin = await searchRoutes(req, env, p, admin);
  if (searchAdmin) return searchAdmin;
  const job = await jobRoutes(req, env, p, user, admin, (r) => app.fetch(r, env));
  if (job) return job;
  const body = <K extends string = never>() => readBody<K>(req);

  const levels = await levelRoutes(req, env, p, url, user, admin);
  if (levels) return levels;
  const mirrors = await mirrorRoutes(req, env, p, user);
  if (mirrors) return mirrors;
  const github = await githubRoutes(req, env, p, user);
  if (github) return github;
  const game = await gameRoutes(req, env, p, url, user, async (o, r) => (await access(env, o, r, user)).read);
  if (game) return game;
  const share = await shareRoutes(req, env, p, user);
  if (share) return share;
  // /api/repos/:o/:r/beams, /api/beams/:id[/patch], /api/me/beams: a branch's stack, cleaned and handed over (beam.ts)
  const beam = await beamRoutes(req, env, p, user, (o, r) => access(env, o, r, user));
  if (beam) return beam;
  const cut = await cutRoutes(req, env, p, url, user);
  if (cut) return cut;
  const agents = await agentRoutes(req, env, p, url, user, (o, r) => access(env, o, r, user), (r) => app.fetch(r, env));
  if (agents) return agents;
  const deps = await depRoutes(req, env, p, url, user, (r) => app.fetch(r, env));
  if (deps) return deps;
  const watch = await watchRoutes(req, env, p, user);
  if (watch) return watch;
  const preview = await previewRoutes(req, env, p, user);
  if (preview) return preview;
  const tried = await tryRoutes(req, env, p, user);
  if (tried) return tried;
  const deploy = await deployRoutes(req, env, p, user);
  if (deploy) return deploy;
  const hooks = await hookRoutes(req, env, p, user);
  if (hooks) return hooks;
  // POST /api/follows, DELETE /api/follows/:id, GET /api/me/following (follows.ts)
  const follows = await followRoutes(req, env, p, user, (o, r) => access(env, o, r, user));
  if (follows) return follows;

  // GET|PUT /api/me/seen, the rev of each file you last saw (seen.ts)
  const seen = await seenRoutes(req, env, p, url, user);
  if (seen) return seen;

  // GET|PUT /api/me/settings, your light/dark choice and the like, in a Durable Object of your own (settings.ts)
  const settings = await settingsRoutes(req, env, p, user);
  if (settings) return settings;

  // GET /api/me/feed and its digest (feed.ts)
  const feed = await feedRoutes(req, env, p, url, user);
  if (feed) return feed;

  // GET /api/users/:name/city(.png), its walkers' socket, and PUT /api/me/city (city.ts)
  const city = await cityRoutes(req, env, p, user);
  if (city) return city;

  // GET /api/me/export and DELETE /api/me: take your data, or bury it (privacy.ts)
  const privacy = await privacyRoutes(req, env, p, url, user, !token && !actingAs.has(req));
  if (privacy) return privacy;

  // POST /api/me/page/revert {to}  put the page back an hour, or to the starter (page.ts)
  // GET /api/users/:name/page[/path]  the profile's page, served as a sandboxed site (page.ts)
  const page = await pageRoutes(req, env, p, user);
  if (page) return page;

  // GET|PUT /api/me
  if (p[1] === "me") {
    if (!user) return json({ error: "sign in first" }, 401);
    let warning: string | undefined;
    if (req.method === "PUT") {
      // Only what's sent changes, so turning the pulse off leaves the bio be.
      const b = await body<"bio" | "theme_html" | "pulse" | "git_truth" | "avatar" | "share_usage">();
      if (b.share_usage !== undefined && typeof b.share_usage !== "boolean") return json({ error: "share_usage: true or false" }, 400);
      if (b.pulse !== undefined && typeof b.pulse !== "boolean") return json({ error: "pulse: true or false" }, 400);
      if (b.git_truth !== undefined && !TRUTHS.includes(b.git_truth as Truth)) return json({ error: `git_truth: ${TRUTHS.join(", ")}` }, 400);
      if ((b.bio !== undefined && typeof b.bio !== "string") || (b.theme_html !== undefined && typeof b.theme_html !== "string")) return json({ error: "bio and theme_html: text" }, 400);
      // avatar: the parts (src/avatar.ts), or null to take it off.
      const avatar = b.avatar === undefined ? null : b.avatar === null ? "" : cleanAvatar(b.avatar);
      if (avatar === null && b.avatar !== undefined) return json({ error: `avatar: every part (${Object.keys(PARTS).join(", ")}), each one of its options, colors as #rrggbb` }, 400);
      await env.DB.prepare("UPDATE users SET bio = COALESCE(?, bio), theme_html = COALESCE(?, theme_html), pulse = COALESCE(?, pulse), git_truth = COALESCE(?, git_truth), avatar = COALESCE(?, avatar), share_usage = COALESCE(?, share_usage) WHERE name = ?")
        .bind(b.bio ?? null, b.theme_html ?? null, b.pulse === undefined ? null : b.pulse ? 1 : 0, b.git_truth ?? null, avatar === null ? null : avatar === "" ? "" : JSON.stringify(avatar), b.share_usage === undefined ? null : b.share_usage ? 1 : 0, user).run();
      // Saying no (or changing your mind) takes back what was shared (usage.ts).
      if (b.share_usage === false) await forget(env, user).run();
      // A public page repo wins over the saved theme_html, so saving it would otherwise change nothing you can see.
      if (b.theme_html && await hasPage(env, user)) warning = "theme_html saved, but your public page repo is shown instead; edit the repo's index.html, or make the repo private";
    }
    // ask_usage: a private-repo owner who hasn't answered yet gets the "help improve" modal (usage.ts).
    return json({ ...(await env.DB.prepare("SELECT * FROM users WHERE name = ?").bind(user).first()), ask_usage: await askUsage(env, user), ...(warning && { warning }) });
  }

  // GET /api/users/:name/(pulse|pulse.png|share) and /api/pulse: heartbeats (pulse.ts)
  const pulse = await pulseRoutes(req, env, p, url, user);
  if (pulse) return pulse;

  // GET /api/users/:name  profile, the repos you may see, playlists, how many it follows and are following it, the stamps it gave and got;
  // an agent's (agent-…) also says who runs it, where, and its runs (actors.ts)
  if (p[1] === "users" && p[2]) {
    const row = await env.DB.prepare("SELECT name, bio, theme_html, pulse, city_public, tier, avatar FROM users WHERE name = ?").bind(p[2]).first();
    if (!row) return json({ error: "no such user" }, 404);
    const u = { ...row, tier: tierById(row.tier) };
    const { results: repos } = await env.DB.prepare(
      "SELECT owner, name, visibility, level, created_at, expires_at FROM repos WHERE owner = ? AND (visibility = 'public' OR owner = ?) AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC").bind(p[2], user, Date.now()).all();
    const { results: playlists } = await env.DB.prepare("SELECT * FROM playlists WHERE owner = ? ORDER BY id DESC").bind(p[2]).all();
    const [given, got, agent] = await Promise.all([recentStamps(env, user, p[2], "by"), recentStamps(env, user, p[2], "author"),
      isAgentHandle(p[2]) ? agentProfile(env, p[2], user) : null]);
    // What it follows in a private repo counts only for that repo's crew.
    return json({ user: u, page: await hasPage(env, p[2], row.theme_html as string | null), repos, playlists, following: (await listFollows(env.DB, p[2], user)).length, followers: await followers(env.DB, p[2]), stamps: { given, got }, ...(agent && { agent }) });
  }

  // POST /api/repos {name, visibility}
  if (p[1] === "repos" && !p[2] && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    const { name, visibility = "public" } = await body<"name" | "visibility">();
    if (typeof name !== "string" || !NAME.test(name)) return json({ error: "bad repo name" }, 400);
    if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
    await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, branch) VALUES (?, ?, ?, ?, 'main')").bind(user, name, visibility, Date.now()).run();
    if (env.ARTIFACTS) {
      // One artifact repo per excavation; "--" can't appear in either name, so it can't collide.
      const art = await env.ARTIFACTS.create(`${user}--${name}`, { description: `codeSplitter ${user}/${name}`, setDefaultBranch: "main" });
      await env.DB.prepare("UPDATE repos SET artifact = ?, artifact_remote = ? WHERE owner = ? AND name = ?").bind(art.name, art.remote, user, name).run();
      // On the desktop its git takes pushes from the start: land them from here on (#788).
      await seeGit(env, user, name);
    }
    return json({ owner: user, name, visibility }, 201);
  }

  if (p[1] === "repos" && p[2] && p[3]) {
    const [owner, repo] = [p[2], p[3]];
    const a = await access(env, owner, repo, user);
    // A private repo you can't see looks the same as one that doesn't exist.
    if (!a.read) return json({ error: "not found" }, 404);

    // GET /api/repos/:o/:r
    if (!p[4] && req.method === "GET") {
      const r = await repoRow(env, owner, repo, "owner, name, visibility, level, branch, upstream, upstream_commit, upstream_tip, upstream_behind, upstream_heard_at, created_at, expires_at, mirror_url IS NOT NULL AS mirror, mirror_pull_only IS 1 AS pullOnly");
      const { results: collaborators } = await env.DB.prepare("SELECT name FROM collaborators WHERE owner = ? AND repo = ?").bind(owner, repo).all();
      // Anyone who can read the repo can clone its artifact, with an hour-long read token;
      // the crew also gets their own remote's, with private lines' real text, once there is one.
      const h = await handleFor(env, owner, repo).catch(() => null);
      const art = h && await artifactAccess(h.handle, h.remote, "read", 3600).catch(() => null);
      const clone = art && `git clone ${art.remote.replace("://", `://x:${art.token.split("?")[0]}@`)} ${repo}`;
      const ch = a.write ? await handleFor(env, owner, repo, true).catch(() => null) : null;
      const crewArt = ch?.crew ? await artifactAccess(ch.handle, ch.remote, "read", 3600).catch(() => null) : null;
      const crewClone = crewArt && `git clone ${crewArt.remote.replace("://", `://x:${crewArt.token.split("?")[0]}@`)} ${repo}`;
      // Where the fork's git lives: a bare repo on this machine, or Cloudflare Artifacts.
      const home = h ? (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(art?.remote ?? h.remote) ? "local" : "cloud") : null;
      // On the desktop the owner can push back too (#464): the bare repo is a remote for their own tools, with a
      // day-long write token (gone when the app restarts). Not with private lines, which that git holds blank.
      const wa = home === "local" && user === owner && !ch?.crew && !token ? await artifactAccess(h!.handle, h!.remote, "write", 86400).catch(() => null) : null;
      const push = wa && `git remote add codesplitter ${wa.remote.replace("://", `://x:${wa.token.split("?")[0]}@`)}`;
      // The owner sees who's invited but not in yet, beside the crew.
      const invites = user === owner ? { invites: await pendingInvites(env, owner, repo) } : {};
      // Files a push to that git clashed with, whose commit here waits on the owner's pick (#788).
      const pushClash = home === "local" && a.write ? Object.keys((await pushClashes(env, owner, repo)).clashes) : [];
      // A fork the owner dug up here could be a two-way mirror (#875): the About panel offers it.
      const mirrorable = user === owner && !r?.mirror && mirrorsOn(env) && !!r?.upstream_commit && !!upstreamRemote(r?.upstream as string | null);
      return json({ ...r, mirror: !!r?.mirror, pullOnly: !!r?.pullOnly, ...(mirrorable && { mirrorable }), collaborators: collaborators.map((c: any) => c.name), canWrite: a.write, clone, crewClone, home, ...(push && { push }), ...(pushClash.length && { pushClash }), ...invites });
    }
    // PUT /api/repos/:o/:r {visibility}  (owner only)
    if (!p[4] && req.method === "PUT") {
      if (user !== owner) return json({ error: "owner only" }, 403);
      const { visibility } = await body<"visibility">();
      if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
      await env.DB.prepare("UPDATE repos SET visibility = ? WHERE owner = ? AND name = ?").bind(visibility, owner, repo).run();
      // The vector index's tags follow on the next hourly embed; search checks D1 till then.
      await restaleSearch(env, owner, repo).catch(() => null);
      await audit(env, req, { actor: user, action: "repo.visibility", owner, repo, detail: visibility });
      return json({ visibility });
    }
    // DELETE /api/repos/:o/:r?confirm=:r  (owner only) the repo and everything of it here: rows, file DOs, git.
    // GitHub never hears, and a stack it deployed stays up.
    if (!p[4] && req.method === "DELETE") {
      if (user !== owner) return json({ error: "owner only" }, 403);
      if (url.searchParams.get("confirm") !== repo) return json({ error: `to delete it, confirm with its name: ?confirm=${repo}` }, 400);
      await evict(env, owner, repo);
      await audit(env, req, { actor: user, action: "repo.delete", owner, repo });
      return json({ deleted: `${owner}/${repo}` });
    }
    // POST /api/repos/:o/:r/shares {path, from, to, note}  a live link to some lines
    if (p[4] === "shares" && req.method === "POST") {
      const v = await repoRow(env, owner, repo, "visibility");
      return createShare(env, owner, repo, user, a, v?.visibility === "private", await body());
    }
    // GET|POST|DELETE /api/repos/:o/:r/stamps  react to lines, by id (stamps.ts)
    const stamps = await stampRoutes(req, env, p, url, owner, repo, user, a);
    if (stamps) return stamps;
    // POST /api/repos/:o/:r/cuts {pieces: [{path, from, to}], note}  some lines and their imports, as a branch to run and merge back
    if (p[4] === "cuts" && req.method === "POST") return createCut(env, owner, repo, user, a.write, await body());
    // GET /api/repos/:o/:r/git-state  mirror, push, pull, uncommitted files and clashes, in one answer (git-state.ts)
    if (p[4] === "git-state" && req.method === "GET") return json(await gitState(env, owner, repo));
    // GET /api/repos/:o/:r/fit[?dir=apps/web]  how easily Rusty Buns could box it, or one app in it
    if (p[4] === "fit" && req.method === "GET") return repoFit(env, (r) => app.fetch(r, env), url.origin, owner, repo, user, url.searchParams.get("dir") ?? "");
    // GET /api/repos/:o/:r/share[?branch=&ttl=]  a git clone line with a read token that lasts ttl seconds (a day by default, a week at most), to hand to someone
    if (p[4] === "share" && !p[5] && req.method === "GET") {
      const branch = url.searchParams.get("branch");
      if (branch && !/^[\w][\w./-]*$/.test(branch)) return json({ error: "that isn't a branch name" }, 400);
      const ttl = Math.max(60, Math.min(SHARE_MAX_S, Math.floor(Number(url.searchParams.get("ttl"))) || SHARE_DEFAULT_S));
      const h = await handleFor(env, owner, repo).catch(() => null);
      if (!h) return json({ error: "this repo has no git to share" }, 409);
      const art = await artifactAccess(h.handle, h.remote, "read", ttl);
      return json({ command: `git clone${branch ? ` -b ${branch}` : ""} ${art.remote.replace("://", `://x:${art.token.split("?")[0]}@`)} ${repo}`, ttl, expiresAt: Date.now() + ttl * 1000, ...(branch && { branch }) });
    }
    // GET /api/repos/:o/:r/graph[?limit=60]  main's commits, newest first, with the branches merged into them, each upstream's or this copy's
    if (p[4] === "graph" && !p[5] && req.method === "GET") {
      const r = await repoRow(env, owner, repo, "upstream_commit");
      const limit = Math.max(1, Math.min(GRAPH_MAX, Number(url.searchParams.get("limit")) || 60));
      try {
        const h = await handleFor(env, owner, repo);
        if (!h) return json({ branch: "main", commits: [], more: false, upstream: null });
        return json(await sharedGraph(`${owner}/${repo}/${h.branch}/${(r?.upstream_commit as string) ?? ""}`, (n) => commitGraph(h.handle, h.branch, (r?.upstream_commit as string) ?? null, n), limit));
      } catch (e) {
        if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ forking: true, commits: [] }, 202);
        if (code(e) === "NOT_FOUND") return json({ lost: true, commits: [] });
        throw e;
      }
    }
    // GET /api/repos/:o/:r/gitpath[?path=&limit=]  gitpath's data: a file's commits with parents and line counts, or the busiest files (gitpath-data.ts)
    if (p[4] === "gitpath" && !p[5] && req.method === "GET") {
      const path = (url.searchParams.get("path") ?? "").replace(/^\/+|\/+$/g, "");
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || (path ? 100 : 60)));
      try {
        const h = await handleFor(env, owner, repo);
        if (!h) return json({ repo: `${owner}/${repo}`, ...(path ? { path, commits: [] } : { files: [] }) });
        // A repo dug from GitHub has only its import in its own git; what came before is read from GitHub (gitpath-upstream.ts).
        const r = await repoRow(env, owner, repo, "upstream, upstream_commit, branch") as UpstreamRepo | null;
        const token = (await githubToken(env, user).catch(() => null))?.token;
        if (path) {
          const own = await fileHistory(h.handle, h.branch, path, limit);
          const before = own.more ? null : await upstreamFileHistory(r, path, limit - own.commits.length, token);
          return json({ repo: `${owner}/${repo}`, ...own, commits: before ? joinHistory(own.commits, before.commits) : own.commits, more: own.more || !!before?.more });
        }
        const own = await busiestFiles(h.handle, h.branch, limit, 100);
        const before = own.more ? null : await upstreamBusiest(r, token);
        const counts = new Map(own.files.map((f) => [f.path, f.commits]));
        for (const [f, n] of before ?? []) counts.set(f, (counts.get(f) ?? 0) + n);
        const files = [...counts].map(([path, commits]) => ({ path, commits })).sort((x, y) => y.commits - x.commits || (x.path < y.path ? -1 : 1)).slice(0, 12);
        return json({ repo: `${owner}/${repo}`, branch: own.branch, files, more: own.more });
      } catch (e) {
        if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ forking: true, commits: [], files: [] }, 202);
        if (code(e) === "NOT_FOUND") return json({ lost: true, commits: [], files: [] });
        throw e;
      }
    }
    // GET|POST /api/repos/:o/:r/tags, DELETE .../tags/:name  the repo's tags, made and deleted (tags.ts)
    if (p[4] === "tags") { const r = await tagRoutes(req, env, p, owner, repo, user); if (r) return r; }
    // POST /api/repos/:o/:r/commits/:sha/revert {branch?}  a commit undone, as line edits (pick.ts)
    // POST /api/repos/:o/:r/commits/:sha/pick {branch?}  a commit taken again, onto main or an open branch
    if (p[4] === "commits" && p[5] && (p[6] === "revert" || p[6] === "pick") && !p[7] && req.method === "POST") {
      if (!a.write) return json({ error: "no write access" }, 403);
      const picked = (await req.clone().json().catch(() => ({})) as { branch?: unknown }).branch;
      if (!picked || picked === "main") { const closed = await mainClosed(env, owner, repo, user); if (closed) return closed; }
      return pickRoute(env, owner, repo, user!, p[6], p[5], await req.json().catch(() => ({})) as { branch?: unknown });
    }
    // GET /api/repos/:o/:r/tree?path=dir[&branch=b]  the repo's git tree, plus files written here but not catalogued yet
    if (p[4] === "tree") {
      const dir = (url.searchParams.get("path") ?? "").replace(/^\/|\/$/g, "");
      let entries: { name: string; path: string; type: string }[] = [], commit = null, h: Awaited<ReturnType<typeof handleFor>> = null;
      try {
        h = await handleFor(env, owner, repo);
        if (h) {
          const listing = await listDir(env, h.handle, h.branch, dir);
          if (listing.entries) entries = listing.entries;
          commit = listing.commit && { hash: listing.commit.hash, message: listing.commit.message.split("\n")[0] };
        }
      } catch (e) {
        if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ forking: true, entries: [] }, 202);
        if (code(e) === "NOT_FOUND") return json({ lost: true, entries: [] });   // a clone that never landed
        throw e;
      }
      const under = (dir ? dir.replace(/[%_\\]/g, "\\$&") + "/" : "") + "%";
      const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? AND path LIKE ? ESCAPE '\\'").bind(owner, repo, under).all();
      // ?branch=: the branch's own files show too, and the ones it deleted don't (#734); so do the files of the
      // branches it's stacked on, nearest first, so its own rows win, then its parent's, and so on (#1039).
      const branch = url.searchParams.get("branch");
      const own: { path: string; deleted: number }[] = [];
      if (branch && await openBranch(env, owner, repo, branch)) {
        const had = new Set<string>();
        for (const b of [branch, ...await ancestors(env, owner, repo, branch)])
          for (const f of (await env.DB.prepare("SELECT path, deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND path LIKE ? ESCAPE '\\'").bind(owner, repo, b, under).all()).results as { path: string; deleted: number }[])
            if (!had.has(f.path)) { had.add(f.path); own.push(f); }
      }
      const gone = new Set(own.filter((f) => f.deleted).map((f) => f.path));
      entries = entries.filter((e) => !gone.has(e.path));
      // A folder in git the branch deleted every file of goes too (files written here put it back below).
      const emptied = async (d: string): Promise<boolean> => {
        if (![...gone].some((g) => g.startsWith(d + "/"))) return false;
        for (const e of (await listDir(env, h!.handle, h!.branch, d)).entries ?? [])
          if (e.type === "dir" ? !(await emptied(e.path)) : !gone.has(e.path)) return false;
        return true;
      };
      if (gone.size && h) for (const e of [...entries]) if (e.type === "dir" && await emptied(e.path).catch(() => false)) entries.splice(entries.indexOf(e), 1);
      const seen = new Set(entries.map((e) => e.name));
      for (const { path } of [...results as { path: string }[], ...own.filter((f) => !f.deleted)]) {
        if (gone.has(path)) continue;
        const rest = dir ? path.slice(dir.length + 1) : path, name = rest.split("/")[0]!;
        if (seen.has(name)) continue;
        seen.add(name);
        entries.push({ name, path: dir ? `${dir}/${name}` : name, type: rest.includes("/") ? "dir" : "file" });
      }
      return json({ commit, entries });
    }
    // POST /api/repos/:o/:r/pushes {path, take: "mine" | "pushed"}  settle a push that clashed with edits here (#788)
    if (p[4] === "pushes" && !p[5] && req.method === "POST") {
      if (user !== owner) return json({ error: "owner only" }, 403);
      const { path, take } = await body<"path" | "take">();
      if (typeof path !== "string" || !path || (take !== "mine" && take !== "pushed")) return json({ error: "{path, take: \"mine\" | \"pushed\"}, please" }, 400);
      if (!(await settlePush(env, owner, repo, path, take))) return json({ error: `no push clashes with ${path}` }, 404);
      return json({ ok: true });
    }
    // GET|POST /api/repos/:o/:r/mirror  where a mirror stands with upstream; sync it now (mirror.ts)
    if (p[4] === "mirror" && !p[5]) return mirrorRepoRoute(req, env, owner, repo, user);
    // GET|POST /api/repos/:o/:r/mirror/turn  (owner) a dug fork, turned into a two-way mirror (#875)
    if (p[4] === "mirror" && p[5] === "turn" && !p[6]) return turnRoute(req, env, owner, repo, user);
    // GET|POST /api/repos/:o/:r/mirror/branches[/:b/pull|push]  upstream's branches, opened here; ours, pushed there
    if (p[4] === "mirror") { const r = await mirrorBranchRoute(req, env, p, owner, repo, user); if (r) return r; }
    // GET|POST /api/repos/:o/:r/mirror/tags[/:name/push]  upstream's tags, fetched here; ours, pushed there
    if (p[4] === "mirror") { const r = await mirrorTagRoute(req, env, p, owner, repo, user); if (r) return r; }
    // GET /api/repos/:o/:r/upstream, POST .../upstream/hear|take  a dug fork listens to its upstream (listen.ts)
    if (p[4] === "upstream") { const r = await listenRoute(req, env, p, owner, repo, user); if (r) return r; }
    // GET|POST /api/repos/:o/:r/worktrees, DELETE .../worktrees/:name  real checkouts off the desktop's bare git (worktrees.ts)
    if (p[4] === "worktrees") { const r = await worktreeRoute(req, env, p, owner, repo, user); if (r) return r; }
    const fresh = await freshRoutes(req, env, p, url, owner, repo, user);
    if (fresh) return fresh;
    const branches = await branchRoutes(req, env, p, owner, repo, user, a);
    if (branches) return branches;
    // /api/repos/:o/:r/checks/tokens[/:id]  the repo's CI tokens, for external CI (gh-compat.ts)
    const ciTokens = await ciTokenRoutes(req, env, p, owner, repo, user);
    if (ciTokens) return ciTokens;
    // /api/repos/:o/:r/checks[/run|github|settings|:id[/cancel]]  check runs, ours and GitHub's (checks.ts)
    const checks = await checkRoutes(req, env, p, url, owner, repo, user, a);
    if (checks) return checks;
    // POST /api/repos/:o/:r/collaborators {name}  (owner only; this is how agents get in)
    if (p[4] === "collaborators" && req.method === "POST") {
      if (user !== owner) return json({ error: "owner only" }, 403);
      const { name } = await body<"name">();
      if (typeof name !== "string" || !NAME.test(name)) return json({ error: "bad name" }, 400);
      // A person has to have signed up first, so adding one never takes a handle nobody chose.
      // agent- handles are ours to give (no person can pick one): a hosted agent comes in this way.
      if (isAgentHandle(name)) await env.DB.prepare("INSERT OR IGNORE INTO users (name, created_at) VALUES (?, ?)").bind(name, Date.now()).run();
      else if (!(await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(name).first())) return json({ error: `no one's @${name} here yet: send them an invite link` }, 404);
      const r = await env.DB.prepare("INSERT OR IGNORE INTO collaborators (owner, repo, name) VALUES (?, ?, ?)").bind(owner, repo, name).run();
      if (r.meta?.changes) await audit(env, req, { actor: user, action: "crew.add", owner, repo, target: name });
      return json({ ok: true });
    }
    // DELETE /api/repos/:o/:r/collaborators/:name  (owner only) out of the crew; what they wrote stays theirs
    if (p[4] === "collaborators" && p[5] && !p[6] && req.method === "DELETE") {
      if (user !== owner) return json({ error: "owner only" }, 403);
      const r = await env.DB.prepare("DELETE FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, p[5]).run();
      if (!r.meta?.changes) return json({ error: `@${p[5]} isn't in the crew` }, 404);
      // An agent's token for this repo goes with it.
      await env.DB.prepare("DELETE FROM api_tokens WHERE name = ? AND repo = ?").bind(p[5], `${owner}/${repo}`).run();
      await audit(env, req, { actor: user, action: "crew.remove", owner, repo, target: p[5] });
      return json({ ok: true });
    }
    // GET|PUT /api/repos/:o/:r/protect  keep crew and agents off main (protect.ts)
    if (p[4] === "protect" && !p[5]) return protectRoute(req, env, owner, repo, user);
    // /api/repos/:o/:r/invites[/:token]  invite by handle, email or a bare link; the pending ones; revoke (invites.ts)
    const invites = await repoInviteRoutes(req, env, p, owner, repo, user);
    if (invites) return invites;
    // POST /api/repos/:o/:r/files {path, content, branch?}
    if (p[4] === "files" && req.method === "POST") {
      if (!a.write) return json({ error: "no write access" }, 403);
      const { path, content = "", branch } = await body<"path" | "content" | "branch">();
      if (typeof path !== "string" || !path || path.length > 200 || path.includes("..") || path.startsWith("/")) return json({ error: "bad path" }, 400);
      if (typeof content !== "string" || (branch !== undefined && typeof branch !== "string")) return json({ error: "content and branch: text" }, 400);
      if (branch) {
        if (!(await openBranch(env, owner, repo, branch))) return json({ error: "no open branch " + branch }, 404);
        return createOn(env, owner, repo, branch, path, content, user!);
      }
      const closed = policyClosed(owner, path, user) ?? await mainClosed(env, owner, repo, user);
      if (closed) return closed;
      const r = await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, path).run();
      if (!r.meta?.changes) return json({ error: "file exists" }, 409);
      await toFile(env, owner, repo, path, user!, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(content) }) });
      return json({ path }, 201);
    }
    // /api/repos/:o/:r/do/(file|ops|log|at|commit|commits|ws|private|claims|release)?path=...&branch=...  -> the file's DO, or its copy on a branch
    if (p[4] === "do" && DO_ROUTES.has(p[5] ?? "")) {
      const path = url.searchParams.get("path") ?? "", branch = url.searchParams.get("branch") || undefined;
      if (branch && !(await openBranch(env, owner, repo, branch))) return json({ error: "no open branch " + branch }, 404);
      // A branch catalogues when it merges into main, not before.
      if (branch && p[5] === "commit") return json({ error: "merge the branch, then commit main" }, 400);
      if (branch && p[5] === "private") return json({ error: "mark lines private on main" }, 400);
      const m = branch ? await materializeOn(env, owner, repo, branch, path) : await materialize(env, owner, repo, path);
      if ("error" in m) return json({ error: m.error }, m.status);
      const writes = p[5] === "ops" || p[5] === "commit" || ((p[5] === "private" || p[5] === "claims" || p[5] === "release") && req.method === "POST");
      if (writes && !a.write) return json({ error: "no write access" }, 403);
      if (writes && !branch) { const closed = await mainClosed(env, owner, repo, user); if (closed) return closed; }
      if ((writes || p[5] === "ws") && !branch && a.write) { const closed = policyClosed(owner, path, user); if (closed) return closed; }
      // On the desktop, a push to the repo's git from outside reaches main's files when they're opened or
      // committed, so a commit here never writes their old lines back over it (#773).
      if (!branch && (p[5] === "commit" || (p[5] === "file" && req.method === "GET")) && mirrorsOn(env)) await landPushes(env, owner, repo).catch(() => {});
      // One whose edits here clashed with a push waits for the owner to pick a side, so it can't undo the push (#788).
      if (!branch && p[5] === "commit" && mirrorsOn(env) && await pushHolds(env, owner, repo, path))
        return json({ error: `a push to this repo's git changed the same lines as edits here: keep yours or take the pushed ones, then commit`, pushClash: path }, 409);
      // Hiding lines is the crew's; showing them again (to git and search on the next commit) the owner's.
      const sent = writes ? await req.text() : undefined;
      if (p[5] === "private" && req.method === "POST") {
        const on = (() => { try { return (JSON.parse(sent!) as { private?: unknown }).private; } catch { return undefined; } })();
        if (typeof on !== "boolean") return json({ error: "{lines, private: true|false}, please" }, 400);
        if (!on && user !== owner) return json({ error: "only the owner makes private lines public" }, 403);
      }
      // No waiting in line here while holding lines in another file: that's how two waiters end up
      // waiting on each other for ever. The file itself refuses it for lines held in it (file-do.ts).
      if (p[5] === "claims" && req.method === "POST" && user) {
        const b = (() => { try { return JSON.parse(sent!) as { wait?: unknown; soft?: unknown }; } catch { return {}; } })();
        const holding = b.wait && !b.soft ? await heldElsewhere(env, user, [owner, repo, path]) : [];
        if (holding.length) return json({ error: `you hold lines in ${holding.map((h) => h.path).join(", ")}: let go of them before you wait in line here, or work elsewhere`, holding }, 409);
      }
      // How the path takes live edits (#1011), read as the merge reads it: main's .gitattributes over the defaults.
      const pol = (p[5] === "ops" || p[5] === "ws" || (p[5] === "claims" && req.method === "POST")) && a.write ? await pathPolicy(env, owner, repo, path, user!) : undefined;
      const live = pol?.live;
      // A repo that ranks its agents (codesplitter-order=rank) lets a higher rank step ahead of lower ones in line.
      const rank = pol?.order === "rank" && p[5] === "claims" ? String(rankOf(pol.rank, user ?? "anon")) : undefined;
      if (p[5] === "ws") {
        // The DO learns who this socket is, and whether it may write, from us.
        const h = new Headers(req.headers);
        h.set("x-codesplitter-user", user ?? "anon");
        h.set("x-codesplitter-write", a.write ? "1" : "0");
        h.set("x-codesplitter-crew", a.write ? "1" : "0");
        live ? h.set("x-codesplitter-live", live) : h.delete("x-codesplitter-live");
        branch ? h.delete("x-codesplitter-file") : h.set("x-codesplitter-file", encodeURIComponent(JSON.stringify([owner, repo, path])));
        // A branch's copy learns which branch it is, to stamp when the branch last changed (checks.ts).
        branch ? h.set("x-codesplitter-branch", encodeURIComponent(JSON.stringify([owner, repo, branch]))) : h.delete("x-codesplitter-branch");
        // Its edits count against the edit limit, as the HTTP ones do (the DO counts them).
        const as = a.write ? counted(req, "edit", user, admin) : null;
        as ? h.set("x-codesplitter-limit-as", as) : h.delete("x-codesplitter-limit-as");
        // A socket from the internet notes its first edit as the person's "wrote code" step (insights.ts).
        a.write && user && req.headers.has("cf-connecting-ip") ? h.set("x-codesplitter-step-as", user) : h.delete("x-codesplitter-step-as");
        return fileStub(env, owner, repo, path, branch).fetch(new Request(req.url, { headers: h }));
      }
      // Only the crew reads private lines; everyone else gets placeholders.
      const res = await toFile(env, owner, repo, path, user ?? "anon", p[5]!, { method: req.method, body: sent, headers: { "x-codesplitter-crew": a.write ? "1" : "0", ...(live && { "x-codesplitter-live": live }), ...(rank !== undefined && { "x-codesplitter-rank": rank }) } },
        url.searchParams.has("rev") ? `?rev=${url.searchParams.get("rev")}` : url.searchParams.has("since") ? `?since=${url.searchParams.get("since")}` : p[5] === "file" && (url.searchParams.has("from") || url.searchParams.has("limit")) ? `?${new URLSearchParams([...url.searchParams].filter(([k]) => k === "from" || k === "limit"))}` : "", branch);
      if (p[5] === "private" && req.method === "POST" && res.ok) {
        // From the first private line on, the crew has a remote of its own to clone and deploy from.
        if ((JSON.parse(sent!) as { private?: boolean }).private) await ensureCrewRemote(env, owner, repo).catch(() => null);
        // Open branches' copies of the file hide the same lines.
        const { results } = await env.DB.prepare("SELECT b.name FROM branch_files f JOIN branches b ON b.owner = f.owner AND b.repo = f.repo AND b.name = f.branch WHERE f.owner = ? AND f.repo = ? AND f.path = ? AND b.status = 'open'").bind(owner, repo, path).all();
        for (const { name } of results as { name: string }[]) await toFile(env, owner, repo, path, user!, "private", { method: "POST", body: sent }, "", name);
        return res;
      }
      if (p[5] === "commit" && res.ok) {
        // Index what was committed, not every keystroke; git and search get private lines blank,
        // the crew's remote the real text.
        const { commit, content, published } = (await res.json()) as { commit: { message: string; writers?: string[] }; content: string; published: string };
        await indexFile(env, owner, repo, path, published);
        await env.DB.prepare("DELETE FROM uncommitted WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, path).run().catch(() => {});
        // The catalogue entry stands even if the push fails; the next push that lands carries it,
        // and if git is full, it starts fresh (fresh.ts) and the file lands there.
        const git = await pushCatalogue(env, owner, repo, path, { content, published }, user!, commit.message).catch((e: Error) => ({ error: e.message }));
        await startIfFull(env, owner, repo).catch(() => null);
        // The owner's own commit ships, when they turned that on (deploy.ts).
        if (git && !("error" in git)) {
          await emit(env, owner, repo, "commit", user!, {
            ref: "refs/heads/main", before: git.parent ?? "0".repeat(40), after: git.commit, created: !git.parent, pusher: { name: user },
            head_commit: { id: git.commit, message: commit.message, timestamp: new Date().toISOString(), author: { name: user, username: user }, added: git.parent ? [] : [path], modified: git.parent ? [path] : [], removed: [] },
          });
          // The owner's commit of a file only they edited since its last commit: a hosted deploy may run it (deploy-review.ts).
          if (user === owner && !user.startsWith("agent-") && git.deployCommit && commit.writers?.every((w) => w === owner)) await clearOwn(env, owner, repo, git.deployCommit);
          await deployOnCommit(env, owner, repo, user);
          await startChecks(env, owner, repo, "main", git.commit, user!);
          // A mirror hands the commit upstream now, if upstream's there to take it.
          await kickMirror(env, owner, repo);
        }
        return json({ ...commit, git });
      }
      return res;
    }
  }

  // GET /api/search?q=[&repo=owner/name]  committed code you are allowed to see, in one repo or across them (search.ts)
  if (p[1] === "search") {
    const q = url.searchParams.get("q") ?? "", only = url.searchParams.get("repo");
    if (!only) return json(await searchAll(env, user, q));
    const [o, r] = only.split("/");
    if (!o || !r || !(await access(env, o, r, user)).read) return json({ error: "not found" }, 404);
    return json(await searchRepo(env, o, r, q));
  }

  // POST /api/playlists {title}
  if (p[1] === "playlists" && !p[2] && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    const { title } = await body<"title">();
    if (typeof title !== "string" || !title.trim()) return json({ error: "title required" }, 400);
    const r = await env.DB.prepare("INSERT INTO playlists (owner, title) VALUES (?, ?) RETURNING id").bind(user, title.trim().slice(0, 80)).first();
    return json({ id: r.id, owner: user, title }, 201);
  }
  // POST /api/playlists/:id/tracks {owner, repo, path, from, to, note}
  if (p[1] === "playlists" && p[2] && p[3] === "tracks" && req.method === "POST") {
    const pl = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(Number(p[2])).first();
    if (!pl || pl.owner !== user) return json({ error: "not your playlist" }, 403);
    const t = await body<"owner" | "repo" | "path" | "from" | "to" | "note">();
    if (typeof t.owner !== "string" || typeof t.repo !== "string" || typeof t.path !== "string" || typeof t.from !== "number" || typeof t.to !== "number"
      || (t.note !== undefined && typeof t.note !== "string")) return json({ error: "owner, repo, path, from and to required" }, 400);
    if (!(await access(env, t.owner, t.repo, user)).read) return json({ error: "not found" }, 404);
    const m = await materialize(env, t.owner, t.repo, t.path);
    if ("error" in m) return json({ error: m.error }, m.status);
    const from = Math.max(1, Math.floor(t.from)), to = Math.max(from, Math.floor(t.to));
    const doc = await (await toFile(env, t.owner, t.repo, t.path, user!, "file")).json() as { lines?: { id: string }[] };
    const first = doc.lines?.[from - 1], last = doc.lines?.[Math.min(to, doc.lines.length) - 1];
    if (!first || !last) return json({ error: "no such lines" }, 400);
    await env.DB.prepare("INSERT INTO tracks (playlist, owner, repo, path, from_line, to_line, from_id, to_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pl.id, t.owner, t.repo, t.path, from, to, first.id, last.id, (t.note ?? "").slice(0, 280)).run();
    return json({ ok: true }, 201);
  }
  // GET /api/playlists/:id  each track with its lines as they are now
  if (p[1] === "playlists" && p[2] && req.method === "GET") {
    const pl = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(Number(p[2])).first();
    if (!pl) return json({ error: "not found" }, 404);
    const { results } = await env.DB.prepare("SELECT * FROM tracks WHERE playlist = ? ORDER BY id").bind(pl.id).all();
    const tracks = await Promise.all(results.map(async (t: any) => {
      // A track pointing into a repo that went private just disappears for you; private lines are placeholders unless you're crew.
      const can = await access(env, t.owner, t.repo, user);
      if (!can.read) return null;
      const doc = await (await toFile(env, t.owner, t.repo, t.path, user ?? "anon", "file", { headers: { "x-codesplitter-crew": can.write ? "1" : "0" } })).json() as { lines: { id: string; text: string; by: string }[] };
      // Follow the lines by id; if either end was deleted, fall back to the numbers.
      const i = doc.lines.findIndex((l) => l.id === t.from_id), j = doc.lines.findIndex((l) => l.id === t.to_id);
      const [a, b] = i >= 0 && j >= i ? [i, j + 1] : [t.from_line - 1, t.to_line];
      return { ...t, from_line: a + 1, to_line: b, lines: doc.lines.slice(a, b) };
    }));
    return json({ ...pl, tracks: tracks.filter(Boolean) });
  }

  return json({ error: "not found" }, 404);
}

const app = {
  // Each answer to the internet is tallied for the admins' insights page (insights.ts), after it's sent.
  async fetch(req: Request, env: Env, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    hearPushes(env);
    const start = performance.now(), p = new URL(req.url).pathname.split("/").filter(Boolean);
    // Signing in or out, claiming a handle or deleting the account forgets the cookie's cached handle, before and after (identity.ts).
    const churn = p[0] === "api" && changesSession(req.method, p);
    if (churn) forgetSession(req, env);
    let res: Response;
    try { res = secured(await route(req, env)); }
    catch (e) { if (churn) forgetSession(req, env); if (tallied(req)) { const t = record(env, req, 500, !!ctx); if (ctx) ctx.waitUntil(t); else await t; } throw e; }
    if (churn) forgetSession(req, env);
    if (tallied(req)) { const t = record(env, req, res.status, !!ctx); if (ctx) ctx.waitUntil(t); else await t; }
    return p[0] === "api" ? withTiming(req, res, start) : res;
  },

  // The Cron Triggers (rustybuns.config.ts crons). Hourly: each repo's dependency doctor runs
  // when it's due, the supply-chain watch looks around, each fresh start under way takes its steps, rate-limit windows that have ended are cleared out, and any queued request
  // whose message went missing runs if its line has room.
  async scheduled(c: { cron?: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // Every five minutes on the desktop, mirrors whose turn has come sync with upstream (mirror.ts).
    // Shas sent up to GitHub get their Actions results polled in (checks.ts).
    // The desktop runs any checks still queued here (ci-runner.ts).
    // Pushes are heard from the first tick, should no request have come in since the app started (#788).
    hearPushes(env);
    if (c.cron === MIRRORS) { if (mirrorsOn(env)) ctx.waitUntil(syncDue(env).then(() => pollGithub(env))); if (desktopRuns(env)) ctx.waitUntil(kickQueued(env)); return; }
    if (c.cron !== HOURLY) return;
    ctx.waitUntil(scheduledDoctor(env, (r) => app.fetch(r, env)));
    // The supply-chain watch: agent platforms' status pages, and new malicious-package advisories against every repo (watch.ts).
    ctx.waitUntil(scheduledWatch(env, (r) => app.fetch(r, env)));
    // Each dug fork asks GitHub whether its upstream moved on (listen.ts).
    ctx.waitUntil(hearDue(env));
    ctx.waitUntil(sweepLimits(env));
    ctx.waitUntil(sweepTraffic(env));
    ctx.waitUntil(sweepLineEvents(env));
    ctx.waitUntil(sweepConflicts(env));
    ctx.waitUntil(sweepOAuth(env));
    if (accountsOn(env)) ctx.waitUntil(sweepSessions(env));
    ctx.waitUntil(drainJobs(env, (r) => app.fetch(r, env)));
    ctx.waitUntil(advanceAll(env, Date.now() + 10 * 60_000));
    // Check runs a runner claimed and then went quiet on go back in the queue (a claim does this too).
    // and ones no runner has picked up in hours are cancelled, so the merge gate isn't left waiting on them.
    // Then the built-in runner of each repo with runs still queued is woken, in case a kick went missing.
    ctx.waitUntil(requeueStale(env).then(() => expireQueued(env)).then(() => kickQueued(env)));
    // Files the vector index doesn't have as committed yet (search.ts); nothing without it.
    ctx.waitUntil(embedDue(env).catch(() => null));
  },

  // The queues (rustybuns.config.ts): JOBS runs queued requests whose turn has come, and hosted agent runs;
  // FIXES is fix tasks (heal.ts), agent messages too, so they take the JOBS branch below;
  // HOOKS is one webhook try per message. A batch is all one queue's, told apart by its
  // messages, since a stage's queues may be named otherwise.
  async queue(batch: { messages: readonly { body: unknown; ack(): void }[] }, env: Env) {
    if (batch.messages.some((m) => typeof (m.body as DigMessage)?.dig === "string")) await runDigs(batch as Parameters<typeof runDigs>[0], env);
    else if (batch.messages.some((m) => typeof (m.body as JobMessage)?.job === "number" || typeof (m.body as AgentMessage)?.agent === "number" || typeof (m.body as DigestMessage)?.digest === "string")) {
      // JOBS: hosted agent runs (agent-routes.ts) and feed digests (feed.ts) beside queued requests.
      const agents = batch.messages.filter((m) => typeof (m.body as AgentMessage)?.agent === "number") as { body: AgentMessage; ack(): void }[];
      const jobs = batch.messages.filter((m) => typeof (m.body as JobMessage)?.job === "number") as { body: JobMessage; ack(): void }[];
      const digests = batch.messages.filter((m) => typeof (m.body as DigestMessage)?.digest === "string") as { body: DigestMessage; ack(): void }[];
      await Promise.all([runQueuedAgents(agents, env, (r) => app.fetch(r, env)), runJobs({ messages: jobs }, env, (r) => app.fetch(r, env)), runQueuedDigests(digests, env)]);
    }
    else await deliverHooks(batch as { messages: readonly { body: HookMessage; ack(): void }[] }, env);
  },
};

export default app;

/**
 * The claims `who` holds in files other than `here` (on main, across repos), from D1's `held`
 * rows, each checked with its file: the file is the truth, and a row whose claim has gone is dropped.
 */
async function heldElsewhere(env: Env, who: string, here: [string, string, string]) {
  const { results } = await env.DB.prepare("SELECT owner, repo, path, id FROM held WHERE who = ? AND NOT (owner = ? AND repo = ? AND path = ?) LIMIT 20")
    .bind(who, ...here).all() as { results: { owner: string; repo: string; path: string; id: string }[] };
  const out: typeof results = [], now = Date.now();
  for (const h of results) {
    const claims = await toFile(env, h.owner, h.repo, h.path, who, "claims").then((r) => r.json() as Promise<{ id: string; who: string; until: number | null; soft?: boolean }[]>).catch(() => null);
    if (claims?.some((c) => c.id === h.id && c.who === who && !c.soft && (c.until === null || c.until > now))) out.push(h);
    else if (claims) await env.DB.prepare("DELETE FROM held WHERE owner = ? AND repo = ? AND path = ? AND id = ?").bind(h.owner, h.repo, h.path, h.id).run();
  }
  return out;
}
