// The judge half of the model loops (#3823): beasts (scripts/beasts.ts), plants (scripts/flora.ts) and ground
// (scripts/ground.ts) each keep a BEFORE and a NOW set of images, and a fresh judge (a `claude -p` with no memory of the
// work) scores NOW against BEFORE, image by image. Needs the `claude` CLI.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const APP = join(import.meta.dir, "..");
export const OUT = join(APP, "blender", "out");
/** Where a kind's BEFORE or NOW images are kept: blender/out/shots/<kind>/<label>/ (beasts keep theirs a level up). */
export const keptDir = (kind: string, label: string) => join(OUT, "shots", kind, label);

/** Copies `files` (renders a build just wrote) in as the BEFORE or NOW images of `kind`; returns the copies. */
export function keep(kind: string, label: "before" | "now", files: string[]): string[] {
  const dir = keptDir(kind, label);
  mkdirSync(dir, { recursive: true });
  return files.map((f) => { const to = join(dir, basename(f)); copyFileSync(f, to); return to; });
}

/**
 * A fresh judge compares each BEFORE image with the NOW image of the same name. `subject` says what the images show,
 * `rubric` how to score, and `row` the table's columns; the answer (a markdown table and a verdict line) is written to
 * `out` for the PR body and returned.
 */
export async function judgePairs(before: string, now: string, o: { subject: string; rubric: string; row: string; out: string; take: string }): Promise<string> {
  const names = existsSync(before) ? readdirSync(before).filter((f) => f.endsWith(".png")).sort() : [];
  if (!names.length) throw new Error(`no BEFORE images in ${before}: ${o.take}`);
  const pairs = names.filter((f) => existsSync(join(now, f)));
  if (!pairs.length) throw new Error(`no NOW image matches a BEFORE one in ${now}`);
  const prompt = `You are a fresh art judge for a creature-fighting game. Each pair below is ${o.subject}, BEFORE a change and NOW.
${pairs.map((f) => `BEFORE ${f}: ${join(before, f)}\nNOW    ${f}: ${join(now, f)}`).join("\n")}
Read every image. ${o.rubric}
Answer with ONLY a markdown table, one row per changed item: ${o.row}, then one line "Verdict: better | same | worse".`;
  const p = Bun.spawn(["claude", "-p", prompt, "--no-session-persistence", "--allowedTools", "Read", "--add-dir", OUT], { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const text = (await new Response(p.stdout).text()).trim();
  if ((await p.exited) !== 0 || !text) throw new Error(`the judge did not answer:\n${(await new Response(p.stderr).text()).slice(-400)}`);
  writeFileSync(o.out, text + "\n");
  return text;
}
