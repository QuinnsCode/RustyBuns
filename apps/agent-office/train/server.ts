// The office's merge train, built into rb-train.js: each floor's "Merge when ready" joins its line
// (@rustybuns/util/train) instead of turning on GitHub's auto-merge, which merges on a stale green run (#2778 on
// 2026-10-29). The patches (train/patch.ts) route merge(…, auto) here and put each PR's spot on the PR board's card.
import { ghTrain, Train, type Method } from "@rustybuns/util/train";
import type { Card } from "./chip.ts";

/** How often the head of the line is looked at: CI takes minutes, and every look is a few `gh` calls. */
export const EVERY_MS = 20_000;

/** A floor of the office (floor.js), as much of it as this needs. */
export interface Floor {
  github: {
    dir: string;
    runGh(args: string[], cwd: string, timeout?: number): Promise<string>;
    repoInfo(): Promise<{ nameWithOwner: string }>;
    refreshPulls(): Promise<unknown>;
    __rbTrain?: OfficeTrain;
  };
  workers: {
    list(): { id: string; name: string; pr?: { number: number } }[];
    prompt(id: string, text: string, by?: string): string | undefined;
  };
}

export interface OfficeTrain {
  /** "Merge when ready": joins the line. Resolves to an error, as upstream's merge does. */
  join(pr: number, method: Method, deleteBranch: boolean): Promise<string | undefined>;
  /** The PR's place on the board, if it's in the line. */
  card(pr: number): Card | undefined;
  stop(): void;
}

/** Hooks a floor up: called from its constructor (see scripts/rustybunsify.ts). */
export function mergeTrain(floor: Floor, every = EVERY_MS): OfficeTrain {
  const gh = floor.github;
  let train: Promise<Train> | undefined;
  const ready = () => (train ??= gh.repoInfo().then((r) => new Train({
    gh: ghTrain((args) => gh.runGh(args, gh.dir, 90_000), r.nameWithOwner),
    tell: (pr, text) => {
      const w = floor.workers.list().find((x) => x.pr?.number === pr);
      return !!w && !floor.workers.prompt(w.id, `From the office's merge train, not your person:\n\n${text}`, "merge train");
    },
    say: (line) => console.warn(`🥐 ${line}`),
    merged: () => void gh.refreshPulls(),
  })).catch((e) => { train = undefined; throw e; }));
  let now: Train | undefined;
  const timer = setInterval(() => void (now?.moving && now.step().then(() => gh.refreshPulls())), every);
  timer.unref?.();
  const office: OfficeTrain = {
    async join(pr, method, deleteBranch) {
      try {
        now = await ready();
        now.join(pr, method, deleteBranch);
        void now.step().then(() => gh.refreshPulls());
      } catch (e) {
        return (e as Error).message;
      }
    },
    card(pr) {
      const s = now?.spot(pr);
      return s && { state: s.state, why: s.why, ahead: now!.ahead(pr) };
    },
    stop: () => clearInterval(timer),
  };
  gh.__rbTrain = office;
  return office;
}
