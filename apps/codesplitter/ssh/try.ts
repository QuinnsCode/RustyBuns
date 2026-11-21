// Prove git over ssh:// through a Worker's connect() handler, locally (#5500): `bun ssh/try.ts` from apps/codesplitter.
// It makes a throwaway key, starts ssh/worker.ts under wrangler dev (Docker builds the sshd container the first time,
// a minute or so), then pushes a commit to ssh://git@127.0.0.1:8788/spike/demo.git, lists its refs and clones it
// back, each through Worker -> Durable Object -> container. It prints one line per step and exits 1 on the first
// that fails. Needs Docker running. Nothing touches Cloudflare: wrangler dev runs it all on this Mac.
//
//   bun ssh/try.ts                  the run above
//   bun ssh/try.ts --keep           leave wrangler dev up afterwards, and print the git line to try it by hand
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { help } from "../../../scripts/help.ts";

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

function step(name: string, ok: boolean, note = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? `: ${note}` : ""}`);
}

await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "codesplitter-ssh-spike", "-f", key]);
const pub = (await Bun.file(`${key}.pub`).text()).trim();

const dev = Bun.spawn(
  ["bunx", "wrangler@4.156.0", "dev", "--ip", "127.0.0.1", "--port", "8797", "--var", `AUTHORIZED_KEY:${pub}`],
  { cwd: here, stdout: "pipe", stderr: "pipe" },
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

let failed = false;
try {
  if (!(await Promise.race([ready, timeout]))) throw new Error(`wrangler dev never got ready:\n${log.slice(-2000)}`);
  step("wrangler dev up", true, "tcp 8788 -> connect() -> SshGate -> sshd");

  const work = path.join(tmp, "work");
  await run(["git", "init", "-q", "-b", "main", work]);
  await run(["git", "-c", "user.name=spike", "-c", "user.email=spike@example.invalid", "commit", "-q", "--allow-empty", "-m", "over ssh"], work);
  const head = await run(["git", "rev-parse", "HEAD"], work);

  await run(["git", "push", "-q", url, "HEAD:main"], work);
  step("git push", true, head.slice(0, 7));

  const refs = await run(["git", "ls-remote", url]);
  const listed = refs.includes(`${head}\trefs/heads/main`);
  step("git ls-remote", listed, listed ? "refs/heads/main is the pushed commit" : refs);
  if (!listed) failed = true;

  const back = path.join(tmp, "back");
  await run(["git", "clone", "-q", url, back]);
  const cloned = (await run(["git", "rev-parse", "HEAD"], back)) === head;
  step("git clone", cloned);
  if (!cloned) failed = true;

  const stranger = path.join(tmp, "stranger");
  await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", stranger]);
  try {
    await run(["git", "ls-remote", url], tmp, ssh.replace(key, stranger));
    step("other key refused", false, "a key nobody let in got the refs");
    failed = true;
  } catch {
    step("other key refused", true);
  }

  try {
    await run(["git", "ls-remote", "ssh://git@127.0.0.1:8788/../etc"]);
    step("bad path refused", false, "the container served it");
    failed = true;
  } catch {
    step("bad path refused", true);
  }
} catch (e) {
  step("run", false, e instanceof Error ? e.message : String(e));
  failed = true;
}

if (keep && !failed) {
  console.log(`\nwrangler dev is still up (Ctrl-C to stop). Try:\n  GIT_SSH_COMMAND="${ssh}" git ls-remote ${url}`);
  await dev.exited;
} else {
  dev.kill("SIGINT");
  await dev.exited;
}
// wrangler dev leaves the containers it started (sshd and its proxy) running; only this spike's are named like this.
const left = Bun.spawnSync(["docker", "ps", "-aq", "--filter", "name=workerd-codesplitter-ssh-spike-"]).stdout.toString().split("\n").filter(Boolean);
if (left.length) Bun.spawnSync(["docker", "rm", "-f", ...left]);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
