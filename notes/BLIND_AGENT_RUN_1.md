# Blind agent run 1: codeSplitter live site

2026-10-14. Three fresh agents, given only `https://codesplitter.notryanquinn.workers.dev/` and no repo
context, GET/HEAD only, no sign-in, no writes. Missions: first-timer, API-driven, "start a repo with two
agents and merge".

## What they could do without auth

- Read the API reference (`/api`), OpenAPI 3.1 (`/api/openapi.json`, 101 paths), the MCP tool catalog
  (`/api/mcp/tools`, 126 tools, no token), `/reference`, `/mcp`, `/install.sh`.
- Read OAuth metadata under `/.well-known/*` (PKCE S256, public clients, scopes read and write).
- Read `/api/levels`, `/api/levels/mitt/tree`, `/api/pulse`, `/api/stats`, `/api/search`, `/api/health`.

## What needs a human

- Sign-in (email, GitHub or Google, behind Turnstile), then either a `cst_...` token from the profile
  page or the MCP OAuth consent ("Read only" or "Read and write").
- Repo name and visibility, and confirmation before any merge.

All three derived the same plan: create repo, invite agents (`POST /invites/claim` with `as: agent`), one
branch each, check `dispatch-hint` and `merge-plan`, merge by line id.

## Gaps they hit (cold start)

1. The homepage is a JS-only shell, so a fetch sees nothing about the product.
2. No `llms.txt`, `/docs`, `/openapi.json`, `/.well-known/mcp`, `/agents.md`, `/sitemap.xml`; `robots.txt`
   does not point at `/api`. All three found the spec by guessing `/api`.
3. The 401 (`sign in first`) has no `WWW-Authenticate` / `resource_metadata`, so it does not lead to the
   OAuth docs.
4. Terms (level, beam, cut, stamp, crew) are never defined in one place.
5. Unclear how an agent edits a file on a branch, and whether plain `git clone` / `git push` works.
6. No public repo list or explore endpoint, so nothing to browse cold. Pricing and limits are not stated.
7. Spec has 101 paths but the MCP catalog has 126 tools; nobody checked they agree.
8. The configured `codesplitter` MCP server in the sessions failed with ECONNREFUSED (not investigated).

## Not tried

Anything behind auth, `POST /api/mcp`, `/install.sh` (read only), `/play.html`. Next run: give an agent a
token and see what it does with a repo.
