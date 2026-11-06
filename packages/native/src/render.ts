// A native window for a react-dom app's op stream: rb_render (native/crates/rb_render),
// which applies the ops to a Blitz document and lays out, paints and hit-tests it.
//
// openNativeWindow() is null when the library isn't built or won't open: the caller
// keeps today's Chromium window (openBrowser in @rustybuns/shell-bun). Rust is never a cliff.
//
// The op and input shapes are packages/render's (src/ops.ts); this file only needs
// them to be JSON, so it takes them structurally.

import { FFIType } from "bun:ffi";
import { loadNative, type LoadOptions } from "./index.ts";

export const rbRenderSymbols = {
  rb_render_new: { args: [FFIType.u32, FFIType.u32], returns: FFIType.i32 },
  rb_render_window: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  rb_render_frame: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  rb_render_pump: { args: [FFIType.u32], returns: FFIType.i32 },
  rb_render_poll: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  rb_render_snapshot: { args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
  rb_render_error: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
} as const;

/** One DOM change: `["el", id, tag]`, `["insert", parent, child, before]`, ... */
export type Op = readonly [string, ...unknown[]];
/** What the user did to node `id`, to dispatch as the DOM event a browser would fire. */
export type Input = readonly ["click", id: number] | readonly ["input", id: number, value: string];

/** packages/render's Host, as far as the window needs it. */
export interface Page {
  frame(): Promise<readonly Op[]>;
  send(input: Input): void;
}

export interface NativeWindow {
  /** Applies one frame of ops; throws with rb_render's reason if one is bad. */
  frame(ops: readonly Op[]): void;
  /** Lets the window take its events and repaint, waiting up to `ms`. False once the user has closed it. */
  pump(ms?: number): boolean;
  /** The clicks and typed text since the last poll, oldest first. */
  poll(): Input[];
  /** Paints the document to a PNG at `path`, window or not. */
  snapshot(path: string, width: number, height: number): void;
}

export interface WindowOptions extends LoadOptions {
  title?: string;
  width?: number;
  height?: number;
  /** A document with no window: frames and snapshots only (tests, screenshots). */
  headless?: boolean;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
// bun:ffi won't pass a pointer to an empty buffer; Rust reads only `len` bytes, so a spare one is safe.
const room = (b: Uint8Array) => b.length ? b : new Uint8Array(1);

export async function openNativeWindow(opts: WindowOptions = {}): Promise<NativeWindow | null> {
  const lib = await loadNative("rb_render", rbRenderSymbols, opts);
  if (!lib) return null;
  const why = () => {
    const out = new Uint8Array(1024);
    return new TextDecoder().decode(out.subarray(0, Math.max(0, lib.rb_render_error(out, out.length))));
  };
  const { width = 1024, height = 768, title = "Rusty Buns" } = opts;
  if (lib.rb_render_new(width, height) !== 1) { console.warn(`[render] ${why()}`); return null; }
  if (!opts.headless) {
    const t = utf8(title);
    if (lib.rb_render_window(room(t), t.length) !== 1) { console.warn(`[render] no native window: ${why()}`); return null; }
  }
  const inbox = new Uint8Array(64 * 1024);
  return {
    frame(ops) {
      if (!ops.length) return;
      const json = utf8(JSON.stringify(ops));
      if (lib.rb_render_frame(json, json.length) < 0) throw new Error(`rb_render: ${why()}`);
    },
    pump(ms = 8) {
      const n = lib.rb_render_pump(ms);
      if (n < 0) throw new Error(`rb_render: ${why()}`);
      return n === 1;
    },
    poll() {
      const n = lib.rb_render_poll(inbox, inbox.length);
      if (n < 0) throw new Error(`rb_render: ${why()}`);
      return inputs(JSON.parse(new TextDecoder().decode(inbox.subarray(0, n))));
    },
    snapshot(path, w, h) {
      const p = utf8(path);
      if (lib.rb_render_snapshot(room(p), p.length, w, h) !== 1) throw new Error(`rb_render: ${why()}`);
    },
  };
}

/** The input rb_render reported, keeping only the shapes a page can dispatch. */
export function inputs(raw: unknown): Input[] {
  if (!Array.isArray(raw)) return [];
  const out: Input[] = [];
  const list: unknown[] = raw;
  for (const item of list) {
    if (!Array.isArray(item)) continue;
    const fields: unknown[] = item;
    const [kind, id, value] = fields;
    if (typeof id !== "number") continue;
    if (kind === "click") out.push(["click", id]);
    else if (kind === "input" && typeof value === "string") out.push(["input", id, value]);
  }
  return out;
}

/**
 * Runs the page in the window until the user closes it: each tick paints what
 * changed, then hands the window's input back to the page as DOM events.
 */
export async function drive(page: Page, win: NativeWindow): Promise<void> {
  win.frame(await page.frame());
  while (win.pump(8)) {
    for (const input of win.poll()) page.send(input);
    win.frame(await page.frame());
  }
}
