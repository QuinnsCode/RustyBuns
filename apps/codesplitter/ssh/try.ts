// Prove git over ssh:// through a Worker's connect() handler, locally (#5500, #5505, #5504): `bun ssh/try.ts` from
// apps/codesplitter. It makes a throwaway key and adds it as spike's through codeSplitter's POST /api/me/ssh-keys
// (codeSplitter booted in this process, src/local.ts), starts a stand-in for the parts codeSplitter doesn't answer yet
// on this Mac (the remote lookup and a smart-HTTP git remote that wants a Bearer token, like Artifacts; any other
// path goes to codeSplitter, so sshd's key lookups reach GET /api/ssh/key), starts codeSplitter's own Worker under
// wrangler dev from the config rustybuns generates with CODESPLITTER_SSH=1 and no other flag (its connect() on 8788, the
// SshGate container; Docker builds the sshd image the first time, a minute or so), then pushes a commit to
// ssh://git@127.0.0.1:8788/spike/demo.git, checks it landed in the HTTP remote, lists its refs and clones it back,
// each through Worker -> Durable Object -> container -> HTTP remote. It prints one line per step, with its time, and
// exits 1 if any failed. Last, spike's key is removed through the API and turned away on the next login. Needs
// Docker running. Nothing touches Cloudflare: wrangler dev runs it all on this Mac.
//
//   bun ssh/try.ts                  the run above
//   bun ssh/try.ts --keep           leave wrangler dev up afterwards, and print the git line to try it by hand
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { help } from "../../../scripts/help.ts";
import { got, local } from "../src/local.ts";
import { SshKeyRow } from "../src/ssh-key.ts";

help(import.meta.path);
const keep = process.argv.includes("--keep");
const here = import.meta.dir;
const tmp = mkdtempSync(path.join(tmpdir(), "codesplitter-ssh-"));
const key = path.join(tmp, "key");
const url = "ssh://git@127.0.0.1:8788/spike/demo.git";
const ssh = `ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;

/** Run a command, give back its stdout, or throw with its stderr. */
async function run(cmd: string[], cwd = tmp, sshCommand = ssh): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_SSH_COMMAND: sshCommand } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}: ${err.trim() || out.trim()}`);
  return out.trim();
}

/** Run a command that should fail; give back its stderr, or throw if it passed. */
async function refused(cmd: string[], sshCommand = ssh, cwd = tmp): Promise<string> {
  try {
    await run(cmd, cwd, sshCommand);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error(`${cmd.join(" ")} passed`);
}

let failed = false;
let clock = performance.now();
function step(name: string, ok: boolean, note = ""): void {
  const ms = Math.round(performance.now() - clock);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} (${ms} ms)${note ? `: ${note}` : ""}`);
  if (!ok) failed = true;
  clock = performance.now();
}

// The stand-in for codeSplitter: the lookup git-serve.sh asks, and the repos' smart-HTTP remote. Tokens are per mode,
// as Artifacts' are, and the remote turns down a push to `locked` the way codeSplitter turns down a protected branch.
const GATE_SECRET = crypto.randomUUID();
const READ = `read-${crypto.randomUUID()}`, WRITE = `write-${crypto.randomUUID()}`;
const root = path.join(tmp, "artifacts");
const remoteOf = (repo: string) => path.join(root, `${repo}.git`);
mkdirSync(path.join(root, "spike"), { recursive: true });
await run(["git", "init", "-q", "--bare", "-b", "main", remoteOf("spike/demo")]);
writeFileSync(path.join(remoteOf("spike/demo"), "hooks", "pre-receive"),
  `#!/bin/sh\nwhile read -r old new ref; do [ "$ref" = refs/heads/locked ] && { echo "locked is a protected branch: it changes through a merge" >&2; exit 1; }; done; exit 0\n`);
chmodSync(path.join(remoteOf("spike/demo"), "hooks", "pre-receive"), 0o755);
// codeSplitter itself, in alias mode (`call("spike", ...)` is spike signed in): the key store and its lookup.
const call = await local({ GH_CLI: "off" });
const backend = path.join((await run(["git", "--exec-path"])), "git-http-backend");

const site = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req): Promise<Response> {
    const u = new URL(req.url);
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (u.pathname === "/lookup") {
      if (bearer !== GATE_SECRET) return new Response("not the gate\n", { status: 401 });
      const [user, repo, mode] = ["user", "repo", "mode"].map((k) => u.searchParams.get(k) ?? "");
      if (user !== "spike") return new Response("no such user\n", { status: 403 });
      if (repo !== "spike/demo") return new Response("no such repo\n", { status: 404 });
      return new Response(`http://host.docker.internal:${site.port}/git/${repo}.git\n${mode === "write" ? WRITE : READ}\n`);
    }
    const m = u.pathname.match(/^\/git(\/[^/]+\/[^/]+\.git)(\/.*)$/);
    if (!m) return call(null, u.pathname + u.search, { method: req.method, headers: req.headers });
    const write = u.searchParams.get("service") === "git-receive-pack" || m[2] === "/git-receive-pack";
    if (bearer !== WRITE && (write || bearer !== READ)) return new Response("bad token\n", { status: 401 });
    // git http-backend as CGI: the request in env and stdin, headers then the body on stdout.
    const cgi = Bun.spawn([backend], {
      stdin: new Uint8Array(await req.arrayBuffer()),
      stdout: "pipe",
      stderr: "inherit",
      env: {
        GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: m[1] + m[2], QUERY_STRING: u.search.slice(1),
        REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers.get("content-type") ?? "", REMOTE_USER: "spike", REMOTE_ADDR: "127.0.0.1",
        HTTP_CONTENT_ENCODING: req.headers.get("content-encoding") ?? "", GIT_PROTOCOL: req.headers.get("git-protocol") ?? "",
        PATH: process.env.PATH ?? "",
      },
    });
    const out = new Uint8Array(await new Response(cgi.stdout).arrayBuffer());
    const split = Buffer.from(out).indexOf("\r\n\r\n");
    const headers = new Headers();
    let status = 200;
    for (const line of new TextDecoder().decode(out.subarray(0, split)).split("\r\n")) {
      const [k, ...v] = line.split(": ");
      if (k!.toLowerCase() === "status") status = Number.parseInt(v.join(": "), 10);
      else if (k) headers.set(k, v.join(": "));
    }
    return new Response(out.subarray(split + 4), { status, headers });
  },
});

