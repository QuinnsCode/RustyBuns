// `rustybuns test` (#4799): an app's journey tests against a running copy of the app.
//
// It works like Alchemy's test harness (Test.make + getWhenReady: start the stack once per suite, wait until
// it answers, run the tests against it, destroy it). The pinned Alchemy no longer ships `alchemy/Test`, so the
// CLI runs those steps with its own commands:
//   default          `rustybuns dev` (workerd + the local emulators): nothing on the account, nothing billed.
//   --stage[=NAME]   `rustybuns deploy --ephemeral` to a throwaway stage (test_$USER unless named), priced and
//                    asked first, then `rustybuns destroy` of that stage, also when a test fails or Ctrl-C stops it.
// The tests read the app's URL from RUSTYBUNS_TEST_URL. With no files named, it runs the test files whose
// path has "journey" in it (`test/journey/*.test.ts`, `*.journey.test.ts`).

import { UsageError } from "./errors.ts";

export interface TestFlags { stage: string | null; url?: string; yes: boolean; keep: boolean; filters: string[] }

const STAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** `--stage` takes its name after `=` only, so `rustybuns test --stage checkout` still filters on "checkout". */
export function testFlags(args: string[], env: Record<string, string | undefined> = process.env): TestFlags {
  let stage: string | null = null, url: string | undefined;
  const filters: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--stage") stage = `test_${env.USER || "me"}`;
    else if (a.startsWith("--stage=")) {
      stage = a.slice("--stage=".length);
      if (!STAGE_NAME.test(stage)) throw new UsageError({ message: `--stage= needs a name (letters, digits, _ and -), got ${JSON.stringify(stage)}` });
    } else if (a === "--url") {
      url = args[++i];
      if (!url || url.startsWith("--")) throw new UsageError({ message: "--url needs the app's address" });
    } else if (a.startsWith("--url=")) url = a.slice("--url=".length);
    else if (a === "--yes" || a === "--keep") continue;
    else if (a.startsWith("--")) throw new UsageError({ message: `rustybuns test doesn't know ${a}\n${TEST_USAGE}` });
    else filters.push(a);
  }
  const keep = args.includes("--keep");
  if (keep && !stage) throw new UsageError({ message: "--keep is for --stage: a local run has nothing to keep" });
  if (url && stage) throw new UsageError({ message: "--url tests an app that already runs, so it makes no stage: drop --stage or --url" });
  return { stage, url, yes: args.includes("--yes"), keep, filters };
}

export const TEST_USAGE = `rustybuns test [FILTER...]            journey tests against \`rustybuns dev\` (local emulators, free)
rustybuns test --stage[=NAME] [--yes]  against a throwaway stage (default test_$USER), destroyed afterwards
               [--keep]                leave the stage up after the run (destroy it yourself)
rustybuns test --url URL               against an app that already runs
The tests read the address from RUSTYBUNS_TEST_URL. No FILTER: test files with "journey" in the path.`;

/** The first local address in `rustybuns dev`'s output. */
export function localUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'`)\]]*/);
  return m ? m[0].replace("0.0.0.0", "localhost").replace(/[.,;:]+$/, "") : null;
}

/**
 * Wait until the app answers, like Alchemy's getWhenReady: a refused connection, a 5xx, or Cloudflare's
 * "nothing here yet" (error code 10xx on a brand-new workers.dev name) mean it isn't up yet.
 */
