// The judge half of the model loops (#3823): beasts (scripts/beasts.ts), plants (scripts/flora.ts) and ground
// (scripts/ground.ts) each keep a BEFORE and a NOW set of images, and a fresh judge (a `claude -p` with no memory of the
// work) scores NOW against BEFORE, image by image. judgeTraits is the other mode: one model against its reference
// pictures and trait list (scripts/beast-refs.ts --judge). Needs the `claude` CLI.
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

/** A fresh `claude -p` reads a prompt's images (in `dirs`) and answers one JSON object; answers it parsed, for the caller's guard. */
async function askJson(prompt: string, files: string[]): Promise<unknown> {
  const dirs = [...new Set(files.map((f) => f.slice(0, f.lastIndexOf("/"))))].flatMap((d) => ["--add-dir", d]);
  const p = Bun.spawn(["claude", "-p", prompt, "--no-session-persistence", "--allowedTools", "Read", ...dirs], { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const text = (await new Response(p.stdout).text()).trim();
  if ((await p.exited) !== 0 || !text) throw new Error(`the judge did not answer:\n${(await new Response(p.stderr).text()).slice(-400)}`);
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw new Error(`the judge's answer is not JSON:\n${text.slice(0, 400)}`); }
}

/** A fresh reader drafts a beast's traits from its reference pictures alone (no model shown): a draft for a person to correct. */
export async function draftTraits(o: { name: string; refs: string[] }): Promise<unknown> {
  return askJson(`You are an art director for a creature-fighting game. These are reference pictures of the ${o.name}, best first:
${o.refs.map((f) => `- ${f}`).join("\n")}
Read every image. Write what a 3D model of it must get right, as the pictures show it (where they disagree, go with the most common reading; skip anything that is only scenery, a sign or a toy).
Answer with ONLY a JSON object, no prose and no code fence, each value one short sentence:
{"silhouette": "...", "head": "...", "limbs": "...", "hide": "...", "colours": "...", "child": ["the first thing a child would draw", "the second", "the third"]}`, o.refs);
}

/**
 * The other mode: a fresh judge scores one model against its references, trait by trait, instead of NOW against BEFORE.
 * `refs` are the reference pictures, `model` the close-up strip, `traits` what the references show, by key. The judge
 * answers JSON ({ score, traits: [{ key, verdict, note }], fix }); the parsed value is returned for the caller's guard.
 */
export async function judgeTraits(o: { name: string; refs: string[]; model: string; views: readonly string[]; traits: { key: string; want: string }[] }): Promise<unknown> {
  const prompt = `You are a fresh, strict art judge for a creature-fighting game. The model must look like the ${o.name} in the references.
References (real pictures of it, best first):
${o.refs.map((f) => `- ${f}`).join("\n")}
The model, one strip of close-ups (left to right: ${o.views.join(", ")}): ${o.model}
Read every image. Then judge the model against each trait the references show:
${o.traits.map((t) => `- ${t.key}: ${t.want}`).join("\n")}
For each trait say yes (the model clearly has it), partly, or no, with a note of at most 15 words on what the model shows.
Score the whole model from 1 to 10 for how much it looks like the references (a 10 is mistaken for them; most game models are 2 to 5).
Answer with ONLY a JSON object, no prose and no code fence:
{"score": <1-10>, "traits": [{"key": "<key>", "verdict": "yes|partly|no", "note": "..."}], "fix": "<the one change that would help most, one sentence>"}`;
  return askJson(prompt, [...o.refs, o.model]);
}