await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "codesplitter-ssh-spike", "-f", key]);
const pub = (await Bun.file(`${key}.pub`).text()).trim();

await call("spike", "/api/login", { method: "POST", body: JSON.stringify({ name: "spike" }) });
const added = await got(call("spike", "/api/me/ssh-keys", { method: "POST", body: JSON.stringify({ key: pub, title: "try.ts" }) }), SshKeyRow, "add the key", (n) => n === 201);
step("key added through codeSplitter's API", true, added.fingerprint);

// codeSplitter's wrangler config as rustybuns generates it, with only the gate's flag on (any other flag would bind its
// container and build that image too) and a fresh migration list (the checked-in one names classes this run leaves
// out). It goes beside the checked-in wrangler.jsonc so its paths resolve the same, under its own name so its
// containers are this run's, and is deleted at the end.
for (const k of Object.keys(process.env)) if (/^CODESPLITTER_[A-Z_]+$/.test(k) && k !== "CODESPLITTER_URL" && k !== "CODESPLITTER_TOKEN") delete process.env[k];
process.env.CODESPLITTER_SSH = "1";
const { default: config } = await import("../rustybuns.config.ts");
const { generateWrangler } = await import("../../../packages/cli/src/gen/wrangler.ts");
const NAME = "codesplitter-ssh-try";
const app = path.join(here, "..");
const conf = path.join(app, "wrangler.ssh-try.jsonc");
writeFileSync(conf, generateWrangler({ ...config, name: NAME }, null));
mkdirSync(path.join(app, "dist", "client"), { recursive: true });

// KeyLookup runs in workerd on this Mac, so it reaches codeSplitter on 127.0.0.1; the container reaches the rest through Docker's host name.
const vars = { SSH_KEYS_URL: `http://127.0.0.1:${site.port}`, SSH_LOOKUP_URL: `http://host.docker.internal:${site.port}/lookup`, SSH_GATE_SECRET: GATE_SECRET };
const dev = Bun.spawn(
  ["bunx", "wrangler@4.156.0", "dev", "--config", conf, "--persist-to", path.join(tmp, "wrangler"), "--ip", "127.0.0.1", "--port", "8797",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { cwd: app, stdout: "pipe", stderr: "pipe" },
);
// Both of wrangler's streams are read to the end (a full pipe would stall it), and its "Ready on" line ends the wait.
let log = "";
let markReady: (up: boolean) => void = () => {};
const ready = new Promise<boolean>((r) => (markReady = r));
async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    log += decoder.decode(chunk);
    if (log.includes("Ready on")) markReady(true);
  }
}
void Promise.all([drain(dev.stdout), drain(dev.stderr)]).then(() => markReady(false));
const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 300_000));

