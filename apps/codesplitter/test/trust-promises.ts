// The security model in REFERENCE.md ("The security model: your code, your app, your provisioning,
// your destruction") is a list of promises, each citing the test that proves it as
//   `test/<file>`: "the test's name"
// This reads them out, for trust.test.ts (every citation names a real test) and scripts/smoke.ts
// (run them all and print a row per promise).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const APP = join(import.meta.dir, "..");
export const HEADING = "### The security model: your code, your app, your provisioning, your destruction";

export interface Cite { file: string; name: string }
export interface Promise_ { part: string; text: string; cites: Cite[] }

const CITE = /`(test\/[\w.-]+\.test\.ts)`: "([^"]+)"/g;

/** The section's text, from its heading to the next one. */
export function section(reference = readFileSync(join(APP, "REFERENCE.md"), "utf8")): string {
  const at = reference.indexOf(`\n${HEADING}\n`);
  if (at < 0) throw new Error(`REFERENCE.md has no "${HEADING}"`);
  const rest = reference.slice(at + 1 + HEADING.length + 1);
  const end = rest.search(/\n##+ /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Every promise with its citations: a bullet (its first line is the promise) or a table row (its first cell). */
export function promises(text = section()): Promise_[] {
  const out: Promise_[] = [];
  let part = "", bullet = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const partHead = line.match(/^\*\*(Your \w+)\.\*\*/);
    if (partHead) { part = partHead[1]; bullet = ""; continue; }
    if (line.startsWith("- ")) bullet = line.slice(2);
    const cites = [...line.matchAll(CITE)].map(([, file, name]) => ({ file, name }));
    if (!cites.length) continue;
    if (line.startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim());
      out.push({ part, text: cells[1].replace(/`/g, ""), cites });
    } else out.push({ part, text: bullet, cites });
  }
  return out;
}

/** The test files the promises cite, each once, in order. */
export const citedFiles = (list = promises()) => [...new Set(list.flatMap((p) => p.cites.map((c) => c.file)))];

/** Does `test/<file>` hold a test by that exact name? null when the file is missing. */
export function hasTest(cite: Cite): boolean | null {
  const path = join(APP, cite.file);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").includes(`test(${JSON.stringify(cite.name)}`);
}

/** The API's DELETE routes (src/api.ts), without their query strings, as the destruction table must name them. */
export function deleteRoutes(api = readFileSync(join(APP, "src/api.ts"), "utf8")): string[] {
  return [...api.matchAll(/method: "DELETE", path: "([^"?]+)/g)].map(([, p]) => `DELETE ${p}`);
}
