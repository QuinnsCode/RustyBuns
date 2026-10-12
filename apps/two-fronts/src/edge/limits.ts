// The Worker's door. In memory, so per isolate: a speed bump against a script minting Durable
// Objects in a loop, not a global quota.

/** New campaigns an address may start a minute. */
export const STARTS_PER_MINUTE = 10;
const starts = new Map<string, number[]>();

export function allowStart(ip: string, now: number): boolean {
  const recent = (starts.get(ip) ?? []).filter((t) => now - t < 60_000);
  starts.delete(ip); // re-inserted below, so the oldest address is first to go
  if (starts.size >= 10_000) starts.delete(starts.keys().next().value!);
  const ok = recent.length < STARTS_PER_MINUTE;
  starts.set(ip, ok ? [...recent, now] : recent);
  return ok;
}
