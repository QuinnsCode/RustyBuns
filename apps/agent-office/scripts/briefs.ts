// The PR agent's brief also has it follow up with workers once their pull requests merge. stationDefault(kind)
// builds every station agent's brief, once in the server (shared/prompts.js) and once in the client bundle
// (assets/ask-*.js) the prompt settings show the defaults from; both get the same paragraph, for 'pulls' only.

export const PULLS_FOLLOW_UP =
  `After a worker's pull request merges, tell that worker "Looks like you merged!" (tell_worker) and read what it says. ` +
  `If it mentions anything undone, tell it: "Put the unfinished work in no more than three GitHub issues on this repo, ` +
  `link them on the PR, and reply with the links." Include those links in your report. If the worker's worktree was ` +
  `deleted (list_workers shows worktree.deleted), it can't start again to answer: check the PR yourself for loose ends ` +
  `and file them the same way, at most three issues.`;

const paragraph = (kind: string) => `...(${kind} === 'pulls' ? [${JSON.stringify(PULLS_FOLLOW_UP)}] : []),`;

/** shared/prompts.js, with the paragraph just before the "When you've done what was asked" line. */
export function pullsFollowUpServer(js: string) {
  return once(js, "shared/prompts.js", "        QUEUE_API,\n        `${queue ? \"When you've queued it",
    `        QUEUE_API,\n        ${paragraph("kind")}\n        \`\${queue ? "When you've queued it`);
}

/** The client bundle's copy of stationDefault, minified. */
export function pullsFollowUpClient(js: string) {
  // the paragraph's guard names stationDefault's parameter, e
  once(js, "assets/ask-*.js", "{let t=e===`queue`;return[", "");
  return once(js, "assets/ask-*.js", ",cn,`${t?`When you've queued it", `,cn,${paragraph("e")}\`\${t?\`When you've queued it`);
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
