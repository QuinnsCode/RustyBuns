// An event as a calendar file (RFC 5545). The UID stays and SEQUENCE follows the event's `edited`, so adding it again after the
// host moves the date moves the entry a calendar already has.
import type { Event } from "@rustybuns/util/events";

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
const text = (s: string) => s.replace(/[\\;,]/g, "\\$&").replace(/\r\n?|\n/g, "\\n");
/** Lines past 75 bytes carry on after a space, never splitting a character. */
function fold(line: string) {
  const bytes = new TextEncoder();
  let out = "", size = 0;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    if (size + n > 75) { out += "\r\n "; size = 1; }
    out += ch;
    size += n;
  }
  return out;
}

/** The file for `e`, whose public page is `url`; null while it has no date. */
export function icsOf(e: Event, url: string): string | null {
  const start = e.when.start ?? e.when.doors;
  if (start === undefined) return null;
  const end = e.when.curfew !== undefined && e.when.curfew > start ? e.when.curfew : start + 3 * 3_600_000;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QNTBR//eqosys events//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${e.id}@eqosys`, `SEQUENCE:${Math.floor(e.edited / 1000)}`, `DTSTAMP:${stamp(e.edited)}`, `LAST-MODIFIED:${stamp(e.edited)}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${text(e.name)}`, `DESCRIPTION:${text([e.line, url].filter(Boolean).join("\n"))}`,
    ...(e.where.address ? [`LOCATION:${text(e.where.address)}`] : []), ...(e.where.pin ? [`GEO:${e.where.pin.lat};${e.where.pin.lng}`] : []),
    `URL:${url}`, "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}
