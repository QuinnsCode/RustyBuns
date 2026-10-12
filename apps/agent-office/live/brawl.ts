// Excalibrawl on the whiteboard (apps/excalibrawl): each floor's board plays the fights.
//
// - Most of the hour, a slideshow of past fights from the site's replays, drawn beside whatever is on the
//   board, turn by turn. Only while someone is on the floor.
// - At :55 the board's own drawing steps aside (each element marked deleted at a newer version, the way
//   Excalidraw itself deletes) and the arena takes its place. At :00 the live fight plays there, from the
//   site's socket.
// - At :05, or a minute after a late fight ends, the drawing comes back and the slideshow resumes. What was
//   hidden is saved beside the board, so an office restart mid-fight still brings it back, and anything
//   somebody changed in the meantime is left as they left it.
//
// Watching costs nothing: the site runs the fight once and everyone reads the same replays. The board reuses
// the same element ids from fight to fight, so it doesn't pile up deleted ones. AGENT_OFFICE_BRAWL=0 turns it
// off; AGENT_OFFICE_BRAWL_URL points it at another deploy; AGENT_OFFICE_BRAWL_SKEW (minutes) moves its clock,
// to try the hour's turns without waiting for them. A site that doesn't serve the replays API is left
// alone: the board is never cleared for a fight that won't come.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LogEntry, MatchState } from "../../excalibrawl/src/engine/match.ts";
import { isLinear, type Op, type SkeletonEl } from "../../excalibrawl/src/engine/types.ts";

/** An element on the office whiteboard: Excalidraw's, as loose as the server keeps it. */
export interface WbEl {
  id: string;
  type: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [k: string]: unknown;
}

export interface Board {
  scene(): WbEl[];
  /** Merge these in (newer versions win) and tell everyone on the floor. */
  put(els: WbEl[]): void;
  /** Someone has the office open on this floor. */
  watching(): boolean;
  /** Where the hidden list lives: beside the board's own files. */
  dir: string;
}

export const PREFIX = "xb-";
const ARENA = 700;
const SLIDE_TURN_MS = 1_500;
const SLIDE_HOLD_MS = 20_000;
const nonce = () => Math.floor(Math.random() * 2 ** 31);
const ours = (id: string) => id.startsWith(PREFIX);

// --- the clock ---------------------------------------------------------------

export type Phase = "slides" | "leadup" | "fight";

/**
 * Where the hour is. The fight's cron runs on the hour (UTC minutes, so half-hour time zones agree) and can
 * be a few minutes late: :55–:59 is the lead-up, :00 until :05 (or a minute after a late fight ends) is the
 * fight, a fight that never started is given up at :08, and one that never said it ended at :20.
 */
export function phaseAt(now: number, fight: { started: boolean; endedAt?: number }): Phase {
  const m = new Date(now).getUTCMinutes();
  if (m >= 55) return "leadup";
  if (fight.endedAt !== undefined) return now - fight.endedAt < 60_000 || m < 5 ? "fight" : "slides";
  if (fight.started) return m < 20 ? "fight" : "slides";
  return m < 8 ? "fight" : "slides";
}

// --- skeleton -> Excalidraw ---------------------------------------------------

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The `n`th place in the stack, as an Excalidraw fractional index: "c" and three base-62 digits. Those sort
 * above anything people drew (their indices start "a" or "b"), and in the order the shapes were drawn, which
 * is how a fighter builds back to front. Without one the board stacks by id, and the frame covers the fight.
 */
export function stackIndex(n: number): string {
  const d = Math.max(0, Math.min(n, 62 ** 3 - 1));
  return `c${B62[Math.floor(d / 3844)]}${B62[Math.floor(d / 62) % 62]}${B62[d % 62]}`;
}

