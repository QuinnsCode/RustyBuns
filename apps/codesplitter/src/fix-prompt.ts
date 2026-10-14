// Self-heal: when something fails in the site, the person gets a prompt for their own coding agent
// that says what happened and hands back the error (the web twin of packages/cli's triagePrompt).
// Built to /fix-prompt.js for client.html, and imported by the tests. Imports nothing.

export const REPO = "https://github.com/QuinnsCode/RustyBuns";

export interface Failure {
  /** What the person was doing: "merge feature-x", "save a token". */
  what: string;
  /** The error text as the site showed it. */
  error: string;
  /** HTTP status, when the failure was an API answer. */
  status?: number;
  method?: string;
  /** The API path (a query string is dropped). */
  path?: string;
  /** The page it happened on (location.hash). */
  page?: string;
  /** A stack, for an uncaught error. */
  stack?: string;
  /** Lines of context the caller wants the agent to see (a held merge's cards). */
  notes?: string[];
  /** "merge" failures are Mervin's: the agent is pointed at the engine and its corpus. */
  kind?: "web" | "merge";
}

/** Secrets never ride along: tokens, bearer headers, cookies, and the query string of a URL. */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:cst|cfut|cfat|ghp|gho|ghs|sk)[-_][A-Za-z0-9_-]{16,}/g, "<redacted>")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1<redacted>")
    .replace(/((?:cookie|set-cookie|authorization)\s*[:=]\s*)[^\n]+/gi, "$1<redacted>")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1");
}

const indent = (s: string) => s.split("\n").map((l) => `    ${l}`).join("\n");

/** The text to paste into a coding agent. */
export function fixPrompt(f: Failure, o: { site?: string; version?: string; agent?: string } = {}): string {
  const call = f.path ? `${f.method ?? "POST"} /api${f.path.split("?")[0]}${f.status ? ` -> ${f.status}` : ""}` : "";
  const facts = [
    `What I was doing: ${f.what}`,
    call && `Call: ${call}`,
    f.page && `Page: ${f.page}`,
    o.site && `Site: ${o.site}${o.version ? ` (codeSplitter ${o.version})` : ""}`,
  ].filter(Boolean);
  const merge = f.kind === "merge";
  const ask = merge
    ? [
        "Settle it on my branch so it merges: read both sides, keep what each meant, run the repo's tests.",
        "If Mervin (the merge engine, apps/codesplitter/src/lines.ts and merge-plan.ts) held or settled this wrongly, that is a codeSplitter bug:",
        `fork ${REPO}, add the case to apps/codesplitter/test (see docs/mervin.md for the corpus), fix the engine, and open a pull request with the failing test first.`,
      ]
    : [
        "Find the cause. If it's something on my side (my repo, token or config), fix it there.",
        `If it's a codeSplitter bug, fork ${REPO}, write a failing test in apps/codesplitter/test, fix it in apps/codesplitter, and open a pull request.`,
        "The owner takes fixes as pull requests and cites the author, so a PR with a test beats an issue.",
      ];
  return [
    `codeSplitter failed while I was using it${o.agent ? ` (I'm in ${o.agent})` : ""}. Here is exactly what happened.`,
    "",
    ...facts.map((l) => `- ${scrub(l as string)}`),
    "",
    "The error, as shown:",
    "",
    indent(scrub(f.error.trim() || "(no message)")),
    ...(f.stack ? ["", "Stack:", "", indent(scrub(f.stack.split("\n").slice(0, 8).join("\n")))] : []),
    ...(f.notes?.length ? ["", "Context:", "", indent(scrub(f.notes.join("\n")))] : []),
    "",
    ...ask,
    "Don't read .env files or print secrets, and don't deploy.",
  ].join("\n");
}

/** A failure worth a "fix it" button: a server fault or an uncaught error, not a 4xx the page already explains. */
export const worthAButton = (status?: number) => status === undefined || status >= 500;
