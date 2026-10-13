# htmx plan: a server on your profile

A plan, not a feature. Nothing here is built. It answers "where could htmx go?", with the profile page first and the code page second.

## Why it fits

- `src/client.html` is one 6,500-line page that fetches JSON from `/api/*` and builds the DOM in script. htmx flips that: the Worker returns small HTML fragments and the page swaps them in.
- The profile is already "a playlist of code you like" ([worker.ts](../src/worker.ts)). A profile that serves its own fragments turns it into a tiny server: a component you can stream, embed or point at from elsewhere.
- Every file is a Durable Object with a WebSocket. htmx's `ws` and `sse` extensions map onto that without new transport.

## Ground rules (what the repo forces)

- **CSP.** [security.ts](../src/security.ts) allows `script-src 'self'` plus hashes of inline scripts. Vendor htmx at `/vendor/htmx.min.js` next to `lucide.min.js`, never from a CDN. Set `allowEval: false` (so no `hx-on`, no `hx-vals="js:..."`) and `includeIndicatorStyles: false` (it injects a `<style>` tag).
- **Fragments are HTML, so they must escape.** Every fragment goes through one `html` tagged template that escapes by default. A repo's README or a line of code is attacker text.
- **Privacy.** A fragment route runs the same visibility check as its JSON twin ([private-lines.md](private-lines.md)). Build the fragment from the JSON handler's result, not from a second query.
- **Icons, not emojis.** Fragments use the same `icon("name")` helper as the product.
- **No wrapping labels.** Buttons stay icon plus tooltip, so `hx-indicator` swaps never shift layout.
- Keep `openapi.ts` and `mcp-tools.ts` import-free. Fragment routes are not API endpoints and stay out of them, or the generated docs get noise.

## Profile page: the main event

Each block on a profile becomes a self-loading fragment. The page shell is static and cheap, and every block fetches itself.

| Block | Markup | Route |
| --- | --- | --- |
| Playlists | `hx-get="/u/:name/playlists" hx-trigger="load"` | list, then `hx-get` for each playlist body on expand (`hx-trigger="toggle once"`) |
| Follow button | `hx-post="/u/:name/follow" hx-swap="outerHTML"` | returns the flipped button and the new count |
| Follower / following counts | `hx-trigger="load, follows from:body"` | the follow button fires `HX-Trigger: follows` and the counts refetch |
| Stamps given and got | `hx-trigger="revealed"` | lazy, below the fold |
| Repos you may see | `hx-get ... hx-trigger="revealed" hx-swap="beforeend"` on a last-row sentinel | infinite scroll, paged |
| Activity feed ([feed.ts](../src/feed.ts)) | `hx-ext="sse" sse-connect="/u/:name/feed"` | server-sent rows prepended live |
| Presence dot | `hx-ext="sse" sse-swap="presence"` | online, in a file, an agent |
| Edit your bio and pins | `hx-get=".../edit"` swaps in a form, `hx-put` swaps back | owner only |

### The "literal server on your profile" idea

Let a profile publish **widgets**: named fragments the owner defines, served at `/u/:name/w/:widget`.

1. A widget is a fragment template plus a query: "my five newest stamps", "lines I own that changed today", "the open branch with the most conflicts".
2. Anyone can drop one in with `<div hx-get="https://codesplitter.example/u/ryan/w/stamps" hx-trigger="load">` on any page. CORS on `/u/:name/w/*` allows GET only, no credentials.
3. Streaming: a widget with `sse-connect` keeps updating. The file Durable Object already knows when a line changes, so a "live line" widget is a subscription, not a poll.
4. The owner picks visibility per widget (public, followers, private), and the route enforces it.

Open question: do widgets run owner-written code? Recommend **no** for v1. They are fixed templates plus a whitelisted query, so the only thing a profile "serves" is data the platform already trusts. Owner-written code belongs in the sandbox ([agent-takeover.md](agent-takeover.md)), not in a profile route.

## Code page

Not "everywhere", because the editor is the hard part. Split by what changes:

**Good fits (server owns the state, page is a view):**

- **File tree and directory listing.** `hx-get` on a folder, `hx-swap="innerHTML"` into its children, `hx-push-url` for the path.
- **Branch switcher and branch list.** `hx-get` swaps the body, `hx-push-url="true"` keeps links shareable.
- **History / vein view.** Revert and cherry-pick are `hx-post` with `hx-confirm`... but see CSP: use a small confirm fragment instead of `hx-confirm`, which calls `window.confirm`.
- **Blame popover on a line.** `hx-get="/blame/:line" hx-trigger="mouseenter delay:300ms" hx-target="#popover"`.
- **Search results.** `hx-get="/search" hx-trigger="input changed delay:200ms, search"` into a results div.
- **Conflict cards and hunk review.** Accept or reject is `hx-post` returning the next hunk.
- **Test results in the gutter**, **claims** and **presence**: `sse` swaps of one small element each.
- **Merge plan and lint**: `hx-trigger="load"` panels.

**Keep as script:**

- The line editor itself, selection, cut, the keyboard handlers (`lineKey`, `drawRuns`, `codeRows` in [client.html](../src/client.html)). They are local, instant and stateful. A round trip per keystroke is the wrong model.
- Live file sync over the WebSocket. htmx's `ws` extension sends and receives text, but the patch-in-place logic already works and is more careful about line ids than a swap would be.
- The city scene and the game pages.

**Rule of thumb:** if clicking it changes server state or shows server data, it can be htmx. If it moves a cursor, it stays script.

## Order of work

1. **Plumbing, one PR.** Vendor htmx, add the `html` escaper, set config for CSP, serve one fragment (the follow button) end to end with a test that a private profile never leaks. Nothing else rides on this PR.
2. **Profile blocks.** Follow counts, stamps, repo list with infinite scroll. Each is a route plus a test next to its JSON twin.
3. **Profile feed and presence over SSE.** Check cost first: one stream per open profile tab is a Worker connection each, so cap streams per viewer and close on `visibilitychange`.
4. **Widgets**, fixed templates only, per-widget visibility, GET-only CORS.
5. **Code page read-only panels** (tree, history, blame popover, search).
6. **Code page actions** (branch switch, hunk accept, revert).

## Risks

- **Two renderers.** A block rendered both by script and by a fragment will drift. Migrate a block fully, then delete the script version in the same PR.
- **Back/forward cache and `hx-push-url`** need a full-page fallback for each route, or a pasted link shows a bare fragment. Fragment routes check `HX-Request` and wrap in the shell when it is absent.
- **Desktop build** runs the same handler under Bun, so fragment routes must not assume Workers-only APIs.
- **Weight.** htmx is about 15 KB gzipped. The page is already large, so this is cheap, but measure first-paint on the profile before and after.

## What to decide before building

1. Widgets: fixed templates only (recommended), or owner-defined?
2. Should embedding widgets on third-party pages be allowed at all, or only on codeSplitter pages?
3. Start with the profile only (recommended), or the code page panels too?
