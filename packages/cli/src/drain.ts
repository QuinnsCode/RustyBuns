// `rustybuns deploy --drain-url <origin>`: before the new build goes live, ask the running app to warn its busy rooms.
// A deploy keeps Durable Object storage but restarts every object, dropping its sockets and in-memory state, and nothing
// else tells anyone. The app's drain route (codeSplitter: POST /api/admin/drain {in: seconds}, bearer RB_DRAIN_SECRET)
// sends each room {t:"deploy-soon", at} and then {t:"draining"}; this waits out the grace period, then the deploy goes on.
// Off unless --drain-url is given. It never fails a deploy that could go out: an app that doesn't answer is said so and skipped.

/** Seconds of warning before the deploy goes live, when --drain-seconds isn't given. Small on purpose: the owner decides. */
export const DEFAULT_GRACE_S = 30;

export interface DrainFlags { url?: string; seconds: number; rest: string[] }

/** --drain-url <origin> (or =) turns it on; --drain-seconds <n> sets the grace period. Both are taken out of the args. */
export function drainFlags(args: string[]): DrainFlags {
  let url: string | undefined, seconds = DEFAULT_GRACE_S;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!, eq = a.indexOf("="), name = eq > 0 ? a.slice(0, eq) : a;
    if (name !== "--drain-url" && name !== "--drain-seconds") { rest.push(a); continue; }
    const v = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (!v) throw new Error(`${name} needs a value`);
    if (name === "--drain-url") {
      if (!/^https?:\/\//.test(v)) throw new Error(`--drain-url wants the app's origin, like https://example.com, got ${v}`);
      url = v.replace(/\/+$/, "");
    } else if (!(Number(v) >= 0 && Number(v) <= 600)) throw new Error(`--drain-seconds wants 0 to 600, got ${v}`);
    else seconds = Number(v);
  }
  return { url, seconds, rest };
}

export interface DrainReply { rooms: number; drained: number }

/** Tells the app to drain in `seconds` (or lifts it, with `cancel`). Null when it didn't answer well: the caller says so and goes on. */
export async function callDrain(url: string, secret: string, body: { in?: number; cancel?: true }, fetcher: typeof fetch = fetch): Promise<DrainReply | null> {
  try {
    const res = await fetcher(`${url}/api/admin/drain`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return res.ok ? (await res.json()) as DrainReply : null;
  } catch {
    return null;
  }
}
