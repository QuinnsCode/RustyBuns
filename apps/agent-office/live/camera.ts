// The security-camera log (#2201 sends home, the box's outbound asks): one JSON line per event in a file on this
// machine, never sent anywhere. Like a camera it has a disk budget, and when the file reaches it the oldest lines go;
// lines older than the retention the person picked (a day, 3 days, a week, a month) go too.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const KEEP_DAYS = [1, 3, 7, 30] as const;
export type Camera = { maxMb: number; keepDays: (typeof KEEP_DAYS)[number] };
export const DEFAULT_CAMERA: Camera = { maxMb: 10, keepDays: 3 };

export type Entry = { at: number; kind: "outbound" | "home"; who: string; what: string; verdict: "allowed" | "denied" | "timed out" | "listed" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The log's settings from whatever a file or form holds, each field checked; anything missing is the default. */
export function parseCamera(raw: unknown): Camera {
  const r = isObject(raw) ? raw : {};
  const maxMb = r.maxMb ?? DEFAULT_CAMERA.maxMb;
  if (typeof maxMb !== "number" || !(maxMb > 0) || maxMb > 10_000) throw new Error("the log's size should be a number of MB above 0");
  const keep = KEEP_DAYS.find((d) => d === (r.keepDays ?? DEFAULT_CAMERA.keepDays));
  if (!keep) throw new Error(`keep the log for ${KEEP_DAYS.join(", ")} days`);
  return { maxMb, keepDays: keep };
}

/** The box's folder: its permission set (box.json) and the log live there. */
export const boxDir = () => process.env.OFFICE_BOX_DIR ?? path.join(process.cwd(), "sandbox");
export const logFile = (dir: string) => path.join(dir, "outbound.log");

/** The log settings saved in the permission set, or the defaults. */
export function cameraOf(dir: string): Camera {
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, "box.json"), "utf8"));
    return parseCamera(isObject(raw) ? raw.log : undefined);
  } catch {
    return DEFAULT_CAMERA;
  }
}

const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
const atOf = (line: string) => { const m = /^\{"at":(\d+)/.exec(line); return m ? Number(m[1]) : 0; };

/** Drops what is past retention, then the oldest lines until the file fits its budget. */
export function trim(file: string, cam: Camera, now = Date.now()) {
  const oldest = now - cam.keepDays * 86_400_000, cap = cam.maxMb * 2 ** 20;
  const keep = lines(file).filter((l) => atOf(l) >= oldest);
  let bytes = keep.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0), drop = 0;
  while (bytes > cap && drop < keep.length - 1) bytes -= Buffer.byteLength(keep[drop++]!) + 1;
  writeFileSync(file, keep.slice(drop).map((l) => `${l}\n`).join(""));
}

const pruned = new Map<string, number>();

/** Appends one event; the file is trimmed as soon as it passes its budget, and past-retention lines go once an hour. */
export function record(file: string, e: Omit<Entry, "at">, cam: Camera, now = Date.now()) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: now, ...e })}\n`);
  if (statSync(file).size > cam.maxMb * 2 ** 20 || now - (pruned.get(file) ?? 0) > 3_600_000) {
    trim(file, cam, now);
    pruned.set(file, now);
  }
}

/** The last `n` events still within retention, newest first. */
export function recent(file: string, n: number, cam: Camera, now = Date.now()): Entry[] {
  const oldest = now - cam.keepDays * 86_400_000;
  return lines(file).filter((l) => atOf(l) >= oldest).slice(-n).reverse().flatMap((l) => {
    try {
      const e: unknown = JSON.parse(l);
      return isObject(e) && typeof e.at === "number" && typeof e.who === "string" && typeof e.what === "string"
        && (e.kind === "outbound" || e.kind === "home") && (e.verdict === "allowed" || e.verdict === "denied" || e.verdict === "timed out" || e.verdict === "listed")
        ? [{ at: e.at, kind: e.kind, who: e.who, what: e.what, verdict: e.verdict }] : [];
    } catch { return []; }
  });
}
