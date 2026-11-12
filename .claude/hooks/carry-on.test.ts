import { expect, test } from "bun:test";
import { decide, REASON } from "./carry-on";

// Transcript lines in the shape Claude Code writes them (seen in session ef9f309b, 2026-11-12).
const prompt = (text: string, kind: string) => ({ type: "user", origin: { kind }, message: { role: "user", content: text } });
const human = (text: string) => prompt(text, "human");
const notice = prompt("<task-notification>\n<status>completed</status>\n<summary>Background command \"Install packages\" completed (exit code 0)</summary>\n</task-notification>", "task-notification");
const toolUse = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } };
const toolResult = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] } };
const reply = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const queuedHuman = { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", origin: { kind: "human" }, prompt: "also do x" } };

const stop = (lines: object[], extra: Record<string, unknown> = {}) =>
  decide({ hook_event_name: "Stop", transcript_path: "/t.jsonl", stop_hook_active: false, last_assistant_message: "No response requested.", background_tasks: [], session_crons: [], ...extra },
    () => lines.map((l) => JSON.stringify(l)).join("\n"));

const owed = [human("build the factions"), toolUse, toolResult, reply("installing")];

test("a turn a notice started can't end the work once, and the second try may", () => {
  expect(stop([...owed, notice, reply("No response requested.")])).toBe(REASON);
  expect(stop([...owed, notice, toolUse, toolResult, reply("No response requested.")])).toBe(REASON);
  expect(stop([...owed, notice, reply("No response requested.")], { stop_hook_active: true })).toBeNull();
});

test("a person's turn ends when it ends", () => {
  expect(stop(owed)).toBeNull();
  expect(stop([...owed, notice, reply("ok"), human("stop for now"), reply("Stopped.")])).toBeNull();
  expect(stop([...owed, notice, toolUse, queuedHuman, toolResult, reply("done")])).toBeNull();
});

test("a notice turn may end while work is in flight or once it reports what is done", () => {
  const lines = [...owed, notice, reply("Waiting on the build.")];
  expect(stop(lines, { background_tasks: [{ id: "b1", type: "shell", status: "running" }] })).toBeNull();
  expect(stop(lines, { session_crons: [{ id: "c1", schedule: "*/20 * * * *", recurring: true, prompt: "check CI" }] })).toBeNull();
  expect(stop(lines, { last_assistant_message: "3 of 3 done: #4301 merged." })).toBeNull();
});

test("a missing or unreadable transcript never traps the session", () => {
  expect(decide({ stop_hook_active: false })).toBeNull();
  expect(decide({ transcript_path: "/nope.jsonl", stop_hook_active: false }, () => { throw new Error("ENOENT"); })).toBeNull();
  expect(decide(null)).toBeNull();
});
