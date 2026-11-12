// The page tutorial.test.ts loads: a three-step tutorial on flags the test sets, with a stand-in eqosys account
// (`?account=done` says this player finished it on another device).
import { tutorial } from "../src/tutorial.ts";

const flags = { a: false, b: false, c: false };
const sent: string[] = [];
let finished = 0;
const done = new URLSearchParams(location.search).get("account") === "done";
const coach = tutorial({
  prefix: "t",
  account: { achieve: (id) => { sent.push(id); }, achievements: async () => [{ id: "tutorial", at: done ? 1 : null }] },
  steps: [
    { title: "Move", keys: ["W"], done: () => flags.a },
    { title: "Jump", done: () => flags.b },
    { title: "Land", done: () => flags.c },
  ],
  onDone: () => { finished++; },
});
Object.assign(window, { t: { coach, flags, sent, finished: () => finished, card: () => document.querySelector(".eq-coach")?.textContent ?? null } });
