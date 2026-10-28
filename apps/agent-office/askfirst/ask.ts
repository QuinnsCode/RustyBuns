// A worker's GitHub write asks first (#2498): the PreToolUse hook (askfirst/hook.ts) posts its Bash command to
// /office/workers/write, which lands here. A kind of write the owner already said "always" to goes through; any other
// waits on the same Allow / Deny card as the office's other asks, which also offers "Always".
import { loadSaved } from "../connect/github.ts";
import { askFirst } from "../live/floorguard.ts";
import { addGrants, granted, readGrants } from "./grants.ts";
import { writesOf } from "./kinds.ts";

/** `{ allow: true }`, or `{ allow: false, error }` with the reason to show the worker. `floorRepo` is the repo a command that names none is about. */
export async function writeCheck(dataDir: string, floorRepo: string | undefined, floor: string, who: string, body: unknown,
  toast: (msg: string) => void, ms?: number): Promise<{ allow: boolean; error?: string }> {
  const command = typeof body === "object" && body !== null && "command" in body ? body.command : undefined;
  const { kinds, repo: named } = writesOf(command);
  const repo = named ?? floorRepo ?? "this repo";
  // The connection that covers the repo (its owner's account, else the one the office acts as) decides before any card:
  // `write` skips the ask, `read` refuses without one. No connection at all keeps the ask.
  const connections = kinds.length ? loadSaved(dataDir) : [];
  const covering = connections.find((c) => c.account === repo.split("/")[0]) ?? connections[0];
  if (covering?.access === "write") return { allow: true };
  if (covering) return { allow: false, error: `The ${covering.account} GitHub connection is read-only, so this ${kinds.join("/")} on ${repo} was not run. The owner can allow writes on it in the office's setup page.` };
  for (const kind of kinds) {
    if (granted(readGrants(dataDir), repo, kind, who)) continue;
    const error = await askFirst("/write", floor, who, { command, kind, repo }, toast,
      { setting: "write", ms, always: `${kind} on ${repo}`, grant: () => void addGrants(dataDir, [{ repo, kind, who: "*" }]) });
    if (error) return { allow: false, error };
  }
  return { allow: true };
}
