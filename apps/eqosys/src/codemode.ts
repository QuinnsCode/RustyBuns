// Code mode: `eq_execute` runs a JavaScript program an agent writes, where each read tool is `await tools.eq_apps({...})`, and only what the
// program returns comes back. The runner (the Worker, its limits, the checks before a run) is shared with codeSplitter: @rustybuns/util/codemode.
// Here are eqosys's limits, its EQ binding and the message for a tool that isn't there. Imports types only; tools.ts hands it the way to run a tool.
import { runProgram, type Ran, type ToolAnswer, type WorkerLoaderLike } from "@rustybuns/util/codemode";

export type { Ran, ToolAnswer, WorkerLoaderLike };
export const MAX_CALLS = 50, RUN_MS = 10_000, MAX_BACK = 20_000, MAX_CODE = 32_000;

/** Makes a stub of the worker's EQBridge entrypoint for one caller; worker.tsx sets it on the edge (under Bun there is none). */
export const edge: { stub?: (props: unknown) => unknown } = {};

/** Run `code` in a Worker of its own; `names` are the tools it may call, `run` makes one call as the caller, `bridge` is the edge's stub of it (else an in-process object). */
export const execute = (loader: WorkerLoaderLike, code: string, names: string[], run: (name: string, json: string) => Promise<ToolAnswer>, input?: unknown, bridge?: unknown): Promise<Ran> =>
  runProgram(loader, code, {
    binding: "EQ", names, run, bridge, input, maxCalls: MAX_CALLS, runMs: RUN_MS, maxBack: MAX_BACK, maxCode: MAX_CODE,
    unknownMessage: (u) => `no tool ${u.join(", ")}; the tools are ${names.join(", ")}`,
  });
