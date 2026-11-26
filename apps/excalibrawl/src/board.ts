// Prompt posts and reactions through eqosys's Qollab (apps/eqosys/QOLLAB.md, "Posts and reactions"). A signed-in person
// posts a prompt they want drawn (`kind: "prompt"`, no ref); anyone signed in reacts to it (`post:<id>`) or to a fight's
// replay (`fight:<id>`). On the hour the cron takes the last hour's most reacted prompt for the fight, or the list's when
// nobody posted. No Bun or DOM here: the Worker and the page both import it.

import { PostList, type Post } from "@rustybuns/util/board";
import { check } from "@rustybuns/util/guard";
import { promptFor } from "./engine/prompts.ts";

export const APP = "excalibrawl";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The icons eqosys's APPS gives this app's board. */
export const ICONS = ["flame", "laugh", "skull"] as const;
export type Icon = (typeof ICONS)[number];
/** A prompt the fighters draw is one short line: the list's run to about 40 characters. */
export const PROMPT_MAX = 80;

const HOUR = 3_600_000;
export const hourStart = (ms: number) => Math.floor(ms / HOUR) * HOUR;
export const fightRef = (id: string) => `fight:${id}`;
export const postRef = (id: string) => `post:${id}`;

/** A post that can be drawn: one line, not too long. Qollab takes up to 280 characters, so a longer one sent past the page is left out. */
export const drawable = (p: Pick<Post, "text">) => !!p.text.trim() && p.text.length <= PROMPT_MAX && !/[\r\n]/.test(p.text);

/**
 * The prompt for the fight starting at `now`: the most reacted one posted in the hour before (newest first on a tie),
 * else the list's. Read signed out, so the cron needs no token; eqosys away or slow, the list's.
 */
export async function fightPrompt(base: string, now: number, fetcher: typeof fetch = fetch): Promise<{ prompt: string; post: Post | null }> {
  const end = hourStart(now);
  const q = new URLSearchParams({ app: APP, kind: "prompt", sort: "top", since: String(end - HOUR) });
  const res = await fetcher(`${base.replace(/\/$/, "")}/q/posts?${q}`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  const posts = (res?.ok && check(PostList, await res.json().catch(() => null))?.posts) || [];
  // Posted since the hour turned (the cron can run a few minutes late): those are for the next fight.
  const post = posts.find((p) => p.at < end && drawable(p)) ?? null;
  return { prompt: post ? post.text.trim() : promptFor(now), post };
}
