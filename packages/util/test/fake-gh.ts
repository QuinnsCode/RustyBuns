import { ghTrain } from "../src/train.ts";

// A local fake of `gh` over a tiny repo: a tree defines names and uses names, and the typecheck passes when
// every name used is defined. A PR is a change applied to the main commit its branch was last updated from.
type Tree = { defines: string[]; uses: string[] };
type Change = { drop?: string[]; add?: string[]; use?: string[] };
const apply = (t: Tree, c: Change): Tree => ({
  defines: [...t.defines.filter((d) => !c.drop?.includes(d)), ...(c.add ?? [])],
  uses: [...t.uses, ...(c.use ?? [])],
});
const typechecks = (t: Tree) => t.uses.every((u) => t.defines.includes(u));

export function fakeGitHub(start: Tree) {
  const R = "o/r";
  let n = 0;
  const trees = new Map<string, Tree>();
  const commit = (t: Tree) => { const sha = `c${++n}`.padEnd(12, "0"); trees.set(sha, t); return sha; };
  const main = [commit(start)];
  const prs = new Map<number, { change: Change; at: number; head: string; state: "OPEN" | "MERGED"; ran: Set<string> }>();
  const calls: string[] = [];
  const open = (pr: number, change: Change) => {
    const at = main.length - 1;
    prs.set(pr, { change, at, head: commit(apply(trees.get(main[at]!)!, change)), state: "OPEN", ran: new Set() });
  };
  const run = async (a: string[]) => {
    calls.push(a.slice(0, 2).join(" "));
    // what the office's PR board asks
    if (a[0] === "repo" && a[1] === "view") return JSON.stringify({ nameWithOwner: R, squashMergeAllowed: true });
    if (a[0] === "pr" && a[1] === "list") {
      const want = a[a.indexOf("--state") + 1]!.toUpperCase();
      return JSON.stringify([...prs].filter(([, p]) => p.state === want).map(([number, p]) => ({ number, title: `#${number}`, state: p.state, headRefOid: p.head })));
    }
    if (a[0] === "pr") {
      const p = prs.get(Number(a[2]))!;
      if (a[1] === "view") {
        // CI reports on a new head one look later
        const done = p.ran.has(p.head);
        p.ran.add(p.head);
        const check = { name: "typecheck", status: done ? "COMPLETED" : "IN_PROGRESS", conclusion: done ? (typechecks(trees.get(p.head)!) ? "SUCCESS" : "FAILURE") : "" };
        return JSON.stringify({ state: p.state, headRefOid: p.head, baseRefName: "main", mergeable: "MERGEABLE", statusCheckRollup: [check] });
      }
      if (a[1] === "update-branch") {
        p.at = main.length - 1;
        p.head = commit(apply(trees.get(main[p.at]!)!, p.change));
        return "";
      }
      if (a[1] === "merge") {
        if (a.includes("--auto")) throw new Error("the train never turns on auto-merge");
        if (a[a.indexOf("--match-head-commit") + 1] !== p.head) throw new Error("head moved");
        main.push(commit(apply(trees.get(main.at(-1)!)!, p.change)));
        p.state = "MERGED";
        return "";
      }
    }
    const compare = a[1]?.match(/^repos\/o\/r\/compare\/main\.\.\.(\w+)$/);
    if (compare) {
      const pr = [...prs.values()].find((p) => p.head === compare[1])!;
      return JSON.stringify({ behind_by: main.length - 1 - pr.at, base_commit: { sha: main.at(-1) } });
    }
    const runs = a[1]?.match(/^repos\/o\/r\/commits\/(\w+)\/check-runs/);
    if (runs) return JSON.stringify({ check_runs: [{ name: "typecheck", conclusion: typechecks(trees.get(runs[1]!)!) ? "success" : "failure" }] });
    throw new Error(`fake gh: ${a.join(" ")}`);
  };
  const greenAlone = (pr: number) => typechecks(trees.get(prs.get(pr)!.head)!);
  const fixMain = (c: Change) => main.push(commit(apply(trees.get(main.at(-1)!)!, c)));
  return { run, gh: ghTrain(run, R), open, calls, greenAlone, fixMain, prs, mainGreen: () => typechecks(trees.get(main.at(-1)!)!) };
}
