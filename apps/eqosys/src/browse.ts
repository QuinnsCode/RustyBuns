// A studio game's page run in a real browser, for the `runs` and `answers` review checks (checks.ts): Cloudflare Browser Run
// (Chromium) through the BROWSER binding (rustybuns.config.ts) and @cloudflare/puppeteer. One browser a check: it opens the
// page, lets it run SETTLE_MS, asks `window.<handle>.state()`, and closes, never past LIVE_MS. A check sees what
// `bun run probe --url <page> --js "<handle>.state()"` shows a reviewer: errors thrown while the page runs, and what state() answers.
//
// Price (Workers Paid, 2026-11): 10 browser hours a month are included, then $0.09 an hour; one check is under 20 s, so even a
// hundred sends a month is about half an hour. It runs only when a studio sends a game and when the super admin asks again.
import { bool, check, obj, str } from "@rustybuns/util/guard";
import type { BrowserWorker } from "@cloudflare/puppeteer";

/** The BROWSER binding, as @cloudflare/puppeteer takes it. */
export type { BrowserWorker };

/** What the page did in the browser: the errors it threw, and what its harness's state() answered (or why it didn't). */
export type PageRun = { errors: string[]; state: { ok: boolean; text: string } };
/** Runs a page in a browser and asks its harness. Tests hand in their own (Env `PAGE_RUN`). */
export type Browse = (url: string, handle: string) => Promise<PageRun>;

/** The longest a page gets to load, and state() to answer. */
export const LIVE_MS = 15_000;
/** How long the page runs after it loads, before state() is asked. */
export const SETTLE_MS = 1_500;
/** The most errors a check keeps, and the longest any one line it keeps. */
export const MOST_ERRORS = 5;
export const MOST_CHARS = 300;

const Answer = obj({ ok: bool(), text: str(4000, { min: 0 }) });
const cut = (s: string) => (s.length > MOST_CHARS ? `${s.slice(0, MOST_CHARS - 1)}…` : s);

/** What runs in the page: the harness's state() as JSON, or why there is none. */
const ask = (handle: string) => `(async () => {
  const h = window[${JSON.stringify(handle)}];
  if (!h || typeof h.state !== "function") return { ok: false, text: "no window.${handle}.state() once the page ran" };
  try { return { ok: true, text: String(JSON.stringify(await h.state())) }; }
  catch (e) { return { ok: false, text: "state() threw: " + String(e && e.message || e) }; }
})()`;

const late = (ms: number, what: string) => new Promise<never>((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms / 1000} s`)), ms));

/** Browser Run behind the binding. */
export const browserRun = (binding: BrowserWorker): Browse => async (url, handle) => {
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  const browser = await puppeteer.launch(binding);
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: unknown) => { if (errors.length < MOST_ERRORS) errors.push(cut(e instanceof Error ? e.message : String(e))); });
    await page.goto(url, { waitUntil: "load", timeout: LIVE_MS });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const got = check(Answer, await Promise.race([page.evaluate(ask(handle)), late(LIVE_MS, "state()")]));
    return { errors, state: got ? { ok: got.ok, text: cut(got.text) } : { ok: false, text: "state() answered something that is not JSON" } };
  } finally {
    await browser.close().catch(() => {});
  }
};