/** An Excalidraw element for a fighter's shape, shifted to `at`, locked so nobody drags it by accident. */
export function toWb(el: SkeletonEl, at: { x: number; y: number }, version: number, index?: string): WbEl {
  const base = {
    id: `${PREFIX}${el.id}`,
    ...(index ? { index } : {}),
    x: el.x + at.x,
    y: el.y + at.y,
    angle: 0,
    strokeColor: el.strokeColor ?? "#1e1e1e",
    backgroundColor: el.backgroundColor ?? "transparent",
    fillStyle: el.fillStyle ?? "solid",
    strokeWidth: el.strokeWidth ?? 2,
    strokeStyle: "solid",
    roughness: el.roughness ?? 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1 + (hash(el.id) % 2 ** 30),
    version,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: true,
  };
  if (isLinear(el)) {
    const xs = el.points.map((p) => p[0]), ys = el.points.map((p) => p[1]);
    return {
      ...base, type: el.type, points: el.points,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: el.type === "arrow" ? "arrow" : null,
    };
  }
  if (el.type === "text") return { ...text(base.id, el.text, base.x, base.y, el.fontSize ?? 20, version), ...(index ? { index } : {}) };
  return { ...base, type: el.type, width: el.width, height: el.height, roundness: el.type === "rectangle" ? { type: 3 } : null };
}

