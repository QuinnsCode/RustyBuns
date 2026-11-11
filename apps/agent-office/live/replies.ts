// What the office's /__rb routes answer, as guards both the route and its page import. Nothing here touches node:,
// so a page script can import it; the routes (live/reload.ts, live/floorguard.ts) write `satisfies` the same type.
import { arr, bool, int, num, obj, oneOf, opt, rec, str, type Of } from "@rustybuns/util/guard";

const text = str(Infinity, { min: 0 });

/** A session past a context line (ester/dexter.ts `ContextAlert`): the parts the page shows. */
const Alert = obj({ name: text, level: oneOf(["warn", "handoff"]), message: text });
/** A session that ran a code-mode program since the last ask (ester/dexter.ts `ModeEvent`). */
const Mode = obj({ session: text, name: text, code: int(0, 1e9), load: int(0, 1e9), direct: int(0, 1e9), message: text });
/** GET /__rb/context: Dexter's watch on live sessions, as Ester's page reads it (the route also sends `sessions`). */
export const ContextReply = obj({ lines: arr(text, 10_000), over: arr(Alert, 10_000), fresh: arr(Alert, 10_000), code: opt(arr(Mode, 10_000)) });
export type ContextReply = Of<typeof ContextReply>;

/** A refusal from any office route: `{ error }`, read when the status isn't ok. */
export const Problem = obj({ error: opt(text) });

/**
 * GET /__rb/reload. `swap` maps each page script that can be swapped in place ("rb-clock") to its current file; `fixed`
 * hashes everything else a page loaded (the skin, shared chunks, rb-reload itself), which only a refresh replaces (reload/hot.ts).
 */
export const ReloadState = obj({ boot: text, page: text, swap: rec(text), fixed: text, stale: bool(), workers: bool(), canRestart: bool() });
export type ReloadState = Of<typeof ReloadState>;

/** An agent's request waiting for a person (#727). `always`, when "Allow" can also be "always": what it's for, e.g. "pushes to owner/name" (askfirst/). */
const Ask = obj({ id: text, floor: text, who: text, what: text, detail: text, size: int(0, Number.MAX_SAFE_INTEGER), odd: int(0, Number.MAX_SAFE_INTEGER), at: num(0, Number.MAX_SAFE_INTEGER), until: num(0, Number.MAX_SAFE_INTEGER), always: opt(text) });
export type Ask = Of<typeof Ask>;
/** GET /__rb/asks: the requests still waiting. */
export const Asks = obj({ asks: arr(Ask, 10_000) });
