// Prompt posts pick the next fight: people post prompts through the hour, react to them, and on the hour the cron
// takes the most reacted one. A fake eqosys stands in for Qollab's feed, keeping its rules (`sort=top&since=`: posted
// since then, most reacted first, newest first on a tie).
import { describe, expect, test } from "bun:test";
import type { Post } from "@rustybuns/util/board";
import { fightPrompt, type Fetcher } from "../src/board.ts";
import { promptFor } from "../src/engine/prompts.ts";

const H = 3_600_000, hour = 500_000 * H;
const post = (id: string, text: string, at: number, reacts: number): Post =>
  ({ id, app: "excalibrawl", by: { id: `u-${id}`, name: `Person ${id}` }, kind: "prompt", text, at, reacts });

function qollab(posts: Post[]) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (u) => {
    const url = new URL(String(u));
    asked.push(url.search);
    const since = Number(url.searchParams.get("since"));
    const feed = posts.filter((p) => p.at >= since).sort((a, b) => b.reacts - a.reacts || b.at - a.at);
    return Response.json({ posts: feed });
  };
  return { fetcher, asked };
}

describe("the next fight's prompt", () => {
  test("the last hour's most reacted prompt is the fight; one posted after the turn waits for the next", async () => {
    const { fetcher, asked } = qollab([
      post("a", "a duck in armour", hour - 50 * 60_000, 2),
      post("b", "  a knight fighting a toaster ", hour - 10 * 60_000, 5),
      // Long words sent past the page's box, and a line break: never drawn.
      post("c", "x".repeat(200), hour - 20 * 60_000, 9),
      // Posted two minutes after the hour turned, before the late cron ran: next hour's.
      post("d", "a goose with a lance", hour + 2 * 60_000, 7),
      // From two hours back: an old hour's.
      post("e", "an old prompt", hour - H - 1, 50),
    ]);
    const now = hour + 3 * 60_000;
    const got = await fightPrompt("https://eqosys.test/", now, fetcher);
    expect(got.prompt).toBe("a knight fighting a toaster");
    expect(got.post?.by.name).toBe("Person b");
    const q = new URLSearchParams(asked[0]);
    expect([q.get("app"), q.get("kind"), q.get("sort"), q.get("since")]).toEqual(["excalibrawl", "prompt", "top", String(hour - H)]);

    // An hour on, the goose's hour: the goose is the fight.
    expect((await fightPrompt("https://eqosys.test", hour + H + 30_000, fetcher)).prompt).toBe("a goose with a lance");
  });

  test.each([
    ["nobody posted", async () => Response.json({ posts: [] })],
    ["eqosys is down", async () => { throw new Error("down"); }],
    ["eqosys answers something odd", async () => Response.json({ posts: [{ id: 1 }] })],
  ] satisfies [string, Fetcher][])("the list's prompt when %s", async (_why, fetcher) => {
    expect(await fightPrompt("https://eqosys.test", hour + 60_000, fetcher)).toEqual({ prompt: promptFor(hour + 60_000), post: null });
  });
});
