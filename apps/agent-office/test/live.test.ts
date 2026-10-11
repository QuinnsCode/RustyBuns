import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Forward, heard, LiveGitHub, signed, touches, type Deps, type Touch } from "../live/github.ts";

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

test("webhook events touch the boards they can change; a ping doesn't", () => {
  expect(heard("issues")).toEqual({ issues: true, pulls: false });
  expect(heard("pull_request")).toEqual({ issues: true, pulls: true });
  expect(heard("check_suite")).toEqual({ issues: false, pulls: true });
  expect(heard("ping")).toBeUndefined();
  expect(heard(null)).toBeUndefined();
  expect(signed("s", "{}", `sha256=${createHmac("sha256", "s").update("{}").digest("hex")}`)).toBe(true);
  expect(signed("s", "{}", "sha256=00")).toBe(false);
  expect(signed("s", "{}", null)).toBe(false);
});

test("while webhooks are forwarded, the watch stands down", async () => {
  const gh = fakeGitHub();
  const { l } = live(gh);
  l.pushed = true;
  await l.watch();
  expect(gh.asked).toEqual([]);
});

test("the forwarder's signed deliveries reach the boards, and it comes up and goes down with gh", async () => {
  const got: Touch[] = [];
  const ups: boolean[] = [];
  let url = "";
  let secret = "";
  const f = new Forward({
    repo: async () => "o/r",
    cwd: ".",
    heard: (t) => got.push(t),
    up: (on) => ups.push(on),
    // stands in for `gh webhook forward`: says it's up, then waits
    command: (repo, u, s) => {
      expect(repo).toBe("o/r");
      url = u;
      secret = s;
      return ["bun", "-e", "console.error('Forwarding Webhook events from GitHub...'); await Bun.sleep(60_000)"];
    },
  });
  await f.start();
  for (let i = 0; i < 50 && !ups.length; i++) await Bun.sleep(100);
  expect(ups).toEqual([true]);

  const send = (event: string, body: string, sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`) =>
    fetch(url, { method: "POST", body, headers: { "x-github-event": event, "x-hub-signature-256": sig } });
  expect((await send("pull_request", "{}")).status).toBe(204);
  expect((await send("ping", "{}")).status).toBe(204);
  expect((await send("issues", "{}", "sha256=forged")).status).toBe(401);
  expect(got).toEqual([{ issues: true, pulls: true }]);

  f.stop();
  expect(ups.at(-1)).toBe(false);
}, 10_000);
