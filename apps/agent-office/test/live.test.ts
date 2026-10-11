import { expect, test } from "bun:test";
import { LiveGitHub, touches, type Deps } from "../live/github.ts";

test("a worker's gh writes and pushes touch the boards; reads don't", () => {
  expect(touches("gh issue close 12 --reason completed")).toEqual({ issues: true, pulls: false });
  expect(touches("gh pr merge 40 --squash --auto")).toEqual({ issues: true, pulls: true });
  expect(touches("cd app && gh pr create --fill")).toEqual({ issues: true, pulls: true });
  expect(touches("gh api --method POST repos/{owner}/{repo}/issues/3/comments -f body=hi")).toEqual({ issues: true, pulls: true });
  expect(touches("git push -u origin HEAD")).toEqual({ issues: false, pulls: true });
  expect(touches("git -C ../x push")).toEqual({ issues: false, pulls: true });
  expect(touches("gh pr view 40 --json state")).toBeUndefined();
  expect(touches("gh pr checks 40 --watch")).toBeUndefined();
  expect(touches("gh api repos/{owner}/{repo}/pulls")).toBeUndefined();
  expect(touches("grep -rn 'git pushes' .")).toBeUndefined();
  expect(touches(undefined)).toBeUndefined();
});

/** A GitHub that answers each path with its current etag, or 304 when asked with it. */
function fakeGitHub() {
  const etags = new Map<string, string>();
  const asked: string[] = [];
  const answer = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    asked.push(path);
    const etag = etags.get(path) ?? '"0"';
    if ((init.headers as Record<string, string>)["if-none-match"] === etag) return new Response(null, { status: 304 });
    return new Response("[]", { headers: { etag } });
  }) as unknown as typeof fetch;
  return { etags, asked, fetch: answer };
}

function live(gh: ReturnType<typeof fakeGitHub>, over: Partial<Deps> = {}) {
  const looked = { issues: 0, pulls: 0 };
  const l = new LiveGitHub({
    refreshIssues: async () => void looked.issues++,
    refreshPulls: async () => void looked.pulls++,
    repo: async () => "o/r",
    token: async () => "t",
    active: () => true,
    pendingHeads: () => [],
    fetch: gh.fetch,
    ...over,
  });
  return { l, looked };
}

test("the boards are looked at again only when GitHub says something changed", async () => {
  const gh = fakeGitHub();
  const { l, looked } = live(gh);
  expect(await l.watch()).toEqual({ issues: false, pulls: false }); // the first answer is only remembered
  expect(await l.watch()).toEqual({ issues: false, pulls: false }); // 304
  gh.etags.set("/repos/o/r/issues", '"1"');
  expect(await l.watch()).toEqual({ issues: true, pulls: true });
  expect(looked).toEqual({ issues: 1, pulls: 1 });
});

test("running CI on an open PR is watched by its head's check suites", async () => {
  const gh = fakeGitHub();
  const { l, looked } = live(gh, { pendingHeads: () => ["abc"] });
  await l.watch();
  expect(gh.asked).toContain("/repos/o/r/commits/abc/check-suites");
  gh.etags.set("/repos/o/r/commits/abc/check-suites", '"done"');
  expect(await l.watch()).toEqual({ issues: false, pulls: true });
  expect(looked).toEqual({ issues: 0, pulls: 1 });
});

test("an idle floor isn't watched, and one GitHub refuses rests", async () => {
  const gh = fakeGitHub();
  let t = 0;
  const idle = live(gh, { active: () => false });
  await idle.l.watch();
  expect(gh.asked).toEqual([]);

  let tries = 0;
  const refused = (async () => (tries++, new Response("", { status: 404 }))) as unknown as typeof fetch;
  const { l } = live(gh, { fetch: refused, now: () => t, warn: () => {} });
  await l.watch();
  await l.watch();
  expect(tries).toBe(1);
  t = 11 * 60_000;
  await l.watch();
  expect(tries).toBe(2);
});

test("a worker's gh command looks again once it settles, and once more after", async () => {
  const gh = fakeGitHub();
  const { l, looked } = live(gh);
  l.ran("gh issue close 3");
  l.ran("gh issue comment 4 -b hi");
  l.ran("ls");
  expect(looked).toEqual({ issues: 0, pulls: 0 });
  await Bun.sleep(1_600);
  expect(looked).toEqual({ issues: 1, pulls: 0 });
  await Bun.sleep(5_100);
  expect(looked).toEqual({ issues: 2, pulls: 0 });
  l.stop();
}, 10_000);
