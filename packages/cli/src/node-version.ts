// Alchemy runs under `node`, and refuses an old one only after the Worker is built (#3743).
// Checked up front instead, against the floors in its package.json `engines` (or these).

/** Alchemy's minimum per major line, when its package.json has no `engines.node`. */
export const ALCHEMY_NODE_FLOORS = ["22.22.3", "24.11.1"];

const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);

function atLeast(v: string, floor: string): boolean {
  const a = parts(v), b = parts(floor);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** The `>=x.y.z` floors in an engines range like ">=22.22.3 <23 || >=24.11.1"; the defaults when it names none. */
export function nodeFloors(engines?: string): string[] {
  const found = [...(engines ?? "").matchAll(/>=\s*v?(\d+(?:\.\d+){0,2})/g)].map((m) => m[1]!);
  return found.length ? found : ALCHEMY_NODE_FLOORS;
}

/** Does node `version` meet one of `floors`: its own major's floor, or a major past the newest floor's. */
export function nodeSupported(version: string, floors = ALCHEMY_NODE_FLOORS): boolean {
  const major = parts(version)[0]!;
  const same = floors.find((f) => parts(f)[0] === major);
  if (same) return atLeast(version, same);
  return major > Math.max(...floors.map((f) => parts(f)[0]!));
}

/** The newest installed version (from nvm's list) that would do, if any. */
export function newestSupported(installed: string[], floors = ALCHEMY_NODE_FLOORS): string | undefined {
  return installed.filter((v) => nodeSupported(v, floors)).sort((a, b) => (atLeast(a, b) ? -1 : 1))[0];
}
