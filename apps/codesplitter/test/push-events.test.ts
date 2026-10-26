import { expect, setDefaultTimeout, test } from "bun:test";
import { local, post } from "./app-kit.ts";
import app from "../src/worker.ts";

setDefaultTimeout(30_000);

test("a push from outside the app goes in the repo's audit log; ours and odd messages don't", async () => {
  const call = await local();
  await post(call, "ryan", "/api/login", { name: "ryan" });
  await post(call, "ryan", "/api/repos", { name: "lab", visibility: "public" });
  const { artifact } = (await call.env.DB.prepare("SELECT artifact FROM repos WHERE owner = 'ryan' AND name = 'lab'").first()) as { artifact: string };
  const pushed = (emails: string[]) => ({
    type: "cf.artifacts.repo.pushed", source: { type: "artifacts.repo", namespace: "codesplitters", repoName: artifact },
    payload: { ref: "refs/heads/main", before: "0".repeat(40), after: "a".repeat(40), totalCommitsCount: emails.length, commitsTruncated: false,
      commits: emails.map((email, i) => ({ id: String(i).repeat(40), message: "x", messageTruncated: false, author: { name: "x", email } })) },
    metadata: {},
  });
  const hear = (...bodies: unknown[]) => app.queue({ messages: bodies.map((body) => ({ body, ack() {} })) }, call.env);

  await hear(
    pushed(["ryan@codesplitters.local"]),
    pushed(["ryan@laptop.example", "ryan@laptop.example", "agent-claude@codesplitters.local"]),
    { type: "cf.artifacts.repo.pushed", source: "not an object" },
    { type: "cf.artifacts.repo.cloned", source: { repoName: artifact }, payload: {} },
  );
  const log = (await (await call("ryan", "/api/repos/ryan/lab/audit")).json()) as { action: string; detail: string; via: string }[];
  expect(log.filter((r) => r.action === "git.push").map((r) => [r.detail, r.via])).toEqual([["pushed from outside: 2 commits to main", "job"]]);
});
