// Ask first (#2498): which writes a worker's shell command makes. A new GitHub connection is read-only, so each repo
// asks a person once (grants.ts), and the owner can switch a repo or the whole office off. live/github.ts reads the same patterns to
// know which boards a command touched. Imports nothing, so the office's bundles can each carry it.

export const GH_WRITE = /\bgh\s+(pr|issue)\s+(create|merge|close|reopen|edit|comment|review|ready|lock|unlock|delete|transfer|develop|pin|unpin)\b/g;
export const GH_API_WRITE = /\bgh\s+api\b[^\n;&|]*(?:-X|--method)[\s=]*(POST|PATCH|PUT|DELETE)\b/i;
export const GIT_PUSH = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?push\b/;

/** The kinds of write that ask, in the words the card uses. */
export type Kind = "push" | "open" | "merge" | "comment" | "close" | "edit" | "api";

const VERB: Record<string, Kind> = {
  create: "open", ready: "open", develop: "open", merge: "merge", comment: "comment", review: "comment",
  close: "close", reopen: "close", delete: "close", transfer: "close",
  edit: "edit", lock: "edit", unlock: "edit", pin: "edit", unpin: "edit",
};

/** The writes a command makes (each kind once), and the repo it names with -R / --repo or an api path, if it does. */
export function writesOf(command: unknown): { kinds: Kind[]; repo?: string } {
  if (typeof command !== "string") return { kinds: [] };
  const kinds = new Set<Kind>();
  for (const m of command.matchAll(GH_WRITE)) kinds.add(VERB[m[2]!]!);
  if (GH_API_WRITE.test(command)) kinds.add("api");
  if (GIT_PUSH.test(command)) kinds.add("push");
  const repo = command.match(/(?:-R|--repo)[\s=]+([\w.-]+\/[\w.-]+)/)?.[1] ?? command.match(/\bgh\s+api\b[^\n;&|]*?\brepos\/([\w.-]+\/[\w.-]+)/)?.[1];
  return { kinds: [...kinds], ...(repo ? { repo } : {}) };
}

/** owner/name from a git remote url (https or ssh), or undefined when it isn't GitHub's. */
export const repoOfRemote = (url: string) => url.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
