// CI's `containers` job (#1689, #818 part 2): build and smoke-test the container images a PR touched.
//
//   bun scripts/ci-containers.ts plan <base-ref>      the bindings to check, per app, as `key=json` lines for $GITHUB_OUTPUT
//   bun scripts/ci-containers.ts check <base-ref>     plan, then run every touched app: what the workflow calls
//   bun scripts/ci-containers.ts run <app> [BINDING…] build and boot them, a table in $GITHUB_STEP_SUMMARY, exit 1 if one fails
//
// An app's bindings come from its rustybuns.config.ts (the Dockerfile and its context folder). A binding is
// touched when the diff is inside its context, or in the CLI's generator (packages/cli/src/gen/).
import { appendFileSync, existsSync, readdirSync } from "node:fs";
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

export interface Row { name: string; dockerfile: string; ok: boolean; build?: string; size?: string; boot?: string; fail?: string }

/** The job summary: one row per image, and for each failure its Dockerfile line and the build's last lines. */
export function summary(rows: Row[]): string {
  if (!rows.length) return "No container images were touched by this PR.\n";
  const table = ["| Image | Build | Size | Boot |", "|---|---|---|---|",
    ...rows.map((r) => `| \`${r.name}\` (${r.dockerfile}) | ${r.ok ? "✅" : "❌"} ${r.build ?? ""} | ${r.size ?? ""} | ${r.boot ?? ""} |`)];
  const fails = rows.filter((r) => !r.ok).map((r) => `\n**${r.name}** failed${failedLine(r.fail ?? "") ? ` at ${failedLine(r.fail!)}` : ""}:\n\`\`\`\n${r.fail}\n\`\`\``);
  return table.join("\n") + "\n" + fails.join("\n") + "\n";
}

/** The apps with bindings, and the ones the diff touched. */
async function plan(base: string) {
  const changed = (await Bun.$`git diff --name-only ${base}...HEAD`.text()).split("\n").filter(Boolean);
  const include: { app: string; bindings: string }[] = [];
  for (const app of readdirSync("apps").filter((d) => existsSync(`apps/${d}/rustybuns.config.ts`))) {
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
        const r = await buildOne(a1, b);
        Object.assign(row, { build: `${(r.ms / 1000).toFixed(0)}s`, size: mb(r.size) });
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
