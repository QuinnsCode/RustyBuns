/* tslint:disable */
/* eslint-disable */

/**
 * Likely duplicate contacts as `[{a, b, score, why}]`, best first. `score` combines the
 * signals noisy-or style; pairs under 0.5 are dropped.
 */
export function dedupe(contacts_json: string): string;

/**
 * `dedupe` for the pairs whose first row index is in `start..end`, unsorted-merge friendly: the
 * browser runs one slice per core in Web Workers and merges the results by score.
 */
export function dedupe_slice(contacts_json: string, start: number, end: number): string;

/**
 * Weighted pipeline per stage (lead .1, qualified .3, proposal .6) over the open deals, and the
 * expected (weighted) close per month for the six months starting at `now_ms`'s month.
 */
export function forecast(deals_json: string, now_ms: number): string;

/**
 * Open deals with no activity in the last `days` days, oldest touch first (never-touched first).
 */
export function stale(deals_json: string, activities_json: string, now_ms: number, days: number): string;

/**
 * Fill `out` (RGBA, `w`×`h`) with one frame of the wave at time `t` (seconds), in blocks of
 * `pixel` screen pixels. Colours are `0xRRGGBB`. Pure in `t`, and `t` and `t + 12` match.
 */
export function wave_frame(out: Uint8Array, w: number, h: number, t: number, pixel: number, sky: number, navy: number, cream: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly dedupe: (a: number, b: number, c: number) => void;
    readonly dedupe_slice: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly forecast: (a: number, b: number, c: number, d: number) => void;
    readonly stale: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wave_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
