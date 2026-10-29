// Manual run #2290 in one command: open a file's live socket as a collaborator, let it idle until the Durable Object
// hibernates, take the collaborator out of the repo as the owner, and say whether the socket closed.
//
//   bun scripts/revoke-socket.ts https://codesplitter.example ann/hono src/app.ts \
//     --collab-token T1 --owner-token T2 --remove bob [--idle 90]
//
// Tokens are codeSplitter API tokens (read the names, not the values, from your own settings); nothing is stored.
const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const [base, repo, path] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const [collab, owner, remove, idle] = [flag("collab-token"), flag("owner-token"), flag("remove"), Number(flag("idle") ?? 90)];
if (!base || !repo?.includes("/") || !path || !collab || !owner || !remove) {
  console.error("usage: bun scripts/revoke-socket.ts <base-url> <owner/repo> <path> --collab-token T --owner-token T --remove <handle> [--idle seconds]");
  process.exit(2);
}
const wsUrl = `${base.replace(/^http/, "ws")}/api/repos/${repo}/do/ws?path=${encodeURIComponent(path)}`;
const open = (token: string) => new Promise<WebSocket>((res, rej) => {
  const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token}` } });
  ws.onopen = () => res(ws); ws.onerror = () => rej(new Error("upgrade refused"));
});

const ws = await open(collab);
const closed = new Promise<CloseEvent>((r) => { ws.onclose = r; });
console.log(`socket open; idling ${idle}s so the Durable Object hibernates`);
await Bun.sleep(idle * 1000);

const res = await fetch(`${base}/api/repos/${repo}/collaborators/${encodeURIComponent(remove)}`, { method: "DELETE", headers: { authorization: `Bearer ${owner}` } });
console.log(`removed ${remove}: HTTP ${res.status}`);
const ev = await Promise.race([closed, Bun.sleep(10_000).then(() => null)]);
console.log(ev ? `PASS socket closed: ${ev.code} ${ev.reason}` : "FAIL socket still open 10s after the removal");

const again = await open(collab).then((w) => { w.close(); return "FAIL reconnect was accepted"; }, () => "PASS reconnect refused");
console.log(again);
process.exit(ev && again.startsWith("PASS") ? 0 : 1);
