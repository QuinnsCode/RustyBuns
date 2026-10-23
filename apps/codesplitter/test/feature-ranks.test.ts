import { describe, expect, test } from "bun:test";
import { COMMENT_GAP_MS, parseTiers } from "../src/feature-ranks.ts";
import { local as boot } from "./app-kit.ts";

// One journey end to end (in-process D1), like follows.test.ts.
describe("ranking the features", () => {
  test("signed in people rank and comment; the crowd score averages; a comment waits 10 minutes", async () => {
    const call = await boot({ GH_CLI: "off" });
    const send = async (user: string | null, url: string, body?: unknown, method = "POST") => {
      const res = await call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
      return { status: res.status, body: (await res.json()) as any };
    };
    for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u });

    // Signed out: you can look, not rank or comment.
    const look = await send(null, "/api/feature-ranks", undefined, "GET");
    expect(look.body).toMatchObject({ signed_in: false, scores: {}, comments: [], comment_after: 0 });
    expect((await send(null, "/api/me/feature-ranks", { tiers: { a: "S" } }, "PUT")).status).toBe(401);
    expect((await send(null, "/api/feature-comments", { text: "hi" })).status).toBe(401);

    expect((await send("ryan", "/api/me/feature-ranks", { tiers: { "smart-merges": "S", claims: "B" } }, "PUT")).status).toBe(200);
    await send("mia", "/api/me/feature-ranks", { tiers: { "smart-merges": "A" } }, "PUT");
    const view = (await send("ryan", "/api/feature-ranks", undefined, "GET")).body;
    expect(view.mine).toEqual({ "smart-merges": "S", claims: "B" });
    expect(view.scores["smart-merges"]).toEqual({ score: 3.5, votes: 2 });
    // Ranking again replaces yours: claims is dropped.
    await send("ryan", "/api/me/feature-ranks", { tiers: { "smart-merges": "C" } }, "PUT");
    const after = (await send("ryan", "/api/feature-ranks", undefined, "GET")).body;
    expect(after.scores.claims).toBeUndefined();
    expect(after.scores["smart-merges"].score).toBe(2);

    const first = await send("ryan", "/api/feature-comments", { text: "  Mervin saved my afternoon  " });
    expect(first.status).toBe(201);
    expect(first.body.text).toBe("Mervin saved my afternoon");
    const soon = await send("ryan", "/api/feature-comments", { text: "and another" });
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatch(/^thanks/);
    expect(soon.body.comment_after).toBeGreaterThan(Date.now() + COMMENT_GAP_MS - 5000);
    // The limit is per person.
    expect((await send("mia", "/api/feature-comments", { text: "me too" })).status).toBe(201);
    const heard = (await send("ryan", "/api/feature-ranks", undefined, "GET")).body;
    expect(heard.comments.map((c: any) => c.user).sort()).toEqual(["mia", "ryan"]);
    expect(heard.comment_after).toBeGreaterThan(Date.now());
    call.close?.();
  });

  test("a bad ranking is refused", () => {
    expect(parseTiers({ a: "S" })).toEqual({ a: "S" });
    expect(parseTiers({ a: "Z" })).toMatch(/tier must be/);
    expect(parseTiers({ "Bad Id": "S" })).toMatch(/bad feature/);
    expect(parseTiers([])).toMatch(/object/);
  });
});
