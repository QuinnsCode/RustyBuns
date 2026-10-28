// A worker's GitHub write asks first (#2498): the PreToolUse hook (askfirst/hook.ts) posts its Bash command to
// /office/workers/write, which lands here. A kind of write the owner already said "always" to goes through; any other
// waits on the same Allow / Deny card as the office's other asks, which also offers "Always".
import { askFirst } from "../live/floorguard.ts";
import { addGrants, granted, readGrants } from "./grants.ts";
import { writesOf } from "./kinds.ts";

/** `{ allow: true }`, or `{ allow: false, error }` with the reason to show the worker. `floorRepo` is the repo a command that names none is about. */
export async function writeCheck(dataDir: string, floorRepo: string | undefined, floor: string, who: string, body: unknown,
  toast: (msg: string) => void, ms?: number): Promise<{ allow: boolean; error?: string }> {
  const command = typeof body === "object" && body !== null && "command" in body ? body.command : undefined;
  const { kinds, repo: named } = writesOf(command);
  const repo = named ?? floorRepo ?? "this repo";
  for (const kind of kinds) {
    if (granted(readGrants(dataDir), repo, kind, who)) continue;
    const error = await askFirst("/write", floor, who, { command, kind, repo }, toast,
      { setting: "write", ms, always: `${kind} on ${repo}`, grant: () => void addGrants(dataDir, [{ repo, kind, who: "*" }]) });
    if (error) return { allow: false, error };
  }
  return { allow: true };
}
