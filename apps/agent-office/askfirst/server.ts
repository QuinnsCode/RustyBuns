// The shutoff valves' route (built into rb-askfirst.js): GET /__rb/grants gives { office, repos: [{ repo, on }] },
// POST /__rb/grants?do=office&on=1|0 switches every GitHub write in the office on or off, and
// POST /__rb/grants?do=repo&repo=o/n&on=1|0|ask switches one repo (ask forgets it, so the next write asks again).
// Signed-in people only, and a POST needs the X-RB-Ask header like an answer to a card.
// the hook port's /office/workers/write reads the worker's command with this
export { commandOf } from "./hook.ts";
import { readGate, setOffice, setRepo, type Gate } from "./grants.ts";

const view = (g: Gate) => ({ office: g.office, repos: Object.entries(g.repos).map(([repo, on]) => ({ repo, on })) });

export function grantsRoute(dir: () => string) {
  return (method: string, url: URL, trusted: boolean): { status: number; body: unknown } | null => {
    if (url.pathname !== "/__rb/grants") return null;
    if (method === "GET") return { status: 200, body: view(readGate(dir())) };
    if (method !== "POST") return { status: 405, body: { error: "GET or POST /__rb/grants" } };
    if (!trusted) return { status: 403, body: { error: "Send x-rb-ask: 1 with the POST" } };
    const what = url.searchParams.get("do"), repo = url.searchParams.get("repo") ?? "", on = url.searchParams.get("on");
    if (what === "office") {
      if (on !== "1" && on !== "0") return { status: 400, body: { error: "on=1 or on=0" } };
      return { status: 200, body: view(setOffice(dir(), on === "1")) };
    }
    if (what !== "repo") return { status: 400, body: { error: "do=office or do=repo" } };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { status: 400, body: { error: "repo should look like owner/name" } };
    if (on !== "1" && on !== "0" && on !== "ask") return { status: 400, body: { error: "on=1, on=0 or on=ask" } };
    return { status: 200, body: view(setRepo(dir(), repo, on === "ask" ? null : on === "1")) };
  };
}
