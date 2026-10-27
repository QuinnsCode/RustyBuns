import { expect, test } from "bun:test";
import { parseFeed, podcastRoute, seconds, type Feed } from "../podcast/feed.ts";
import { after, start } from "../podcast/queue.ts";

const rss = (n: number) => `<rss><channel><title>Half &amp; Half</title>${Array.from({ length: n }, (_, i) => `
  <item><title><![CDATA[Episode ${n - i}]]></title><guid isPermaLink="false">g${n - i}</guid><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate>
  <itunes:duration>1:02:03</itunes:duration><enclosure url="https://cdn.example/${n - i}.mp3?a=1&amp;b=2" length="1" type="audio/mpeg"/></item>`).join("")}
  <item><title>No audio</title></item></channel></rss>`;

test("an RSS feed becomes episodes, newest first, and skips items with no audio", () => {
  const { title, episodes } = parseFeed(rss(3));
  expect(title).toBe("Half & Half");
  expect(episodes.map((e) => e.title)).toEqual(["Episode 3", "Episode 2", "Episode 1"]);
  expect(episodes[0]).toMatchObject({ id: "g3", url: "https://cdn.example/3.mp3?a=1&b=2", seconds: 3723 });
  expect(seconds("42:10")).toBe(2530);
  expect(seconds("2523")).toBe(2523);
  expect(seconds("soon")).toBe(0);
});

test("the station starts at the oldest (or newest), resumes where you left, and steps through", () => {
  const { episodes } = parseFeed(rss(3));
  expect(start(episodes, "oldest", null)?.ep.title).toBe("Episode 1");
  expect(start(episodes, "newest", null)?.ep.title).toBe("Episode 3");
  expect(start(episodes, "oldest", { id: "g2", t: 90 })).toMatchObject({ t: 90, ep: { title: "Episode 2" } });
  expect(start(episodes, "oldest", { id: "gone", t: 90 })?.ep.title).toBe("Episode 1");
  expect(after(episodes, "oldest", episodes[2]!)?.title).toBe("Episode 2");
  expect(after(episodes, "oldest", episodes[0]!)).toBeNull();
  expect(after(episodes, "newest", episodes[0]!)?.title).toBe("Episode 2");
});

test("the route serves only feeds in your list, and says so when one can't be read", async () => {
  const feed: Feed = { id: "hah", title: "Half & Half", url: "https://feeds.example/hah", order: "oldest" };
  let fetched = 0;
  let ok = true;
  const get = (async () => { fetched++; return ok ? new Response(rss(2)) : new Response("", { status: 500 }); }) as unknown as typeof fetch;
  const route = podcastRoute(() => [feed], get);
  const at = (p: string) => route("GET", new URL(`http://office${p}`));

  expect((await at("/__rb/podcast"))?.body).toEqual({ feeds: [{ id: "hah", title: "Half & Half", order: "oldest" }] });
  expect((await at("/__rb/podcast/episodes?feed=nope"))?.status).toBe(404);
  expect(fetched).toBe(0);
  const eps = await at("/__rb/podcast/episodes?feed=hah");
  expect((eps?.body as { episodes: unknown[] }).episodes).toHaveLength(2);
  await at("/__rb/podcast/episodes?feed=hah");
  expect(fetched).toBe(1); // cached
  expect(await at("/__rb/other")).toBeNull();

  ok = false;
  const down = podcastRoute(() => [feed], get);
  expect((await down("GET", new URL("http://office/__rb/podcast/episodes?feed=hah")))?.status).toBe(502);
});
