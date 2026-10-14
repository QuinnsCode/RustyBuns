// Layout: the secrets an agent's edit must never carry into a repo
// A hosted agent holds its CLI's API key, and sometimes its owner's GitHub token, and its
// file is the one thing that leaves the container. A prompt-injected agent (a poisoned
// README, a task's text, a failing test's log) can be told to write that key into the
// file, where a commit makes it public on a public repo. So before an agent's edit is
// posted, the lines it added are checked for the values it was handed and for the
// shapes of common keys, and an edit that carries one posts nothing.

/** The shapes of keys nobody means to commit: LLM keys, GitHub tokens, AWS keys, private keys, this site's own. */
const SHAPES: [string, RegExp][] = [
  ["an Anthropic key", new RegExp("\\bsk-" + "ant-[A-Za-z0-9_-]{20,}")],   // built from pieces so this file isn't itself a key-shaped string
  ["an OpenAI key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["a GitHub token", new RegExp("\\bgithub_" + "pat_[A-Za-z0-9_]{60,}")],
  ["an AWS key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a codeSplitter token", /\bcs(?:t|ci)_[A-Za-z0-9_-]{40,}/],
];

/** Values shorter than this aren't checked for verbatim: too likely to turn up by chance. */
const MIN_SECRET = 16;

/**
 * What looks like a secret in `after`'s lines that `before` didn't have, or null. `secrets`
 * are the values the run was handed (its API keys, its GitHub token): any of them turning up
 * counts, whatever its shape. Lines already in the file don't count: the agent didn't write them.
 */
export function leakIn(before: string[], after: string[], secrets: (string | null | undefined)[] = []): string | null {
  const had = new Set(before), values = secrets.filter((s): s is string => !!s && s.length >= MIN_SECRET);
  for (const line of after) {
    if (had.has(line)) continue;
    if (values.some((v) => line.includes(v))) return "a key this run was handed";
    for (const [what, re] of SHAPES) if (re.test(line)) return what;
  }
  return null;
}