function text(id: string, s: string, x: number, y: number, fontSize: number, version: number): WbEl {
  return {
    id, type: "text", x, y, width: s.length * fontSize * 0.55, height: fontSize * 1.25, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1 + (hash(id) % 2 ** 30),
    version, versionNonce: nonce(), isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: true,
    text: s, originalText: s, fontSize, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null,
    autoResize: true, lineHeight: 1.25,
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The box around the arena, the line between the halves and the title: the same ids every fight. */
function chrome(at: { x: number; y: number }, title: string, halves: boolean): SkeletonEl[] {
  const els: SkeletonEl[] = [
    { id: "frame", type: "rectangle", x: 0, y: 0, width: ARENA, height: ARENA, strokeColor: "#868e96", backgroundColor: "#ffffff", fillStyle: "solid" },
    { id: "title", type: "text", x: 0, y: -44, text: title.slice(0, 120), fontSize: 24 },
  ];
  if (halves) els.push({ id: "divider", type: "line", x: ARENA / 2, y: 0, points: [[0, 0], [0, ARENA]], strokeColor: "#ced4da" });
  return els.map((e) => ({ ...e, id: `arena-${e.id}` }));
}

// --- the board's side of it -----------------------------------------------------

/**
 * Draws on one floor's board. Keeps a skeleton of what it has drawn so each change is one new version of
 * one element, and so clearing knows what to delete.
 */
export class Stage {
  private drawn = new Map<string, SkeletonEl>();
  /** Each shape's place in the stack, given when it first appears. */
  private stack = new Map<string, string>();
  at = { x: 0, y: 0 };
  constructor(private board: Board) {}

  private versionOf(id: string) {
    return this.board.scene().find((e) => e.id === id)?.version ?? 0;
  }

  /** Make the board show exactly `els` (and nothing else of ours). */
  show(els: SkeletonEl[]) {
    const out: WbEl[] = [];
    const next = new Map(els.map((e) => [e.id, e]));
    for (const [id, el] of next) {
      const had = this.drawn.get(id);
      if (had && JSON.stringify(had) === JSON.stringify(el)) continue;
      if (!this.stack.has(id)) this.stack.set(id, stackIndex(this.stack.size));
      out.push(toWb(el, this.at, this.versionOf(`${PREFIX}${id}`) + 1, this.stack.get(id)));
    }
    for (const id of this.drawn.keys()) {
      if (next.has(id)) continue;
      const cur = this.board.scene().find((e) => e.id === `${PREFIX}${id}`);
      if (cur && !cur.isDeleted) out.push({ ...cur, isDeleted: true, version: cur.version + 1, versionNonce: nonce(), updated: Date.now() });
    }
    this.drawn = next;
    if (out.length) this.board.put(out);
  }

  /** Delete everything of ours, including anything left over from before a restart. */
  clear() {
    this.drawn.clear();
    this.stack.clear();
    const gone = this.board.scene().filter((e) => ours(e.id) && !e.isDeleted).map((e) => ({ ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce(), updated: Date.now() }));
    if (gone.length) this.board.put(gone);
  }

  /** The bounding box of what people drew (ours left out), or undefined on an empty board. */
  theirs() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of this.board.scene()) {
      if (e.isDeleted || ours(e.id) || typeof e.x !== "number" || typeof e.y !== "number") continue;
      x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
      x1 = Math.max(x1, e.x + (e.width ?? 0)); y1 = Math.max(y1, e.y + (e.height ?? 0));
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : undefined;
  }
}

/** Moves people's drawing out of the way and back, remembering what it hid on disk. */
export class Curtain {
  private file: string;
  constructor(private board: Board) {
    this.file = path.join(board.dir, "excalibrawl-hidden.json");
  }

  hidden(): { id: string; version: number }[] {
    try {
      return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : [];
    } catch {
      return [];
    }
  }

  get down() {
    return existsSync(this.file);
  }

  /** Hide everything people drew. */
  close() {
    if (this.down) return;
    const els = this.board.scene().filter((e) => !e.isDeleted && !ours(e.id));
    const hid = els.map((e) => ({ ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce(), updated: Date.now() }));
    mkdirSync(this.board.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(hid.map((e) => ({ id: e.id, version: e.version }))), { mode: 0o600 });
    renameSync(tmp, this.file);
    if (hid.length) this.board.put(hid);
  }

  /**
   * Bring back what it hid. Anything still deleted comes back, even at a newer version: a browser with the
   * board open re-numbers the stack and so bumps hidden elements too. Something already back (someone undid
   * the hiding) is left as it is.
   */
  open() {
    const scene = new Map(this.board.scene().map((e) => [e.id, e]));
    const back: WbEl[] = [];
    for (const { id, version } of this.hidden()) {
      const cur = scene.get(id);
      if (cur?.isDeleted && cur.version >= version) back.push({ ...cur, isDeleted: false, version: cur.version + 1, versionNonce: nonce(), updated: Date.now() });
    }
    if (back.length) this.board.put(back);
    try {
      unlinkSync(this.file);
    } catch {
      /* already open */
    }
  }
}

// --- the site's side of it ----------------------------------------------------

type Summary = { id: string; prompt: string; fighters: { name: string }[]; shapes: number[] };
type LiveMsg =
  | { t: "hello" | "start"; match: (Omit<MatchState, "log" | "nextId">) | null }
  | { t: "turn"; id: string; turn: number; entries: LogEntry[] }
  | { t: "end"; id: string };

/** The site: its replays, cached, and its live socket, shared by every floor. */
export class Feed {
  private index?: { at: number; list: Summary[] };
  private matches = new Map<string, MatchState>();
  private ws?: WebSocket;
  private listeners = new Set<(m: LiveMsg) => void>();
  /** The site answered with replays the last time it was asked. */
  healthy = false;

  constructor(private url: string, private fetcher: typeof fetch = fetch) {}

  async list(): Promise<Summary[]> {
    if (this.index && Date.now() - this.index.at < 5 * 60_000) return this.index.list;
    try {
      const res = await this.fetcher(`${this.url}/api/matches`);
      const list = res.ok ? ((await res.json()) as unknown) : null;
      this.healthy = Array.isArray(list);
      this.index = { at: Date.now(), list: this.healthy ? (list as Summary[]).filter((s) => s.shapes?.some((n) => n > 0)) : [] };
    } catch {
      this.healthy = false;
      this.index = { at: Date.now(), list: [] };
    }
    return this.index.list;
  }

  async match(id: string): Promise<MatchState | undefined> {
    if (this.matches.has(id)) return this.matches.get(id);
    try {
      const res = await this.fetcher(`${this.url}/api/matches/${encodeURIComponent(id)}`);
      if (!res.ok) return undefined;
      const m = (await res.json()) as MatchState;
      if (this.matches.size > 20) this.matches.delete(this.matches.keys().next().value!);
      this.matches.set(id, m);
      return m;
    } catch {
      return undefined;
    }
  }

  /** Listen to the live fight; the socket is open only while someone listens. */
  listen(fn: (m: LiveMsg) => void): () => void {
    this.listeners.add(fn);
    this.connect();
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        this.ws?.close();
        this.ws = undefined;
      }
    };
  }

  private connect() {
    if (this.ws || !this.listeners.size) return;
    const ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/api/live`);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: LiveMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      setTimeout(() => this.connect(), 5_000);
    };
    ws.onerror = () => ws.close();
  }
}

// --- one floor ------------------------------------------------------------------

/** Rebuild the canvases from a log, up to `turn`. */
export function scenesAt(fighters: number, log: LogEntry[], turn: number): SkeletonEl[][] {
  const scenes = Array.from({ length: fighters }, () => new Map<string, SkeletonEl>());
  for (const e of log) {
    if (e.turn > turn) break;
    applyOps(scenes[e.side]!, e.ops);
  }
  return scenes.map((s) => [...s.values()]);
}

function applyOps(s: Map<string, SkeletonEl>, ops: Op[]) {
  for (const op of ops) {
    if (op.op === "add") s.set(op.element.id, op.element);
    else if (op.op === "delete") s.delete(op.id);
    else {
      const cur = s.get(op.id);
      if (cur) s.set(op.id, { ...cur, ...op.patch } as SkeletonEl);
    }
  }
}

const titleOf = (m: { prompt: string; fighters: { name: string }[] }, what: string) =>
  `⚔ EXCALIBRAWL ${what}: "${m.prompt}", ${m.fighters.map((f) => f.name).join(" vs ")}`;

export class FloorBrawl {
  private stage: Stage;
  private curtain: Curtain;
  private timer?: ReturnType<typeof setInterval>;
  private phase: Phase | "off" = "off";
  private fight: { started: boolean; endedAt?: number; id?: string; m?: { prompt: string; fighters: { name: string }[]; turns: number; turn: number }; log: LogEntry[] } = { started: false, log: [] };
  private unlisten?: () => void;
  private slide?: { m: MatchState; turn: number; next: number; i: number };
  private busy = false;

  constructor(private board: Board, private feed: Feed, private now: () => number = Date.now) {
    this.stage = new Stage(board);
    this.curtain = new Curtain(board);
  }

  start(everyMs = 1_000) {
    // A restart mid-fight: bring the drawing back first; tick puts it away again if it's still fight time.
    if (this.curtain.down) this.curtain.open();
    this.stage.clear();
    this.timer = setInterval(() => void this.tick(), everyMs);
    return this;
  }

  stop() {
    clearInterval(this.timer);
    this.unlisten?.();
    this.stage.clear();
    if (this.curtain.down) this.curtain.open();
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } finally {
      this.busy = false;
    }
  }

  private async step() {
    await this.feed.list();
    if (!this.feed.healthy) return this.enter("off");
    const phase = phaseAt(this.now(), this.fight);
    if (phase !== this.phase) this.enter(phase);
    if (phase === "slides") await this.slides();
  }

  private enter(phase: Phase | "off") {
    const was = this.phase;
    this.phase = phase;
    if (phase === "off" || phase === "slides") {
      // The fight stays as it ended (or never started) until the next lead-up: resetting it here would read
      // as "no fight yet" before :08 and pull the board straight back.
      this.unlisten?.();
      this.unlisten = undefined;
      this.stage.clear();
      if (this.curtain.down) this.curtain.open();
      this.slide = undefined;
      return;
    }
    // lead-up and fight: the drawing steps aside and the arena takes its spot
    if (was !== "leadup" && was !== "fight") {
      const theirs = this.stage.theirs();
      this.stage.at = theirs ? { x: theirs.x0, y: theirs.y0 + 60 } : { x: 0, y: 60 };
      this.stage.clear();
      this.curtain.close();
      this.slide = undefined;
    }
    if (phase === "leadup") {
      this.fight = { started: false, log: [] };
      this.stage.show(chrome(this.stage.at, "⚔ EXCALIBRAWL: the next fight starts on the hour", false));
    }
    this.unlisten ??= this.feed.listen((msg) => this.heard(msg));
  }

  private heard(msg: LiveMsg) {
    if (this.phase !== "fight" && this.phase !== "leadup") return;
    if (msg.t === "hello" || msg.t === "start") {
      if (!msg.match) return;
      const m = msg.match;
      this.fight = { started: true, id: m.id, m, log: m.scenes.flatMap((s, side) => s.map((element) => ({ side, turn: 0, ops: [{ op: "add" as const, element }] }))) };
    } else if (msg.t === "turn" && msg.id === this.fight.id && this.fight.m) {
      this.fight.log.push(...msg.entries);
      this.fight.m.turn = msg.turn;
    } else if (msg.t === "end" && msg.id === this.fight.id) {
      this.fight.endedAt = this.now();
    } else return;
    const m = this.fight.m!;
    const what = this.fight.endedAt ? "final" : `live, turn ${m.turn}/${m.turns}`;
    this.stage.show([...chrome(this.stage.at, titleOf(m, what), true), ...scenesAt(m.fighters.length, this.fight.log, m.turn).flat()]);
  }

  private async slides() {
    if (!this.board.watching()) return;
    const t = this.now();
    if (this.slide && t < this.slide.next) return;
    if (!this.slide || this.slide.turn >= this.slide.m.turns) {
      // the next fight in the list, beside what people drew
      const list = await this.feed.list();
      if (!list.length) return;
      const i = this.slide ? (this.slide.i + 1) % Math.min(list.length, 24) : 0;
      const m = await this.feed.match(list[i]!.id);
      if (!m) return;
      const theirs = this.stage.theirs();
      this.stage.at = theirs ? { x: theirs.x1 + 200, y: theirs.y0 + 60 } : { x: 0, y: 60 };
      this.stage.clear();
      this.slide = { m, turn: 0, next: t, i };
    }
    const s = this.slide;
    s.turn++;
    s.next = t + (s.turn >= s.m.turns ? SLIDE_HOLD_MS : SLIDE_TURN_MS);
    const what = s.turn >= s.m.turns ? "replay, final" : `replay, turn ${s.turn}/${s.m.turns}`;
    this.stage.show([...chrome(this.stage.at, titleOf(s.m, what), s.m.fighters.length === 2), ...scenesAt(s.m.fighters.length, s.m.log, s.turn).flat()]);
  }
}

// --- the office's hook ------------------------------------------------------------

let shared: Feed | undefined;

/** The floor's piece of the office (patched into floor.js by scripts/rustybunsify.ts). */
interface OfficeFloor {
  whiteboard: { scene(): WbEl[]; apply(raw: unknown): { accepted: WbEl[] }; dir: string };
}

export function excalibrawl(floor: OfficeFloor, emit: (msg: unknown) => void, watching: () => boolean) {
  if (process.env.AGENT_OFFICE_BRAWL === "0") return undefined;
  shared ??= new Feed((process.env.AGENT_OFFICE_BRAWL_URL ?? "https://excalibrawl.com").replace(/\/+$/, ""));
  const board: Board = {
    scene: () => floor.whiteboard.scene(),
    put: (els) => {
      const { accepted } = floor.whiteboard.apply(els);
      if (accepted.length) emit({ t: "wb.update", elements: accepted });
    },
    watching,
    dir: floor.whiteboard.dir,
  };
  const skew = (Number(process.env.AGENT_OFFICE_BRAWL_SKEW) || 0) * 60_000;
  return new FloorBrawl(board, shared, () => Date.now() + skew).start();
}
