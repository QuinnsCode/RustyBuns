import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stand-in for claude on stream-json stdin (a listening run, #3711): it takes the task, works till a second
 * message comes (or `ms`), says what it heard as its result, and exits only when its stdin closes, as claude does.
 * Answers the command that runs it.
 */
export function fakeClaude(ms = 2000): { bin: string; args: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  writeFileSync(join(dir, "fake.mjs"), `const said = []; let second; const got = new Promise((r) => { second = r; });
const reading = (async () => { for await (const line of console) { if (!line.trim()) continue; said.push(JSON.parse(line).message.content); if (said.length === 2) second(); } })();
await Promise.race([got, Bun.sleep(${ms})]);
console.log(JSON.stringify({ type: "result", result: "task: " + said[0] + "; heard: " + said.slice(1).join(" | "), usage: { input_tokens: 1, output_tokens: 1 } }));
await reading;`);
  return { bin: process.execPath, args: [join(dir, "fake.mjs")] };
}
