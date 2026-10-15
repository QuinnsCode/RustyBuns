// Run the suites a PR touched on the builder Mac over SSH (notes/local-build-monster.md, issue #1797).
// Read-only on the PR: it fetches the commit on the builder and never pushes.
//
//   bun scripts/remote-ci.ts <base-ref>       BUILDER_HOST=max BUILDER_DIR=~/builder/RustyBuns BUILDER_WORKERS=4
//
// BUILDER_HOST is an ssh name (a Tailscale name works). BUILDER_WORKERS caps how many suites run at once;
// set it from the memory numbers on that machine, lower on a 16GB Mac. Exits with the worst suite's code.
// Only run your own branches: the builder runs what it fetches, so keep untrusted PRs in a sandbox.
export type Job = { app: string; test: string; prep: string };

// The `apps=` line of `ci-apps.ts test`: only apps with a test command run here.
export function parseJobs(out: string): Job[] {
  const line = out.split("\n").find((l) => l.startsWith("apps="));
  if (!line) throw new Error("no apps= line in ci-apps output");
  const { include } = JSON.parse(line.slice(5)) as { include: Job[] };
  return include.filter((j) => j.test);
}

// Run `fn` over items with at most `cap` at a time; the result is the worst (highest) code.
export async function pool<T>(items: T[], cap: number, fn: (item: T) => Promise<number>): Promise<number> {
  let worst = 0, next = 0;
  const lane = async () => { while (next < items.length) worst = Math.max(worst, await fn(items[next++]!)); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, lane));
  return worst;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const ssh = (host: string, script: string) => Bun.spawn(["ssh", host, script], { stdout: "pipe", stderr: "pipe" });

async function stream(p: ReturnType<typeof ssh>, label: string) {
  const pipe = async (s: ReadableStream<Uint8Array>) => { for await (const line of new Response(s).text().then((t) => t.split("\n"))) if (line) console.log(`[${label}] ${line}`); };
  await Promise.all([pipe(p.stdout as ReadableStream<Uint8Array>), pipe(p.stderr as ReadableStream<Uint8Array>)]);
  return p.exited;
}

if (import.meta.main) {
  const base = process.argv[2];
  const host = process.env.BUILDER_HOST;
  if (!base || !host) throw new Error("usage: BUILDER_HOST=<ssh name> bun scripts/remote-ci.ts <base-ref>");
  const dir = process.env.BUILDER_DIR ?? "~/builder/RustyBuns";
  const cap = Number(process.env.BUILDER_WORKERS ?? 4);
  const jobs = parseJobs(await Bun.$`bun scripts/ci-apps.ts test ${base}`.text());
  if (!jobs.length) { console.log("no suites touched"); process.exit(0); }
  const sha = (await Bun.$`git rev-parse HEAD`.text()).trim();
  const origin = (await Bun.$`git remote get-url origin`.text()).trim();
  const setup = await stream(ssh(host, `cd ${dir} && git fetch -q ${q(origin)} && git checkout -q --detach ${sha} && bun install --frozen-lockfile`), "setup");
  if (setup) process.exit(setup);
  console.log(`running ${jobs.map((j) => j.app).join(", ")} on ${host}, ${cap} at a time`);
  process.exit(await pool(jobs, cap, (j) =>
    stream(ssh(host, `cd ${dir}/apps/${j.app} && ${j.prep ? `${j.prep} && ` : ""}${j.test}`), j.app)));
}
