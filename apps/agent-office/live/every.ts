// The office's background loops ("every N ms, one round": the ci loop, reaper, storage guard, GitHub watch, brawl,
// held tasks, stall watch, merge train) all go through `every` (#5738). Plain, not Effect: a round that is still
// running when the next is due is skipped, a failed round is logged under the loop's name and the next one runs, and
// the timer never keeps the process alive (EFFECT.md ruling 10).

export interface EveryOptions {
  /** Named in the log line when a round fails: `[rb] <name>: <message>`. */
  name: string;
  /** Milliseconds before the first round: 0 runs it now, before `every` returns. Default `ms`. */
  first?: number;
  /** Where a failed round is reported (tests). Default console.warn. */
  warn?: (line: string) => void;
}

/** Runs `round` every `ms`, never two at once. Returns a stop. */
export function every(ms: number, round: () => unknown, { name, first = ms, warn = console.warn }: EveryOptions): () => void {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const fail = (e: unknown) => warn(`[rb] ${name}: ${e instanceof Error ? e.message : String(e)}`);
  const go = () => {
    if (running || stopped) return;
    running = true;
    let out: unknown;
    try { out = round(); } catch (e) { running = false; return fail(e); }
    Promise.resolve(out).catch(fail).finally(() => { running = false; });
  };
  const next = (wait: number) => {
    timer = setTimeout(() => { go(); if (!stopped) next(ms); }, wait);
    timer.unref?.();
  };
  if (first === 0) go();
  next(first === 0 ? ms : first);
  return () => { stopped = true; clearTimeout(timer); };
}