export async function waitReady(url: string, o: { fetch?: typeof fetch; timeoutMs?: number; everyMs?: number; now?: () => number } = {}): Promise<{ ok: true; status: number } | { ok: false; why: string }> {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, end = now() + (o.timeoutMs ?? 90_000);
  let why = "no answer";
  for (;;) {
    try {
      const r = await f(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const body = r.status === 404 ? await r.text() : "";
      if (r.status < 500 && !/error code: 10\d\d/.test(body)) return { ok: true, status: r.status };
      why = `${r.status}${body ? ` ${body.trim().slice(0, 80)}` : ""}`;
    } catch (err) { why = (err as Error).message; }
    if (now() >= end) return { ok: false, why };
    await Bun.sleep(o.everyMs ?? 1000);
  }
}

/** A child process: its exit, its output so far, and a way to stop it. */
export interface Child { exited: Promise<number>; output: () => string; stop: () => Promise<void> }

export interface TestDeps {
  /** Run `rustybuns <args>` and wait for it (deploy, destroy), its output on the terminal. */
  cli: (args: string[]) => Promise<number>;
  /** Start `rustybuns <args>` in the background (dev), its output kept. */
  start: (args: string[]) => Child;
  /** `bun test <filters>` with `env` added, its output on the terminal. */
  bunTest: (filters: string[], env: Record<string, string>) => Promise<number>;
  /** The stage's URL from the Alchemy state after a deploy. */
  stageUrl: (stage: string) => string | null;
  /** The money and the yes, before a stage run. Null to go on, else why not. */
  priced: (stage: string, yes: boolean) => Promise<string | null>;
  fetch?: typeof fetch;
  log: (line: string) => void;
  readyMs?: number;
  devMs?: number;
}

/** The whole run; its exit code. Whatever the run made is torn down before this returns (unless --keep). */
export async function runTests(flags: TestFlags, d: TestDeps): Promise<number> {
  const filters = flags.filters.length ? flags.filters : ["journey"];
  const tests = (url: string, stage: string) => d.bunTest(filters, { RUSTYBUNS_TEST_URL: url, RUSTYBUNS_TEST_STAGE: stage });
  const ready = async (url: string) => {
    const r = await waitReady(url, { fetch: d.fetch, timeoutMs: d.readyMs });
    if (!r.ok) d.log(`✗ ${url} never answered (${r.why})`);
    return r.ok;
  };

  if (flags.url) return (await ready(flags.url)) ? tests(flags.url, "") : 1;

  if (!flags.stage) {
    d.log("testing on the local emulators (`rustybuns dev`): nothing is created on any account");
    const dev = d.start(["dev"]);
    try {
      const url = await devUrl(dev, d.devMs ?? 180_000);
      if (!url) {
        d.log(`✗ \`rustybuns dev\` gave no local address. Its last lines:\n${tail(dev.output())}`);
        return 1;
      }
      d.log(`app on ${url}`);
      if (!(await ready(url))) { d.log(tail(dev.output())); return 1; }
      return await tests(url, "local");
    } finally { await dev.stop(); }
  }

  const stage = flags.stage;
  const refused = await d.priced(stage, flags.yes);
  if (refused) { d.log(`✗ ${refused}`); return 2; }
  const iso = ["--stage", stage, "--ephemeral", "--yes"];
  let code = 1;
  try {
    code = await (async () => {
      d.log(`deploying throwaway stage ${stage}`);
      if ((await d.cli(["deploy", ...iso])) !== 0) { d.log(`✗ the deploy to ${stage} failed`); return 1; }
      const url = d.stageUrl(stage);
      if (!url) { d.log(`✗ no URL for ${stage} in the Alchemy state after the deploy`); return 1; }
      d.log(`app on ${url}`);
      return (await ready(url)) ? tests(url, stage) : 1;
    })();
  } finally {
    // Also after a failed deploy: it can leave half a stack up.
    if (flags.keep) d.log(`kept stage ${stage} (--keep). It bills until \`rustybuns destroy --stage ${stage}\`.`);
    else {
      d.log(`destroying throwaway stage ${stage}`);
      if ((await d.cli(["destroy", ...iso])) !== 0) {
        d.log(`✗ the destroy of ${stage} failed, so its resources are still up. Run \`rustybuns destroy --stage ${stage}\`.`);
        code = code || 1;
      }
    }
  }
  return code;
}

async function devUrl(dev: Child, ms: number): Promise<string | null> {
  let gone = false;
  dev.exited.then(() => { gone = true; });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const url = localUrl(dev.output());
    if (url) return url;
    if (gone) return null;
    await Bun.sleep(200);
  }
  return null;
}

const tail = (s: string, n = 15) => s.trim().split("\n").slice(-n).join("\n");
