import { expect, test } from "bun:test";
import { issueNumber, issueText, issuesIn, matches } from "../queue/match.ts";

test("every word has to show up, ignoring case", () => {
  expect(matches("", "anything")).toBe(true);
  expect(matches("  ", "anything")).toBe(true);
  expect(matches("Queue SEARCH", "a search box for the queue")).toBe(true);
  expect(matches("queue rocket", "a search box for the queue")).toBe(false);
});

test("an issue is searched by its title, body and labels", () => {
  const text = issueText({ number: 7, title: "Druid panels glow", body: "They should pulse at night", labels: [{ name: "skin" }] });
  expect(matches("pulse night", text)).toBe(true);
  expect(matches("skin", text)).toBe(true);
  expect(issueText({ number: 8 })).toBe("");
});

test("a task's link gives its issue number, and only an issue's", () => {
  expect(issueNumber("https://github.com/QuinnsCode/RustyBuns/issues/42")).toBe(42);
  expect(issueNumber("https://github.com/o/r/issues/42#issuecomment-1")).toBe(42);
  expect(issueNumber("https://github.com/o/r/pull/42")).toBeUndefined();
  expect(issueNumber(null)).toBeUndefined();
});

test("issues come off the snapshots and board refreshes, nothing else is parsed", () => {
  const items = [{ number: 1, title: "one", body: "first" }];
  expect(issuesIn(JSON.stringify({ t: "welcome", me: {}, issues: { items } }))).toEqual(items);
  expect(issuesIn(JSON.stringify({ t: "floor.enter", issues: { items } }))).toEqual(items);
  expect(issuesIn(JSON.stringify({ t: "gh.issues", state: { items, loading: false } }))).toEqual(items);
  expect(issuesIn(JSON.stringify({ t: "gh.issues", state: { loading: true } }))).toBeUndefined();
  expect(issuesIn(JSON.stringify({ t: "screen", issues: { items } }))).toBeUndefined();
  expect(issuesIn('{"t":"gh.issues", broken')).toBeUndefined();
  expect(issuesIn(new ArrayBuffer(4))).toBeUndefined();
});
