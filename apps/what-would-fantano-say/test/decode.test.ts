import { expect, test } from "bun:test";
import { RATE } from "../src/clip.ts";
import { type Decoders, decode, f32le, ffmpegArgs, inputName } from "../src/decode.ts";

const file = (name = "song.wma") => ({ name, arrayBuffer: async () => new ArrayBuffer(8) });
const tone = new Float32Array([0.1, -0.2, 0.3]);

function decoders(nativeWorks: boolean) {
  const calls = { convert: 0 };
  const d: Decoders = {
    native: async () => { if (!nativeWorks) throw new DOMException("Unable to decode audio data", "EncodingError"); return tone; },
    convert: async (_bytes, _name, onProgress) => { calls.convert++; onProgress(0.5); return tone; },
  };
  return { d, calls };
}

test("a file the browser decodes never touches the converter", async () => {
  const { d, calls } = decoders(true);
  const heard: number[] = [];
  expect(await decode(file("song.mp3"), d, (r) => heard.push(r))).toEqual({ samples: tone, converted: false });
  expect(calls.convert).toBe(0);
  expect(heard).toEqual([]);
});

test("a decode failure converts on the device and reports progress", async () => {
  const { d, calls } = decoders(false);
  const heard: number[] = [];
  expect(await decode(file(), d, (r) => heard.push(r))).toEqual({ samples: tone, converted: true });
  expect(calls.convert).toBe(1);
  expect(heard).toEqual([0, 0.5]);
});

test("an empty native decode also converts, and an empty conversion is an error", async () => {
  const d: Decoders = { native: async () => new Float32Array(0), convert: async () => new Float32Array(0) };
  await expect(decode(file(), d)).rejects.toThrow("no audio");
});

test("the converter reads a fresh buffer, since decodeAudioData detaches the first", async () => {
  const seen: ArrayBuffer[] = [];
  const f = { name: "a.wma", arrayBuffer: async () => { const b = new ArrayBuffer(4); seen.push(b); return b; } };
  let got: Uint8Array | null = null;
  await decode(f, { native: async () => { throw new Error("nope"); }, convert: async (b) => { got = b; return tone; } });
  expect(seen.length).toBe(2);
  expect(got!.buffer).toBe(seen[1]!);
});

test("ffmpeg is asked for 16 kHz mono float32, no video", () => {
  expect(ffmpegArgs("in.wma", "out.pcm")).toEqual(["-i", "in.wma", "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "out.pcm"]);
});

test("the input name keeps a probe-able extension and nothing else", () => {
  expect(inputName("My Song (live).WMA")).toBe("in.wma");
  expect(inputName("../../etc/passwd")).toBe("in");
  expect(inputName("track.m4a")).toBe("in.m4a");
});

test("f32le reads little-endian floats, even off a 4-byte boundary", () => {
  const raw = new Uint8Array(13);
  new DataView(raw.buffer).setFloat32(1, 0.25, true);
  new DataView(raw.buffer).setFloat32(5, -1, true);
  new DataView(raw.buffer).setFloat32(9, 0.5, true);
  expect([...f32le(raw.subarray(1))]).toEqual([0.25, -1, 0.5]);
});
