// Where `external` plugs into the release: the issue and PR lists run each item's labels through external()
// (built from external/server.ts into rb-external.js), which adds the label for authors outside the team.

export const EXTERNAL_IMPORT = "import { external as __rbExternal } from './rb-external.js';\n";

/** server/github.js */
export function externalServer(js: string) {
  const issue = "                labels: labels(i.labels),\n";
  const pull = "                labels: labels(p.labels),\n";
  return once(once(js, issue, "                labels: __rbExternal(labels(i.labels), i.author?.login, this.dir),\n"),
    pull, "                labels: __rbExternal(labels(p.labels), p.author?.login, this.dir),\n");
}

function once(s: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in github.js: ${from.trim()}`);
  return s.replace(from, () => to);
}
