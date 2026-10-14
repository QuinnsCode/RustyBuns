import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ask, canMerge, hitRate, parseRow, waves, whoShouldTake, whyNot, type BoardRow } from "../src/board.ts";
import { addHits, ownersOf, reach, rowOf } from "../scripts/mervin-live.ts";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const row = (pr: number, extra: Partial<BoardRow> = {}): BoardRow => ({ pr, head: `h${pr}`, ci: "pass", tiers: { certain: 1 }, files: 1, clashes: [], ...extra });

describe("board answers", () => {
  const rows = [
    row(1, { owner: "pixel" }),
    row(2, { stackedOn: 1 }),
    row(3, { clashes: [{ kind: "migration", key: "m/1", with: [1] }], owner: "bolt" }),
    row(4, { ci: "fail", failing: ["apps"] }),
    row(5, { tiers: { card: 2 } }),
  ];
  test("what blocks a PR, and what can merge now", () => {
    expect(whyNot(rows[1]!, rows)).toEqual(["waits for #1: it's stacked on this one"]);
    expect(whyNot(rows[2]!, rows)[0]).toContain("#1: clashes on migration m/1");
    expect(whyNot(rows[3]!, rows)).toEqual(["its own CI is red (apps)"]);
    expect(whyNot(rows[4]!, rows)).toEqual(["2 files Mervin asks about (cards)"]);
    expect(canMerge(rows)).toEqual([1]);
  });
  test("the merge waves come off the board", () => {
    expect(waves(rows)).toEqual([[1, 4, 5], [2, 3]]);
  });
  test("who should take a PR: its owner, else the owner of what it waits for", () => {
    expect(whoShouldTake(3, rows)).toEqual({ owner: "bolt", why: "it owns the PR" });
    expect(whoShouldTake(2, rows).owner).toBe("pixel");
    expect(whoShouldTake(4, rows).owner).toBeNull();
    expect(ask(1, rows)!.blocks).toEqual([2, 3]);
    expect(ask(99, rows)).toBeNull();
  });
  test("hit rates and row checks", () => {
    expect(hitRate({ certain: { exact: 9, of: 10 }, agree: { exact: 0, of: 0 } })).toEqual({ certain: 90, agree: null });
    expect(parseRow({ pr: 0 })).toBe("pr: a positive integer");
    expect(parseRow(row(7))).toEqual(row(7));
  });
});

describe("mervin-live", () => {
  test("reach: own apps, and the apps a manifest or package touch reaches", () => {
    const uses = { shared: ["a", "b"] };
    expect(reach(["apps/a/x.ts"], ["a", "b", "c"], uses)).toEqual({ own: ["a"], blast: null });
    expect(reach(["bun.lock"], ["a", "b", "c"], uses)).toEqual({ own: [], blast: ["a", "b", "c"] });
    expect(reach(["packages/shared/i.ts", "apps/c/y.ts"], ["a", "b", "c"], uses)).toEqual({ own: ["c"], blast: ["a", "b", "c"] });
  });
  test("owners from office-workers, a PR number or URL", () => {
    expect([...ownersOf([{ name: "pixel", pr: 12 }, { name: "bolt", pr: "https://github.com/o/r/pull/34" }, { name: "idle" }])]).toEqual([[12, "pixel"], [34, "bolt"]]);
  });
  test("a stage becomes a row, with the clashes it is in", () => {
    const stage = { pr: 5, head: "h", base: "b", ci: "fail" as const, failing: ["apps"], stackedOn: 4, files: [{ path: "a", tier: "card" as const, why: "", after: [] }] };
    const board = { main: "m", at: "", stages: [stage], written: [], skipped: [], clashes: [{ kind: "route" as const, key: "/x", prs: [5, 6] }] };
    expect(rowOf(stage, board, new Map([[5, "pixel"]]))).toMatchObject({ pr: 5, ci: "fail", stackedOn: 4, owner: "pixel", tiers: { card: 1, certain: 0 }, clashes: [{ kind: "route", key: "/x", with: [6] }] });
    const h = addHits({}, [{ path: "a", score: "exact", tiers: ["agree"] }, { path: "b", score: "wrong", tiers: ["agree"] }]);
    expect(h).toEqual({ agree: { exact: 1, of: 2 } });
  });
});

describe("GET/POST /api/repos/:o/:r/board", () => {
  test("rows posted show on the board, change on a new post, and drop", async () => {
    const call = await boot({ GH_CLI: "off" });
    opened.push(call);
    const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await post("ana", "/api/login", { name: "ana" });
    await post("ana", "/api/repos", { name: "r" });
    const u = "/api/repos/ana/r/board";
    expect(((await (await call("ana", u)).json()) as { prs: unknown[] }).prs).toEqual([]);
    expect((await post("ana", u, { main: "m1", prs: [row(1, { owner: "pixel" }), row(2, { stackedOn: 1 })] })).status).toBe(201);
    let b = await (await call("ana", u)).json() as { main: string; prs: BoardRow[]; waves: number[][]; mergeable: number[] };
    expect(b.main).toBe("m1");
    expect(b.prs.map((p) => p.pr)).toEqual([1, 2]);
    expect(b.waves).toEqual([[1], [2]]);
    expect(b.mergeable).toEqual([1]);
    const one = await (await call("ana", `${u}?pr=2`)).json() as { blocking: string[]; take: { owner: string } };
    expect(one.blocking).toEqual(["waits for #1: it's stacked on this one"]);
    expect(one.take.owner).toBe("pixel");
    await post("ana", u, { main: "m2", prs: [row(1, { head: "new", ci: "fail" })], drop: [2], hits: { agree: { exact: 3, of: 4 } } });
    b = await (await call("ana", u)).json() as typeof b;
    expect(b.prs.map((p) => [p.pr, p.head, p.ci])).toEqual([[1, "new", "fail"]]);
    expect((b as unknown as { hits: unknown }).hits).toEqual({ agree: 75 });
    expect((await post("ana", u, { main: "m3", prs: [{ pr: 1 }] })).status).toBe(400);
    expect((await call("ana", `${u}?pr=9`)).status).toBe(404);
  });
});
