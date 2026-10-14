import { describe, expect, test } from "bun:test";
import { EVENT_KEYS, FILE_KEYS, answerOf, emitOutcome, extOf, outcomeEvent } from "../src/mervin-events.ts";

const files = [
  { path: "src/a.ts", solved: 2 },
  { path: "package.json", picks: { l1: "main" } },
  { path: "CHANGELOG.md", picks: { l1: "both", l2: "both:branch-first" } },
  { path: "x/notes", picks: { l1: { text: "secret words" }, l2: "branch" } },
  { path: "README.md" },
];

describe("outcome event", () => {
  test("schema has no content field, at any depth", async () => {
    const ev = await outcomeEvent({ owner: "o", repo: "r", hash: true, checks: true, files });
    expect(Object.keys(ev).sort()).toEqual([...EVENT_KEYS].sort());
    for (const f of ev.files) for (const k of Object.keys(f)) expect(FILE_KEYS as readonly string[]).toContain(k);
    expect(EVENT_KEYS.concat(FILE_KEYS as never).filter((k) => /text|content|diff|body|line|patch/i.test(k))).toEqual([]);
    expect(JSON.stringify(ev)).not.toContain("secret words");
  });

  test("settled, answers, extension; paths hashed unless the repo opts out", async () => {
    const ev = await outcomeEvent({ owner: "o", repo: "r", hash: true, checks: true, files });
    expect(ev.files.map((f) => [f.settled, f.answer, f.ext])).toEqual([
      ["engine", undefined, ".ts"], ["card", "main", ".json"], ["card", "both", ".md"], ["card", "mixed", ""], ["clean", undefined, ".md"],
    ]);
    expect(ev.files[0]!.path).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain("package.json");
    const plain = await outcomeEvent({ owner: "o", repo: "r", hash: false, checks: true, files });
    expect(plain.files[1]!.path).toBe("package.json");
    expect(ev.later).toEqual({ reverted: null, edited: null });
  });

  test("helpers", () => {
    expect(extOf("a/b.TS")).toBe(".ts");
    expect(extOf(".gitignore")).toBe("");
    expect(answerOf({})).toBeUndefined();
  });

  test("emits only when bound and opted in; never throws", async () => {
    const sent: unknown[][] = [];
    const db = (row: unknown) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
    await emitOutcome({ DB: db({ hash_paths: 1 }) } as never, "o", "r", files);
    await emitOutcome({ DB: db(null), MERVIN_EVENTS: { send: async (e) => { sent.push(e); } } } as never, "o", "r", files);
    expect(sent.length).toBe(0);
    await emitOutcome({ DB: db({ hash_paths: 1 }), MERVIN_EVENTS: { send: async (e) => { sent.push(e); } } } as never, "o", "r", files);
    expect(sent.length).toBe(1);
    await emitOutcome({ DB: db({ hash_paths: 1 }), MERVIN_EVENTS: { send: async () => { throw new Error("down"); } } } as never, "o", "r", files);
  });
});
