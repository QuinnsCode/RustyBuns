import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { arr, check, int, nul, obj, rec, str, type Of } from "@rustybuns/util/guard";
import { execCommand, type Exec } from "../src/agent-run.ts";

// Record and replay for model calls (#5333). An agent run reaches its model through one seam, an Exec: a CLI that is
// handed a folder, edits the files in it and prints an answer. A cassette is that, written down: for each turn, the
// files the CLI was given, the files it left, its exit code and its output. Replayed, a test walks the whole agent
// path (the prompt, the sandbox, the ops, the blame) with no CLI installed, no login and no tokens spent, and the
// same every time.
//
//   exec: cassette("use-let")                                   replays test/fixtures/cassettes/use-let.json
//   CASSETTE=record bun test test/cassette.test.ts              runs the real CLI and writes the cassettes again
//
// A cassette is stale when the files a turn is handed are no longer the ones it was recorded on: the replay stops
// there and says to record again, since a real model would have seen something else. A prompt's wording may change
// freely. What is kept of the output is the answer and its token counts; the CLI's own start-up lines (this
// machine's tools, paths and settings) are never written down.

const text = str(2_000_000);
const Turn = obj({ given: rec(text), left: rec(nul(text)), code: int(0, 255), out: text });
const Cassette = obj({ turns: arr(Turn, 100) });
type Turn = Of<typeof Turn>;

const DIR = join(import.meta.dir, "fixtures", "cassettes");

/** Where the cassettes are kept (the test's own, by default), what to run when recording, and whether to record. */
export interface CassetteOptions { dir?: string; real?: Exec; record?: boolean }

/** Every file under `dir` by its path from it, as text. */
function filesIn(dir: string, at = dir): Record<string, string> {
  return Object.fromEntries(readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap((e): [string, string][] => {
    const p = join(at, e.name);
    return e.isDirectory() ? Object.entries(filesIn(dir, p)) : [[relative(dir, p), readFileSync(p, "utf8")]];
  }));
}

const USAGE = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];

/** What a cassette keeps of a CLI's output: a JSON line's answer, session and token counts, and plain lines with this machine's paths taken out. */
export function kept(out: string, cwd: string): string {
  const plain = (s: string) => s.replaceAll(cwd, "<cwd>").replaceAll(homedir(), "~");
  return out.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [plain(line)];
    let r: { type?: unknown; result?: unknown; usage?: Record<string, unknown>; session_id?: unknown; message?: { content?: unknown } };
    try { r = JSON.parse(line); } catch { return [plain(line)]; }
    if (r.type === "result") return [JSON.stringify({ type: "result", result: typeof r.result === "string" ? plain(r.result) : "", session_id: r.session_id, usage: Object.fromEntries(USAGE.flatMap((k) => typeof r.usage?.[k] === "number" ? [[k, r.usage[k]]] : [])) })];
    if (r.type === "assistant" && Array.isArray(r.message?.content)) {
      const said = r.message.content.flatMap((c: unknown) => typeof c === "object" && c !== null && "text" in c && typeof c.text === "string" ? [{ type: "text", text: plain(c.text) }] : []);
      return said.length ? [JSON.stringify({ type: "assistant", message: { content: said } })] : [];
    }
    return [];
  }).join("\n");
}

/**
 * An Exec that replays cassette `name`, turn by turn, or (CASSETTE=record, or `record`) runs `real` and writes the cassette.
 * `turns()` answers how many it has played, for a test to check the run took as many turns as were recorded.
 */
export function cassette(name: string, o: CassetteOptions = {}): Exec & { turns(): number } {
  const dir = o.dir ?? DIR, file = join(dir, `${name}.json`), real = o.real ?? execCommand, recording = o.record ?? process.env.CASSETTE === "record";
  const saved = recording ? null : existsSync(file) ? check(Cassette, JSON.parse(readFileSync(file, "utf8"))) : null;
  const made: Turn[] = [];
  let n = 0;
  const exec: Exec = async (cmd, cwd, signal, ear) => {
    const given = filesIn(cwd);
    if (recording) {
      const run = await real(cmd, cwd, signal, ear), after = filesIn(cwd);
      const left = Object.fromEntries([...new Set([...Object.keys(given), ...Object.keys(after)])].flatMap((p): [string, string | null][] => after[p] === given[p] ? [] : [[p, after[p] ?? null]]));
      made.push({ given, left, code: run.code, out: kept(run.out, cwd) });
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify({ turns: made }, null, 2)}\n`);
      n++;
      return run;
    }
    const again = `Record it again: CASSETTE=record bun test (the CLI installed and signed in).`;
    if (!saved) throw new Error(`cassette ${name}: no recording at ${file}, or it is not a cassette. ${again}`);
    const turn = saved.turns[n++];
    if (!turn) throw new Error(`cassette ${name}: the run asked for turn ${n}, and only ${saved.turns.length} were recorded. ${again}`);
    const moved = [...new Set([...Object.keys(given), ...Object.keys(turn.given)])].filter((p) => given[p] !== turn.given[p]);
    if (moved.length) throw new Error(`cassette ${name} is stale: turn ${n} was recorded on other files (${moved.join(", ")}). ${again}`);
    for (const [p, t] of Object.entries(turn.left)) {
      if (t === null) rmSync(join(cwd, p), { force: true });
      else { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), t); }
    }
    return { code: turn.code, out: turn.out };
  };
  return Object.assign(exec, { turns: () => n });
}
