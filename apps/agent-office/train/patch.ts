// Where the merge train plugs into the release: server/github.js's merge(…, auto) joins the floor's line
// (train/server.ts) instead of `gh pr merge --auto`, and the PR list gains each PR's spot in it, which the card's
// checks bar (checks/index.ts) shows. Runs after checks/patch.ts, which adds the checkTally line.

/** server/github.js */
export function mergeTrainServer(js: string) {
  js = once(js, "github.js", "    async merge(n, method, deleteBranch, auto, as) {\n",
    "    async merge(n, method, deleteBranch, auto, as) {\n        if (auto && this.__rbTrain)\n            return this.__rbTrain.join(n, method, deleteBranch);\n");
  const tally = "                checkTally: __rbTally(p.statusCheckRollup),\n";
  return once(js, "github.js", tally, `${tally}                train: this.__rbTrain?.card(p.number),\n`);
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
