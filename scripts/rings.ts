// Release rings (notes/RELEASE_RINGS.md, #4486): each ring is a `ring/<name>` commit status on the SHAs it tested
// and a ref `refs/ring/<name>` that moves forward to the newest green one. desktop-hourly.yml calls this.
//
//   bun scripts/rings.ts gate <ring> <sha>                   prints run=true|false: false when <sha> already has a
//                                                            ring/<ring> status (main hasn't moved since the last run)
//   bun scripts/rings.ts status <ring> <sha> <state> <url>   writes the ring/<ring> status (success or failure) on <sha>
//   bun scripts/rings.ts move <ring> <sha>                   points refs/ring/<ring> at <sha>; without the permission
//                                                            (MANUAL RUN #4495) it says so and exits 0
//   bun scripts/rings.ts range <ring> <sha>                  a markdown line: the commits since the last green, for
//                                                            the failure issue
//
// Needs GH_TOKEN and GITHUB_REPOSITORY (owner/name), as in a workflow.
import { arr, nul, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

/** A commit on main, newest first, with its ring status (undefined when the ring never ran it). */
export type Tested = { sha: string; state?: string };

/** The commits since the last green one, newest first, and that green SHA; `green` is undefined when none was in view. */
export function sinceLastGreen(history: Tested[]): { green?: string; shas: string[] } {
  const at = history.findIndex((c) => c.state === "SUCCESS" || c.state === "success");
  return at < 0 ? { shas: history.map((c) => c.sha) } : { green: history[at]!.sha, shas: history.slice(0, at).map((c) => c.sha) };
}

/** The markdown line for the failure issue. */
export function rangeLine(repo: string, history: Tested[]): string {
  const { green, shas } = sinceLastGreen(history);
  const head = shas[0] ?? history[0]?.sha ?? "";
  if (!green) return `No green ring run in the last ${history.length} commits; newest is ${head.slice(0, 7)}.`;
  if (!shas.length) return `${head.slice(0, 7)} was green last time.`;
  return `Since the last green (${green.slice(0, 7)}): ${shas.length} commit${shas.length === 1 ? "" : "s"}, `
    + `https://github.com/${repo}/compare/${green}...${head}`;
}

const Reply = obj({
  data: obj({
    repository: obj({
      object: nul(obj({
        history: opt(obj({
          nodes: arr(obj({
            oid: str(64),
            status: nul(obj({ contexts: arr(obj({ context: str(200), state: str(20) }), 200) })),
          }), 100),
        })),
      })),
    }),
  }),
});

/** The last `n` commits on <sha>'s first-parent line, newest first, with their ring/<ring> state, in one GraphQL call. */
async function history(repo: string, ring: string, sha: string, n = 100): Promise<Tested[]> {
  const [owner, name] = repo.split("/");
  const q = `query($o:String!,$n:String!,$s:GitObjectID!,$k:Int!){repository(owner:$o,name:$n){object(oid:$s){... on Commit{history(first:$k){nodes{oid status{contexts{context state}}}}}}}}`;
  const out = await Bun.$`gh api graphql -f query=${q} -f o=${owner!} -f n=${name!} -f s=${sha} -F k=${n}`.quiet().text();
  const reply = Reply(JSON.parse(out));
  return (reply.data.repository.object?.history?.nodes ?? []).map((c) => ({
    sha: c.oid, state: c.status?.contexts.find((x) => x.context === `ring/${ring}`)?.state,
  }));
}

if (import.meta.main) {
  help(import.meta.path);
  const [cmd, ring = "", sha = "", ...rest] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!cmd || !/^[a-z]+$/.test(ring) || !/^[0-9a-f]{40}$/.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("usage: bun scripts/rings.ts gate|status|move|range <ring> <40-char sha> [...] (with GITHUB_REPOSITORY set); --help");
    process.exit(2);
  }
  if (cmd === "gate") {
    const [head] = await history(repo, ring, sha, 1);
    console.log(`run=${!head?.state}`);
    if (head?.state) console.error(`${sha.slice(0, 7)} already has ring/${ring} ${head.state.toLowerCase()}: main hasn't moved, skipping`);
  } else if (cmd === "status") {
    const [state = "", url = ""] = rest;
    if (state !== "success" && state !== "failure") throw new Error("state is success or failure");
    await Bun.$`gh api repos/${repo}/statuses/${sha} -f state=${state} -f context=${`ring/${ring}`} -f target_url=${url} -f description=${`${ring} ring ${state === "success" ? "green" : "red"}`}`.quiet();
    console.log(`ring/${ring} ${state} on ${sha.slice(0, 7)}`);
  } else if (cmd === "move") {
    const ref = `ring/${ring}`;
    // Update it if it exists, create it if it doesn't. A ring only moves forward, so no force.
    let r = await Bun.$`gh api -X PATCH repos/${repo}/git/refs/${ref} -f sha=${sha} -F force=false`.quiet().nothrow();
    if (r.exitCode && /Reference does not exist|Not Found/.test(r.stdout.toString() + r.stderr.toString()))
      r = await Bun.$`gh api repos/${repo}/git/refs -f ref=${`refs/${ref}`} -f sha=${sha}`.quiet().nothrow();
    if (r.exitCode) {
      const why = (r.stdout.toString() + r.stderr.toString()).trim().split("\n").slice(-1)[0];
      console.log(`::warning::refs/${ref} not moved to ${sha.slice(0, 7)} (${why}). The workflow can't write refs yet: MANUAL RUN #4495.`);
    } else console.log(`refs/${ref} -> ${sha.slice(0, 7)}`);
  } else if (cmd === "range") {
    console.log(rangeLine(repo, await history(repo, ring, sha)));
  } else {
    console.error(`unknown command ${cmd}; --help`);
    process.exit(2);
  }
}
