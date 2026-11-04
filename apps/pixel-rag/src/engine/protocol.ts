// What the index says to a search worker and what it hears back. One shape for the page's
// Web Workers and the host's Bun workers.
import type { Layout } from "./layout.ts";

/** wasm: the crate in Web Workers. ts: the twin. native: the crate over bun:ffi (host only). */
export type Engine = "wasm" | "ts" | "native";

export type Job =
  | { type: "init"; id: number; engine: Engine; memory: WebAssembly.Memory; module: WebAssembly.Module | null; stack: number; layout: Layout }
  | { type: "search"; id: number; start: number; end: number; k: number; slot: number };

export type Reply = { id: number; ok: true; count: number; ms: number } | { id: number; ok: false; error: string };

/** A job before the index gives it an id. */
type Without<T> = T extends unknown ? Omit<T, "id"> : never;
export type JobOut = Without<Job>;
