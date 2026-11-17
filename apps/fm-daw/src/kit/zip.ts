// A store-only zip writer: files go in as they are, no compression, so it stays a page of code and needs no
// package. Gerbers and CSVs are small text; a board's whole kit is well under a megabyte.

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** The files, path → text or bytes, as one zip. Paths use `/`; folders come from the paths. */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  // 1980-01-01 00:00: a fixed date, so the same kit makes the same bytes.
  const time = 0, date = (0 << 9) | (1 << 5) | 1;
  let offset = 0, count = 0;
  for (const [path, body] of Object.entries(files)) {
    const name = enc.encode(path), data = typeof body === "string" ? enc.encode(body) : body, crc = crc32(data);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); // version 2.0, names in UTF-8
    l.setUint16(10, time, true); l.setUint16(12, date, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length), c = new DataView(head.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, data); central.push(head);
    offset += local.length + data.length; count++;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

/** A zip's files back, path → bytes: the reader for what `zip` writes (stored entries only). */
export function unzip(b: Uint8Array): Record<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder(), out: Record<string, Uint8Array> = {};
  let at = b.length - 22;
  while (at >= 0 && v.getUint32(at, true) !== 0x06054b50) at--;
  if (at < 0) throw new Error("not a zip");
  const count = v.getUint16(at + 10, true);
  let c = v.getUint32(at + 16, true);
  for (let i = 0; i < count; i++) {
    if (v.getUint32(c, true) !== 0x02014b50 || v.getUint16(c + 10, true) !== 0) throw new Error("not a stored zip entry");
    const size = v.getUint32(c + 20, true), nameLen = v.getUint16(c + 28, true), extra = v.getUint16(c + 30, true), note = v.getUint16(c + 32, true), local = v.getUint32(c + 42, true);
    const name = dec.decode(b.subarray(c + 46, c + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = b.subarray(start, start + size);
    if (crc32(data) !== v.getUint32(c + 16, true)) throw new Error(`${name}: bad checksum`);
    out[name] = data;
    c += 46 + nameLen + extra + note;
  }
  return out;
}
