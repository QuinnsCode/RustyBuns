// The security-camera log (#2201 sends home, the box's outbound asks): one JSON line per event in a file on this
// machine, never sent anywhere. Like a camera it has a disk budget, and when the file reaches it the oldest lines go;
// lines older than the retention the person picked (a day, 3 days, a week, a month) go too.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { check, maybe, num, obj, oneOf, or, raw, said, str, type Of } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";

export const KEEP_DAYS = [1, 3, 7, 30] as const;
/** The log's settings, from a file or the form: anything missing is the default, anything wrong is refused. */
export const Camera = obj({
  maxMb: or(said(num(Number.MIN_VALUE, 10_000), "the log's size should be a number of MB above 0"), 10),
  keepDays: or(said(oneOf(KEEP_DAYS), `keep the log for ${KEEP_DAYS.join(", ")} days`), 3),
});
export type Camera = Of<typeof Camera>;
export const DEFAULT_CAMERA: Camera = { maxMb: 10, keepDays: 3 };
/** Just the log settings out of a whole permission set. */
const BoxLog = maybe(obj({ log: raw }));

/** One line of the log. */
export const Entry = obj({
  at: num(0, Number.MAX_SAFE_INTEGER), kind: oneOf(["outbound", "home"]), who: str(10_000, { min: 0 }), what: str(10_000, { min: 0 }),
  verdict: oneOf(["allowed", "denied", "timed out", "listed"]),
});
export type Entry = Of<typeof Entry>;


/** The log's settings from whatever a file or form holds (nothing at all is the defaults). */
export const parseCamera = (v: unknown): Camera => Camera(v ?? {});

/** The box's folder: its permission set (box.json) and the log live there. */
export const boxDir = () => process.env.OFFICE_BOX_DIR ?? path.join(process.cwd(), "sandbox");
export const logFile = (dir: string) => path.join(dir, "outbound.log");

/** The log settings saved in the permission set, or the defaults. */
export function cameraOf(dir: string): Camera {
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, "box.json"), "utf8"));
    return parseCamera(BoxLog(raw)?.log);
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
    const e = check(Entry, parseJson(l));
    return e ? [e] : [];
  });
}
