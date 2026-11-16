// #4663: a worker's agent can be gone while the office still holds its terminal and shows it `done`, and a prompt typed
// to it then goes nowhere. The patched worker manager (scripts/ended.ts) asks this before it types into a terminal.

/** Whether process `pid` has gone. 0 (not known yet) and one that belongs to another user (EPERM) count as running. */
export function gone(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "ESRCH";
  }
}
