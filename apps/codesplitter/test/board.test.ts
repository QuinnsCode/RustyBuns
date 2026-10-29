import { describe, expect, test } from "bun:test";
import { ask, brief, canMerge, pick, hitRate, needless, parseRound, parseRow, roundOf, roundsHit, waves, whoShouldTake, whyNot, type BoardRow } from "../src/board.ts";
import { addHits, ownersOf, reach, rowOf, wrongOf } from "../scripts/mervin-live.ts";
import { local as boot } from "./app-kit.ts";

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

describe("compact board (#1593)", () => {
  const rows = [row(1, { owner: "pixel" }), row(2, { stackedOn: 1 }), row(4, { ci: "fail", failing: ["apps"] })];
  test("brief is four lines, ids first", () => {
    expect(brief(rows)).toEqual(["3 open. mergeable: #1", "red: #4", "waiting: #2<-#1", "waves: 1,4 | 2"]);
    expect(brief([])).toEqual(["0 open. mergeable: none", "red: none", "waiting: none", "waves: none"]);
  });
  test("pick keeps pr and the named fields only", () => {
    expect(pick(rows, ["ci", "owner", "nope"])).toEqual([{ pr: 1, ci: "pass", owner: "pixel" }, { pr: 2, ci: "pass" }, { pr: 4, ci: "fail" }]);
  });
  test("the token cost: brief < fields < full board, on 30 PRs", () => {
    const many = Array.from({ length: 30 }, (_, i) => row(i + 1, { title: `PR number ${i + 1} does a thing`, owner: "pixel", files: 12, tiers: { certain: 8, agree: 3, card: 1 }, stackedOn: i % 3 ? i : undefined }));
    const cost = (x: unknown) => Math.round(JSON.stringify(x).length / 4);
    const full = cost({ prs: many, waves: waves(many), mergeable: canMerge(many) }), fields = cost(pick(many, ["ci"])), short = cost({ brief: brief(many).join("\n") });
    expect(short).toBeLessThan(fields);
    expect(fields).toBeLessThan(full / 3);
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

describe("recorded rounds (#1521)", () => {
  const rows = [
    { path: "a.ts", score: "exact", tiers: ["certain"] }, { path: "b.ts", score: "exact", tiers: ["agree"] },
    { path: "c.ts", score: "wrong", tiers: ["agree", "mervin"] }, { path: "d.md", score: "asked", tiers: ["card"] }, { path: "e.ts", score: "waiting", tiers: ["certain"] },
  ];
  test("a scored round counts verdicts by the file's last tier and names the wrongs", () => {
    const r = roundOf([4, 5], rows);
    expect(r.verdicts).toEqual({ certain: { exact: 1 }, agree: { exact: 1 }, mervin: { wrong: 1 }, card: { asked: 1 } });
    expect(r.wrongs).toEqual([{ path: "c.ts", tiers: ["agree", "mervin"] }]);
    expect(parseRound(r)).toEqual(r);
    expect(parseRound({ landed: [1], verdicts: { x: { fine: 1 } }, wrongs: [] })).toBe("verdicts.x: counts of exact, close, wrong, asked");
  });

  test("a hold is needless when the held PR landed exactly as staged; rounds add up per tier, kind and CI", () => {
    const row = (pr: number, clashes: BoardRow["clashes"] = []): BoardRow => ({ pr, head: "h", ci: "pass", tiers: {}, files: 1, clashes });
    // #5 waited on #4 for a migration stamp; its file landed exact, so the wait was needless. #6 was never held.
    const board = [row(4), row(5, [{ kind: "migration", key: "001", with: [4] }]), row(6)];
    const files = new Map([[4, ["c.ts"]], [5, ["a.ts", "b.ts"]], [6, ["a.ts"]]]);
    expect(needless([4, 5, 6], board, files, rows)).toEqual([5]);
    expect(needless([4, 5, 6], board, new Map([[5, ["c.ts"]]]), rows)).toEqual([]);
    const r = roundOf([4, 5], rows, { ci: [{ pr: 4, secs: 300 }, { pr: 5, secs: 600 }], needless: [5] });
    expect(parseRound(r)).toEqual(r);
    const more = roundOf([7], [{ path: "migrations/2.sql", score: "wrong", tiers: ["agree"] }, { path: "d.ts", score: "wrong", tiers: ["agree"] }], { ci: [{ pr: 7, secs: 900 }] });
    expect(roundsHit([r, more])).toMatchObject({
      exact: 2, of: 5, wrong: 3, rounds: 2, tiers: { certain: { exact: 1, of: 1 }, agree: { exact: 1, of: 3 }, mervin: { exact: 0, of: 1 } },
      kinds: [{ kind: "ts", wrong: 2 }, { kind: "migration", wrong: 1 }], needless: [5], ci: { median: 600, max: 900, prs: 3 },
    });
  });

  test("a wrong file becomes a fixture of base, each side and what landed; an added file has none", () => {
    const stage = (pr: number, path: string) => ({ pr, head: `h${pr}`, base: "main", files: [{ path, tier: "agree" as const, why: "", after: [] }] });
    const board = { main: "m0", at: "", stages: [stage(4, "c.ts"), stage(5, "x.ts")], written: [], skipped: [], clashes: [] };
    const texts: Record<string, string> = { m0: "a\n", h4: "a\nb\n", m1: "a\nb\nc\n" };
    expect(wrongOf("c.ts", ["agree"], (rev) => texts[rev] ?? null, board, "m1", "a\n")).toEqual({ path: "c.ts", tiers: ["agree"], base: "a\n", sides: [{ pr: 4, text: "a\nb\n" }], real: "a\nb\nc\n", sandbox: "a\n" });
    expect(wrongOf("c.ts", [], (rev) => (rev === "m0" ? null : "x"), board, "m1", null)).toBeNull();
  });

  test("nothing is kept until the repo opts in; opting out forgets", async () => {
    const call = await boot({ GH_CLI: "off" });
    const post = (body: unknown) => call("ana", "/api/repos/ana/r/board", { method: "POST", body: JSON.stringify(body) });
    const get = async () => (await (await call("ana", "/api/repos/ana/r/board")).json()) as { recording: boolean; rounds?: { exact: number; of: number; rounds: number; wrongs: { path: string }[] } };
    await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
    await call("ana", "/api/repos", { method: "POST", body: JSON.stringify({ name: "r" }) });
    const round = roundOf([4], rows);
    await post({ main: "m1", prs: [], round });
    expect(await get()).toMatchObject({ recording: false });
    expect((await get()).rounds).toBeUndefined();
    await post({ main: "m2", prs: [], record: true, round });
    expect((await get()).rounds).toMatchObject({ exact: 2, of: 3, rounds: 1, wrongs: [{ path: "c.ts" }] });
    // Kept rounds are the tiers' track record now, whatever the live process last posted.
    await post({ main: "m2", prs: [], hits: { agree: { exact: 9, of: 9 } } });
    expect((await (await call("ana", "/api/repos/ana/r/board")).json())).toMatchObject({ hits: { certain: 100, agree: 100, mervin: 0 } });
    expect((await post({ main: "m3", prs: [], round: { landed: "x" } })).status).toBe(400);
    await post({ main: "m4", prs: [], record: false });
    expect(await get()).toMatchObject({ recording: false });
    await post({ main: "m5", prs: [], record: true });
    expect((await get()).rounds).toMatchObject({ of: 0, rounds: 0 });
  });
});
