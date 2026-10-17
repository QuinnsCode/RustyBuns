# Operations: things are functions

Most of what an app does is a function. A deal is created, a repo is merged, a profile is taken. How it
is reached (a button, an HTTP route, an MCP tool, a WebMCP tool, a CLI command, a skill file, a test) is a
choice about the door, not about the room. So the architecture is:

- **Backend function**: the operation. A name, an input schema, a permission, a `run`. It lives in one place.
- **Frontend function**: a view that calls it. A screen, a Ctrl-K entry, `window.crmCommands`.
- **Everything else is a connector.** HTTP, MCP, WebMCP and the CLI decode their input, call the same
  function and encode the answer. They hold no logic and no rules about who may do what.

We don't pick a side between WebMCP, MCP and a CLI. Each is a few lines over the same operation.
WebMCP is the odd one only because it runs as the signed-in person in their page, so use it for what needs that page.

## Auth: at the edge, then once more

A cookie, an API key or OAuth turns a request into a context. That happens before the operation. The
operation still asks `can(ctx, needs)` on every call, because the check is cheap and "the route already
did it" is how a new surface ships without one. An operation the caller can't run is also left out of
what they list, so an agent never sees a tool that will refuse it.

## The primitive

`packages/ops` (`@rustybuns/ops`, no dependencies, safe in a Worker, the browser and the sim):

```ts
const ops = createOps<Ctx>([
  defineOp({
    name: "deals_create", summary: "Make a deal.", needs: "create:deal", risk: "write",
    input: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    run: ({ title }, ctx) => createDeal(ctx, title),
  }),
], (ctx, needs) => allowed(ctx.role, needs));

ops.call("deals_create", { title: "Acme" }, ctx);   // the one way in: checks permission, then input
ops.mcpTools(ctx);                                   // MCP and WebMCP tool definitions
ops.parseArgv(["deals-create", "--title", "Acme"]);  // a CLI is argv to the same call
ops.skill("crm", ctx, "Drive the CRM.");             // a SKILL.md for agents with a shell
```

`risk` is `read`, `write` or `danger`; views mark `danger` destructive so a client asks a person first.

## cli2skill

[cli2skill](https://openskillindex.com/skills/openclaw-skills-cli2skill) turns a CLI's `--help` into a
SKILL.md (and can wrap an MCP server the same way). Worth knowing, not worth depending on: it parses help
text, so it guesses at what an operation list already knows exactly, and we found no source repository
or licence for it to review. `ops.skill` writes the same file straight from the operations, so it can't
drift from the code. Related tools that read a cobra tree or check documented flags against the live CLI
([skillgen](https://pkg.go.dev/github.com/bueti/skillgen), [skillpack](https://docs.rs/crate/skillpack/0.12.1))
come to the same conclusion: generate from the structure, don't scrape the help.

## Adopting it

qCRM and codeSplitter derive MCP tools from an OpenAPI spec, which makes HTTP the primary and the tools its
shadow. Moving them to operations means the spec becomes another view. New apps start here; the old ones
move one route group at a time. `apps/qcrm/src/app/commands.ts` is already the frontend half: its
registry could register the same operations rather than its own functions.
