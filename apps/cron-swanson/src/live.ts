// What the server, the relay (relay.ts) and the page share about the live channel, and the server's two ways
// out: a nudge to the relay after anything changes, and a push to the phone when a reminder fires.
// No Bun or DOM here: the relay's Worker bundles this file too.
import { num, obj, oneOf, type Of } from "@rustybuns/util/guard";

/** The subprotocol a page offers first; the token rides second, in a header instead of the URL. */
export const PROTOCOL = "cron-swanson";

/** What the relay tells every page: something changed at `at`, fetch /api/jobs again. */
export const LiveMsg = obj({ t: oneOf(["changed"]), at: num(0, Number.MAX_SAFE_INTEGER) });
export type LiveMsg = Of<typeof LiveMsg>;

/** The same string, compared in time that doesn't say how much of it matched. */
export function sameToken(given: string, want: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}

/** The token a page offered as its second subprotocol, or "" when it offered none. */
export function offeredToken(req: Request): string {
  const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
  return offered[0] === PROTOCOL ? offered[1] ?? "" : "";
}

/**
 * A nudge to the relay at `base` (POST /publish), at most one in flight: changes that land while one is out send
 * one more after it, not one each. A relay that's down costs a log line; pages fall back to the minute poll.
 */
export function relay(base: string, token: string | undefined, log: (e: unknown) => void = console.error): { poke(): void; idle(): Promise<void> } {
  let busy: Promise<void> | null = null, again = false;
  const url = new URL("/publish", base);
  const send = async (): Promise<void> => {
    do {
      again = false;
      const res = await fetch(url, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5_000) }).catch((e: unknown) => e);
      if (res instanceof Response) { await res.body?.cancel(); if (!res.ok) log(`relay: ${res.status}`); } else log(res);
    } while (again);
    busy = null;
  };
  return {
    poke() { if (busy) again = true; else busy = send(); },
    idle: () => busy ?? Promise.resolve(),
  };
}

/** Where a reminder goes to reach the phone: an ntfy topic URL (https://ntfy.sh/<a long private topic>). */
export async function push(topic: string, title: string, body: string): Promise<string> {
  try {
    const res = await fetch(topic, {
      method: "POST",
      // A header is ASCII; ntfy reads an RFC 2047 encoded word, so a name with an accent or an emoji arrives whole.
      headers: { title: `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(title.slice(0, 200))))}?=`, tags: "alarm_clock", "user-agent": "cron-swanson" },
      body: body || title,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.ok ? "" : `push: ${res.status}`;
  } catch (e) {
    return `push: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
  }
}
