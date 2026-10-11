import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PULLS_FOLLOW_UP, pullsFollowUpClient, pullsFollowUpServer } from "../scripts/briefs.ts";
import { askOf, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let pkg = "";
beforeAll(async () => { pkg = await unpackPinned(); });

const BRIEFS = ["station.issues", "station.pulls", "station.queue"];
const DONE = "When you've done what was asked";

test("the pinned release's server prompts give only the PR agent the follow-up, just before its last line", async () => {
  const file = path.join(pkg, "dist/server/shared/prompts.js");
  const before = (await import(file)).PROMPTS;
  writeFileSync(file, pullsFollowUpServer(readFileSync(file, "utf8")));
  const after = (await import(`${file}?patched`)).PROMPTS;

  expect(after["station.pulls"].text).toBe(before["station.pulls"].text.replace(DONE, `${PULLS_FOLLOW_UP}\n\n${DONE}`));
  for (const id of Object.keys(before).filter(id => id !== "station.pulls")) expect(after[id]).toEqual(before[id]);
  expect(() => pullsFollowUpServer(readFileSync(file, "utf8"))).toThrow(/patch target moved/);
  expect(BRIEFS.filter(id => after[id].text.includes(PULLS_FOLLOW_UP))).toEqual(["station.pulls"]);
});

test("the pinned release's client bundle, which the prompt settings show defaults from, gets the same paragraph", () => {
  const js = readFileSync(askOf(pkg), "utf8");
  const patched = pullsFollowUpClient(js);
  expect(patched.split(JSON.stringify(PULLS_FOLLOW_UP)).length).toBe(2);
  expect(patched).toContain(`,cn,...(e === 'pulls' ? [${JSON.stringify(PULLS_FOLLOW_UP)}] : []),\`\${t?\`When you've queued it`);
  expect(patched.replace(/\.\.\.\(e === 'pulls' \? \[.*?\] : \[\]\),/, "")).toBe(js);
  // it still parses
  expect(() => new Bun.Transpiler({ loader: "js" }).scan(patched)).not.toThrow();
});

test("a moved target fails loudly instead of leaving the brief as it was", () => {
  expect(() => pullsFollowUpServer("export const PROMPTS = {};")).toThrow(/Agent Office changed: patch target moved in shared\/prompts\.js/);
  expect(() => pullsFollowUpClient("function ln(x){let t=x===`queue`;return[]}")).toThrow(/Agent Office changed: patch target moved in assets\/ask-\*\.js/);
  // so does patching twice, rather than adding the paragraph again
  const client = pullsFollowUpClient(readFileSync(askOf(pkg), "utf8"));
  expect(() => pullsFollowUpClient(client)).toThrow(/patch target moved/);
});
