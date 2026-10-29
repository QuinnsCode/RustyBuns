import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { checkTallyServer, SERVER_IMPORT } from "../checks/patch.ts";
import { chipText, type Card } from "../train/chip.ts";
import { mergeTrainServer } from "../train/patch.ts";
import { mergeTrain, type Floor } from "../train/server.ts";
import { fakeGitHub } from "../../../packages/util/test/fake-gh.ts";
import { read, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

type Board = { items: { number: number; train?: Card }[] };
type GitHub = Floor["github"] & { merge(n: number, method: string, deleteBranch: boolean, auto: boolean): Promise<string | undefined> };
let GitHub: new (dir: string, onIssues: () => void, onPulls: (b: Board) => void, runGh: (args: string[]) => Promise<string>) => GitHub;

// upstream's GitHub boards, patched as rustybunsify.ts patches them
beforeAll(async () => {
  const dir = path.join(await unpackPinned(), "dist/server/server");
  writeFileSync(path.join(dir, "rb-checks.js"), "export const tally = () => undefined;\n");
  writeFileSync(path.join(dir, "github.js"), SERVER_IMPORT + mergeTrainServer(checkTallyServer(read(path.join(dir, "github.js")))));
  ({ GitHub } = await import(path.join(dir, "github.js")));
});

async function until(ok: () => boolean) {
  for (let i = 0; i < 400 && !ok(); i++) await Bun.sleep(5);
  expect(ok()).toBe(true);
}

test("Merge when ready on two PRs that pass alone but break together: one merges, the other is pulled before main", async () => {
  const fake = fakeGitHub({ defines: ["BEASTS", "SHEETS"], uses: [] });
  fake.open(2761, { drop: ["BEASTS"], use: ["SHEETS"] });
  fake.open(2778, { use: ["BEASTS"] });
  // each is green where it branched and neither conflicts: GitHub's auto-merge would land both
  expect(fake.greenAlone(2761) && fake.greenAlone(2778)).toBe(true);

  let board: Board = { items: [] };
  const github = new GitHub("/repo", () => {}, (b) => (board = b), (args) => fake.run(args));
  const told: [string, string][] = [];
  const workers = {
    list: () => [{ id: "w1", name: "Gizmo", pr: { number: 2761 } }, { id: "w2", name: "Byte", pr: { number: 2778 } }],
    prompt: (id: string, text: string) => void told.push([id, text]),
  };
  const train = mergeTrain({ github, workers }, 5);
  try {
    expect(await github.merge(2761, "squash", false, true)).toBeUndefined();
    expect(await github.merge(2778, "squash", false, true)).toBeUndefined();
    const card = train.card(2778);
    expect(card && chipText(card)).toBe("1 ahead");

    await until(() => train.card(2778)?.state === "pulled");
    expect(fake.prs.get(2761)!.state).toBe("MERGED");
    expect(fake.prs.get(2778)!.state).toBe("OPEN");
    expect(fake.calls).toContain("pr update-branch");
    expect(fake.mainGreen()).toBe(true);
    // one message, to the worker whose PR broke, naming the check
    expect(told).toEqual([["w2", expect.stringContaining("typecheck")]]);
    // the PR board's card says why it came out
    await until(() => (void github.refreshPulls(), !!board.items.find((p) => p.number === 2778 && p.train?.state === "pulled" && p.train.why?.includes("typecheck"))));
  } finally {
    train.stop();
  }
});
