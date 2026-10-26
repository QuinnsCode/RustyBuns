// CI's `containers` job (#1689, #818 part 2): build and smoke-test the container images a PR touched.
//
//   bun scripts/ci-containers.ts plan <base-ref>      the bindings to check, per app, as `key=json` lines for $GITHUB_OUTPUT
//   bun scripts/ci-containers.ts check <base-ref>     plan, then run every touched app: what the workflow calls
//   bun scripts/ci-containers.ts run <app> [BINDING…] build and boot them, a table in $GITHUB_STEP_SUMMARY, exit 1 if one fails
//
// An app's bindings come from its rustybuns.config.ts (the Dockerfile and its context folder). A binding is
// touched when the diff is inside its context, or in the CLI's generator (packages/cli/src/gen/).
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContainerBinding, buildOne, containerBindings, mb, smokeOne } from "../packages/cli/src/containers.ts";

/** The bindings a diff touches: those whose context folder holds a changed file, all of them when the generator moved. */
export function touched(bindings: ContainerBinding[], changed: string[], appDir: string): string[] {
  if (changed.some((f) => f.startsWith("packages/cli/src/gen/"))) return bindings.map((b) => b.name);
  return bindings.filter((b) => changed.some((f) => f.startsWith(`${appDir}/${b.context === "." ? "" : b.context + "/"}`))).map((b) => b.name);
}

/** The Dockerfile line a failed build names ("Dockerfile:12"), or null. */
export function failedLine(out: string): string | null {
  const m = /(\S*Dockerfile\S*):(\d+)/.exec(out);
  return m ? `${m[1]} line ${m[2]}` : null;
}

/** A size against main's build of the same image: "+4 MB", "-2 MB", "same", or "new" when main has none. */
export function delta(size: number, base?: number): string {
  if (base === undefined) return "new";
  const d = Math.round((size - base) / 1e6);
  return d === 0 ? "same" : `${d > 0 ? "+" : "-"}${Math.abs(d)} MB`;
}

export interface Row { name: string; dockerfile: string; ok: boolean; build?: string; size?: string; delta?: string; boot?: string; fail?: string }

/** The job summary: one row per image, and for each failure its Dockerfile line and the build's last lines. */
export function summary(rows: Row[]): string {
  if (!rows.length) return "No container images were touched by this PR.\n";
  const table = ["| Image | Build | Size | Boot |", "|---|---|---|---|",
    ...rows.map((r) => `| \`${r.name}\` (${r.dockerfile}) | ${r.ok ? "✅" : "❌"} ${r.build ?? ""} | ${r.size ?? ""}${r.delta ? ` (${r.delta} vs main)` : ""} | ${r.boot ?? ""} |`)];
  const fails = rows.filter((r) => !r.ok).map((r) => `\n**${r.name}** failed${failedLine(r.fail ?? "") ? ` at ${failedLine(r.fail!)}` : ""}:\n\`\`\`\n${r.fail}\n\`\`\``);
  return table.join("\n") + "\n" + fails.join("\n") + "\n";
}

/** The size of `b` as built at `base` (main), or undefined when main has no such image. Builds from a `git archive` of the app at that ref. */
async function baseSize(app: string, b: ContainerBinding, base: string): Promise<number | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "ci-base-")), here = process.cwd();
  try {
    await Bun.$`git archive ${base} apps/${app} | tar -x -C ${dir}`.quiet();
    if (!existsSync(`${dir}/apps/${app}/${b.dockerfile}`)) return undefined;
    process.chdir(`${dir}/apps/${app}`);
    return (await buildOne(`${app}-base`, b, { ghaCache: !!process.env.ACTIONS_RESULTS_URL, dir })).size;
  } catch { return undefined; } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The apps with bindings, and the ones the diff touched. */
async function plan(base: string) {
  const changed = (await Bun.$`git diff --name-only ${base}...HEAD`.text()).split("\n").filter(Boolean);
  const include: { app: string; bindings: string }[] = [];
  // A parked app (tscircuit-desktop) has no installed dependencies, so its config can't load.
  for (const app of readdirSync("apps").filter((d) => d !== "tscircuit-desktop" && existsSync(`apps/${d}/rustybuns.config.ts`))) {
    const hit = touched(containerBindings(await configOf(app)), changed, `apps/${app}`);
    if (hit.length) include.push({ app, bindings: hit.join(" ") });
  }
  return include;
}

async function configOf(app: string) {
  const mod = await import(`${process.cwd()}/apps/${app}/rustybuns.config.ts`);
  return mod.default as Parameters<typeof containerBindings>[0];
}

if (import.meta.main) {
  const [cmd, a1 = "", ...names] = process.argv.slice(2);
  if (cmd === "plan" || cmd === "check") {
    if (!a1) throw new Error(`${cmd} needs a base ref`);
    const include = await plan(a1);
    if (cmd === "plan") { console.log(`containers=${JSON.stringify({ include })}`); console.log(`any=${include.length > 0}`); }
    else {
      if (!include.length) { console.log("no container images touched"); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary([])); }
      for (const { app, bindings } of include) {
        const p = Bun.spawn(["bun", import.meta.path, "run", app, ...bindings.split(" ")], { stdio: ["inherit", "inherit", "inherit"] });
        if ((await p.exited) !== 0) process.exitCode = 1;
      }
    }
  } else if (cmd === "run") {
    process.chdir(`apps/${a1}`);
    const cfg = (await import(`${process.cwd()}/rustybuns.config.ts`)).default;
    const bs = containerBindings(cfg).filter((b) => !names.length || names.includes(b.name));
    const rows: Row[] = [];
    for (const b of bs) {
      const row: Row = { name: b.name, dockerfile: b.dockerfile, ok: false };
      try {
        const r = await buildOne(a1, b, { ghaCache: !!process.env.ACTIONS_RESULTS_URL });
        Object.assign(row, { build: `${(r.ms / 1000).toFixed(0)}s`, size: mb(r.size) });
        if (process.env.BASE) row.delta = delta(r.size, await baseSize(a1, b, process.env.BASE));
        const s = await smokeOne(a1, b, { env: {} });
        row.ok = s.ok;
        if (s.ok) row.boot = /in ([\d.]+s)/.exec(s.note)?.[1]; else row.fail = s.note;
      } catch (e) { row.fail = (e as Error).message; }
      console.log(`${row.ok ? "✅" : "❌"} ${b.name} ${row.build ?? ""} ${row.size ?? ""} ${row.boot ?? ""}${row.fail ? "\n" + row.fail : ""}`);
      rows.push(row);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(rows));
    if (rows.some((r) => !r.ok)) process.exitCode = 1;
  } else throw new Error("usage: bun scripts/ci-containers.ts plan <base-ref> | check <base-ref> | run <app> [BINDING…]");
}
