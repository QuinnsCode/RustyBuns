// A worker's GitHub write asks first (#2498): the PreToolUse hook (askfirst/hook.ts) posts its Bash command to
// /office/workers/write, which lands here. The owner's shutoff valves (grants.ts) come first: the office switch off, or a
// repo switched off, refuses every write with no card. A repo switched on goes through; a repo not yet decided asks once
// on the Allow / Deny card, and "Always" there switches the repo on for every kind of write and every worker.
import { loadSaved } from "../connect/github.ts";
import { askFirst } from "../live/floorguard.ts";
import { decide, readGate, setRepo } from "./grants.ts";
import { writesOf } from "./kinds.ts";

/** `{ allow: true }`, or `{ allow: false, error }` with the reason to show the worker. `floorRepo` is the repo a command that names none is about. */
export async function writeCheck(dataDir: string, floorRepo: string | undefined, floor: string, who: string, body: unknown,
  toast: (msg: string) => void, ms?: number): Promise<{ allow: boolean; error?: string }> {
  const command = typeof body === "object" && body !== null && "command" in body ? body.command : undefined;
  const { kinds, repo: named } = writesOf(command);
  if (!kinds.length) return { allow: true };
  const repo = named ?? floorRepo ?? "this repo";
  const what = kinds.join("/");
  // The valves decide before any connection or card, so an off switch stops a write whatever the connection allows.
  const verdict = decide(readGate(dataDir), repo);
  if (verdict === "block-office") return { allow: false, error: `GitHub writes are switched off for the whole office, so this ${what} on ${repo} was not run. The owner can switch them on in Settings.` };
  if (verdict === "block-repo") return { allow: false, error: `GitHub writes to ${repo} are switched off, so this ${what} was not run. The owner can switch them on in Settings.` };
  // The connection that covers the repo (its owner's account, else the one the office acts as): `write` skips the ask,
  // `read` refuses without one. No connection at all keeps the ask.
  const connections = loadSaved(dataDir);
  const covering = connections.find((c) => c.account === repo.split("/")[0]) ?? connections[0];
  if (covering?.access === "write") return { allow: true };
  if (covering) return { allow: false, error: `The ${covering.account} GitHub connection is read-only, so this ${what} on ${repo} was not run. The owner can allow writes on it in the office's setup page.` };
  if (verdict === "allow") return { allow: true };
  const error = await askFirst("/write", floor, who, { command, kind: what, repo }, toast,
    { setting: "write", ms, always: `GitHub writes on ${repo}`, grant: () => void setRepo(dataDir, repo, true) });
  return error ? { allow: false, error } : { allow: true };
}
