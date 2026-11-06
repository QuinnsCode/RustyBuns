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
  rb_render_new: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  rb_render_css: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
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

/** packages/render's Page, as far as the window needs it. */
export interface Page {
  frame(): Promise<readonly Op[]>;
  send(input: Input): void;
  /** The page's own fetch (it carries the session cookie) and where it is, for its stylesheets. */
  window: { fetch(url: string): Promise<Response>; location: { href: string } };
}

export interface NativeWindow {
  /** Applies one frame of ops; throws with rb_render's reason if one is bad. */
  frame(ops: readonly Op[]): void;
  /** Lets the window take its events and repaint, waiting up to `ms`. False once the user has closed it. */
  pump(ms?: number): boolean;
  /** The clicks and typed text since the last poll, oldest first. */
  poll(): Input[];
  /** The CSS for the page's `<link rel="stylesheet">` node `id`. */
  css(id: number, text: string): void;
  /** Paints the document to a PNG at `path`, window or not. */
  snapshot(path: string, width: number, height: number): void;
}

export interface WindowOptions extends LoadOptions {
  /** The page's URL, which a relative `<link href>` resolves against. */
  url?: string;
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
  const { width = 1024, height = 768, title = "Rusty Buns", url = "http://localhost/" } = opts;
  const u = utf8(url);
  if (lib.rb_render_new(width, height, room(u), u.length) !== 1) { console.warn(`[render] ${why()}`); return null; }
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
    css(id, text) {
      const b = utf8(text);
      if (lib.rb_render_css(id, room(b), b.length) !== 1) throw new Error(`rb_render: ${why()}`);
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
 * The `<link rel="stylesheet">` nodes a stream of ops builds, so Bun can fetch
 * each one with the page's session. `changed()` names those whose href is new.
 */
export function linkTracker() {
  const links = new Map<number, { rel: string; href: string; sent: string }>();
  return {
    see(ops: readonly Op[]) {
      for (const [kind, id, name, value] of ops) {
        if (typeof id !== "number") continue;
        if (kind === "el" && typeof name === "string" && name.toLowerCase() === "link") links.set(id, { rel: "", href: "", sent: "" });
        const link = links.get(id);
        if (kind !== "attr" || !link) continue;
        if (name === "rel") link.rel = typeof value === "string" ? value : "";
        if (name === "href") link.href = typeof value === "string" ? value : "";
      }
    },
    changed(): { id: number; href: string }[] {
      const out: { id: number; href: string }[] = [];
      for (const [id, l] of links) {
        if (!l.href || l.href === l.sent || !l.rel.split(/\s+/).includes("stylesheet")) continue;
        l.sent = l.href;
        out.push({ id, href: l.href });
      }
      return out;
    },
  };
}

/**
 * Runs the page in the window until the user closes it: each tick paints what
 * changed, hands over any stylesheet the page linked, then gives the window's
 * input back to the page as DOM events.
 */
export async function drive(page: Page, win: NativeWindow): Promise<void> {
  const links = linkTracker();
  const paint = async () => {
    const ops = await page.frame();
    win.frame(ops);
    links.see(ops);
    for (const { id, href } of links.changed()) {
      const res = await page.window.fetch(new URL(href, page.window.location.href).href);
      if (res.ok) win.css(id, await res.text());
      else console.warn(`[render] ${href}: ${res.status}`);
    }
  };
  await paint();
  while (win.pump(8)) {
    for (const input of win.poll()) page.send(input);
    await paint();
  }
}