try {
  if (!(await Promise.race([ready, timeout]))) throw new Error(`wrangler dev never got ready:\n${log.slice(-2000)}`);
  step("wrangler dev up", true, "tcp 8788 -> connect() -> SshGate -> sshd -> HTTP remote");

  const work = path.join(tmp, "work");
  const commit = (m: string) => run(["git", "-c", "user.name=spike", "-c", "user.email=spike@example.invalid", "commit", "-q", "--allow-empty", "-m", m], work);
  await run(["git", "init", "-q", "-b", "main", work]);
  await commit("over ssh");
  let head = await run(["git", "rev-parse", "HEAD"], work);

  // The first push reaches sshd cold, so the step after it is the fair time for one push.
  await run(["git", "push", "-q", url, "HEAD:main"], work);
  step("git push (cold)", true, head.slice(0, 7));
  const landed = async () => (await run(["git", "--git-dir", remoteOf("spike/demo"), "rev-parse", "main"])) === head;
  step("it landed in the HTTP remote", await landed());

  await commit("again");
  head = await run(["git", "rev-parse", "HEAD"], work);
  await run(["git", "push", "-q", url, "HEAD:main"], work);
  step("git push (warm), onto the one before", await landed(), head.slice(0, 7));

  const refs = await run(["git", "ls-remote", url]);
  const listed = refs.includes(`${head}\trefs/heads/main`);
  step("git ls-remote", listed, listed ? "refs/heads/main is the pushed commit" : refs);

  const back = path.join(tmp, "back");
  await run(["git", "clone", "-q", url, back]);
  step("git clone over ssh", (await run(["git", "rev-parse", "HEAD"], back)) === head);

  // The same clone straight from the HTTP remote, to see what the bridge costs on top.
  const direct = path.join(tmp, "direct");
  await run(["git", "-c", `http.extraHeader=Authorization: Bearer ${READ}`, "clone", "-q", `http://127.0.0.1:${site.port}/git/spike/demo.git`, direct]);
  step("the same clone over HTTP, no bridge", (await run(["git", "rev-parse", "HEAD"], direct)) === head);

  const lockedSays = await refused(["git", "push", url, "HEAD:locked"], ssh, work);
  step("the HTTP remote's refusal reaches the client", lockedSays.includes("locked is a protected branch"), lockedSays.includes("protected") ? "" : lockedSays);
  const noLock = await run(["git", "--git-dir", remoteOf("spike/demo"), "for-each-ref", "refs/heads/locked"]);
  step("and nothing landed", noLock === "");

  const missing = await refused(["git", "ls-remote", "ssh://git@127.0.0.1:8788/spike/nothing.git"]);
  step("a repo the lookup refuses", missing.includes("no such repo"), missing.includes("no such repo") ? "" : missing);

  const stranger = path.join(tmp, "stranger");
  await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", stranger]);
  const strangerSays = await refused(["git", "ls-remote", url], ssh.replace(key, stranger));
  step("a key nobody added refused", strangerSays.includes("Permission denied"), strangerSays.includes("Permission denied") ? "" : strangerSays);

  await refused(["git", "ls-remote", "ssh://git@127.0.0.1:8788/../etc"]);
  step("bad path refused", true);

  // The container keeps no key list: once spike's key is removed, the next login asks and is told no.
  const removed = await call("spike", `/api/me/ssh-keys/${added.id}`, { method: "DELETE" });
  const goneSays = await refused(["git", "ls-remote", url]);
  step("the key refused once it's removed", removed.ok && goneSays.includes("Permission denied"), removed.ok ? "" : `the DELETE answered ${removed.status}`);
} catch (e) {
  step("run", false, e instanceof Error ? e.message : String(e));
}

if (keep && !failed) {
  console.log(`\nwrangler dev is still up (Ctrl-C to stop). Try:\n  GIT_SSH_COMMAND="${ssh}" git ls-remote ${url}`);
  await dev.exited;
} else {
  dev.kill("SIGINT");
  await dev.exited;
}
site.stop(true);
call.close();
// wrangler dev leaves the containers it started (sshd and its proxy) running; only this run's are named like this.
const left = Bun.spawnSync(["docker", "ps", "-aq", "--filter", `name=workerd-${NAME}-`]).stdout.toString().split("\n").filter(Boolean);
if (left.length) Bun.spawnSync(["docker", "rm", "-f", ...left]);
rmSync(conf, { force: true });
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
