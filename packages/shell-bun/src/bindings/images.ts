// ImagesBinding-compatible passthrough. Cloudflare Images resizes and converts;
// off the edge there is no image pipeline, so transform() and draw() are
// accepted and ignored and output() hands back the original bytes with their
// real content type. info() reads format and size from the file header.

type Input = ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | Blob;

export type ImageInfo = { format: "image/svg+xml" } | { format: string; fileSize: number; width: number; height: number };

const bytesOf = async (input: Input) => new Uint8Array(await new Response(input as BodyInit).arrayBuffer());

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

function isSvg(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, 1024)).trimStart();
  return /^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/** Format and pixel size from the header, or null when it isn't an image we know. */
function sniff(b: Uint8Array): { format: string; width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG")
    return { format: "image/png", width: v.getUint32(16), height: v.getUint32(20) };
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8")
    return { format: "image/gif", width: v.getUint16(6, true), height: v.getUint16(8, true) };
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { format: "image/webp", width: 1 + (b[24]! | b[25]! << 8 | b[26]! << 16), height: 1 + (b[27]! | b[28]! << 8 | b[29]! << 16) };
    if (chunk === "VP8 ") return { format: "image/webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") return { format: "image/webp", width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the first start-of-frame (C0-CF, minus DHT C4, JPG C8, DAC CC).
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { format: "image/jpeg", width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      i += 2 + v.getUint16(i + 2);
    }
    return null;
  }
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && /avi[fs]/.test(ascii(b, 8, 4))) {
    // The first image spatial extents box (ispe): version/flags, then width and height.
    for (let i = 12; i + 16 <= b.length; i++)
      if (b[i] === 0x69 && ascii(b, i, 4) === "ispe") return { format: "image/avif", width: v.getUint32(i + 8), height: v.getUint32(i + 12) };
    return { format: "image/avif", width: 0, height: 0 };
  }
  return null;
}

function contentType(b: Uint8Array): string {
  return sniff(b)?.format ?? (isSvg(b) ? "image/svg+xml" : "application/octet-stream");
}

export class LocalImageResult {
  constructor(private bytes: Uint8Array<ArrayBuffer>) {}
  response(): Response { return new Response(this.bytes, { headers: { "content-type": this.contentType() } }); }
  contentType(): string { return contentType(this.bytes); }
  image(): ReadableStream<Uint8Array> { return new Response(this.bytes).body!; }
}

export class LocalImageTransformer {
  constructor(private input: Input) {}
  /** No-op: the passthrough doesn't resize, crop or rotate. */
  transform(_t: unknown): this { return this; }
  /** No-op: overlays are dropped. */
  draw(_image: unknown, _opts?: unknown): this { return this; }
  /** The original image, whatever format was asked for. */
  async output(_opts?: unknown): Promise<LocalImageResult> { return new LocalImageResult(await bytesOf(this.input)); }
}

export class LocalImages {
  async info(input: Input, _opts?: unknown): Promise<ImageInfo> {
    const b = await bytesOf(input);
    const s = sniff(b);
    if (s) return { ...s, fileSize: b.length };
    if (isSvg(b)) return { format: "image/svg+xml" };
    throw new Error("IMAGES_INFO_ERROR 9412: Input is not a recognized image");
  }
  input(input: Input, _opts?: unknown): LocalImageTransformer { return new LocalImageTransformer(input); }
}

export function images(): LocalImages {
  return new LocalImages();
}
