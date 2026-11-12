# Code principles

The habits that keep code readable when many agents write it at once. They're written for TypeScript,
but the ideas carry to other languages.

## Things are functions

Most of what an app does is an operation: a deal is created, a repo is merged. How it's reached (a button,
an HTTP route, an MCP tool, a CLI command, a skill file, a test) is a choice of door, not of room.

- **Backend function:** the operation, with a name, an input schema, a permission and a `run`. It lives in one place.
- **Frontend function:** a view that calls it.
- **Everything else is a connector.** HTTP, MCP, browser tools and the CLI decode the input, call the same
  function and encode the answer. They hold no logic and no rules about who may do what.
- **Auth at the edge, then once more.** The edge turns a cookie or key into a context, and the operation still
  checks permission on every call, because "the route already did it" is how a new door ships without a check.
  Leave operations the caller can't run out of what they list, so an agent never sees a tool that will refuse it.
- **Generate agent docs from the operations,** not by scraping `--help`, so the docs can't drift from the code.

RustyBuns' version is `packages/ops` (see [OPS.md](https://github.com/QuinnsCode/RustyBuns/blob/main/OPS.md)).

## Check what comes in

- A parsed body, fetch reply or stored string is `unknown` until a guard looks at it. No `as { ... }`,
  no `any`. Narrow each field, and test the wrong shape.
- Write a whole message's guard once, with small combinators (`obj`, `str`, `num`, `arr`, `opt`), and derive
  the type from it.
- What a route answers is one guard that both the server and the page import. Never a loose record on each side of the wire.
- Where the type is known, pass it through a generic (`first<Row>()`) instead of casting the result.
- A CI audit counts unchecked values per file, and the count only goes down.

## Cut before you add

- Grep before writing a helper. If it exists twice, pull it up and delete the copies in the same PR.
- A PR that deletes more than it adds is the goal.
- Keep a short list in `AGENTS.md` of where the shared helpers live, so agents import them instead of rewriting them.

## Effects at the edges

If your stack has an effect library (RustyBuns uses Effect):

- Use it where something must be cleaned up, cancelled or retried, or can lose state (child processes, sockets,
  saves, deploys, CI and agent runs), and where the right answer depends on which failure happened.
- Keep it out of per-tick and per-frame code, simulations, and anything pure or size-sensitive. Keep it at the
  edges, so plain functions never import it.
- If a plain `try/finally` or `AbortController` already covers it, leave it plain.
- Patterns worth copying: retry only the failure worth retrying, backoff as a value defined once, absence as a
  tagged error rather than `null`, and a lock that releases itself.
  RustyBuns' [EFFECT.md](https://github.com/QuinnsCode/RustyBuns/blob/main/EFFECT.md) has them with credits.

## Tests

- One journey through the running app per feature, and unit tests for real corner cases.
- Test behaviour, never source text.
- A fix's test must fail on the old code.
- Cover the everyday path plus one failure someone would plausibly hit. Delete tests for cases nobody can reach.
- Agents run only their changed tests, and CI runs the rest, with tests limited to the parts of the repo a PR touched.
