import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stand-in for claude on stream-json stdin (a listening run, #3711): it takes the task, works till a second
 * message comes (or `ms`), says what it heard as its result, and exits only when its stdin closes, as claude does.
 * With CLAUDE_CONFIG_DIR set it keeps a session there as claude does (projects/<its directory>/<id>.jsonl, the id in
 * its init and result lines), and with `--resume <id>` it reads that one back and says what it was told before (#3715).
 * Answers the command that runs it.
 */
export function fakeClaude(ms = 2000): { bin: string; args: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  writeFileSync(join(dir, "fake.mjs"), `import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
const conf = process.env.CLAUDE_CONFIG_DIR, at = process.argv.indexOf("--resume"), resumed = at > 0 ? process.argv[at + 1] : null;
const id = resumed ?? crypto.randomUUID(), folder = conf && conf + "/projects/" + process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
const before = resumed && folder ? readFileSync(folder + "/" + id + ".jsonl", "utf8").split("\\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const keep = (o) => { if (folder) { mkdirSync(folder, { recursive: true }); appendFileSync(folder + "/" + id + ".jsonl", JSON.stringify({ ...o, cwd: process.cwd() }) + "\\n"); } };
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: id }));
const said = []; let second; const got = new Promise((r) => { second = r; });
const reading = (async () => { for await (const line of console) { if (!line.trim()) continue; const t = JSON.parse(line).message.content; said.push(t); keep({ type: "user", text: t }); if (said.length === 2) second(); } })();
await Promise.race([got, Bun.sleep(${ms})]);
const told = before.filter((l) => l.type === "user" && l.cwd === process.cwd()).map((l) => /Task: (.*)/.exec(l.text)?.[1] ?? l.text);
console.log(JSON.stringify({ type: "result", session_id: id, result: "task: " + said[0] + "; heard: " + said.slice(1).join(" | ") + (resumed ? "; remembered: " + told.join(" | ") : ""), usage: { input_tokens: 1, output_tokens: 1 } }));
await reading;`);
  return { bin: process.execPath, args: [join(dir, "fake.mjs")] };
}
