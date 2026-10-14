// What a cold agent finds at the root: /llms.txt, /robots.txt and the Link header on /. Static copies
// are written at build time (build.ts) since Cloudflare serves assets before the Worker; the Worker
// serves the same text where there are no assets (the desktop). Imports nothing.

/** Where the API lives, relative to the site, so the text is the same on every host. */
export const DISCOVER = [
  { rel: "service-desc", href: "/api/openapi.json", type: "application/openapi+json", what: "the API as an OpenAPI 3.1 spec" },
  { rel: "api-catalog", href: "/api", type: "application/json", what: "the API reference, as JSON" },
  { rel: "mcp", href: "/api/mcp", type: "application/json", what: "a remote MCP server (POST JSON-RPC; sign in with OAuth or a personal API token)" },
  { rel: "service-doc", href: "/reference", type: "text/html", what: "the API reference, as a page" },
] as const;

/** The Link header on `/`: each entry points an agent at the machine-readable surface. */
export const LINK_HEADER = DISCOVER.map((d) => `<${d.href}>; rel="${d.rel}"; type="${d.type}"`).join(", ");

export const LLMS_TXT = `# codeSplitter

> A git host where every line has its own author and history, and people and agents edit the same file at once.

Everything the site does is one API call, and the same operations are an OpenAPI spec, an MCP server and a CLI.

## For agents

${DISCOVER.map((d) => `- [${d.href}](${d.href}): ${d.what}`).join("\n")}
- [/mcp](/mcp): how to connect an MCP client
- [/agent.md](/agent.md): a prompt to hand your own agent so it can drive the site
- [/install.sh](/install.sh): the CLI in one line (curl -fsSL <site>/install.sh | sh)

Reads of public repos need no sign-in. Writes use a cookie or \`Authorization: Bearer <token>\` (tokens: /#/me/tokens).
Calls marked \`x-codesplitter-risky: true\` change who can get in, can't be undone or ship code; ask the person first.
`;

export const ROBOTS_TXT = `User-agent: *
Allow: /

# For agents: ${DISCOVER.map((d) => d.href).join(" ")} /llms.txt
Sitemap: /llms.txt
`;
