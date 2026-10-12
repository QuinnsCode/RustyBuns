// ffmpeg.wasm, for the files Web Audio can't decode. Critic.tsx imports this module
// dynamically, so it's its own chunk and none of it loads until a decode fails. The core
// (~30 MB of wasm, over Workers' 25 MiB asset limit) comes from jsDelivr, pinned, once.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { f32le, ffmpegArgs, inputName } from "../decode.ts";

/** Pinned: the ESM single-thread core, which needs no cross-origin isolation. */
export const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let loading: Promise<FFmpeg> | null = null;

function ffmpeg(): Promise<FFmpeg> {
  loading ??= (async () => {
    const f = new FFmpeg();
    await f.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return f;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/** Any file ffmpeg can read -> 16 kHz mono float samples. */
export async function convert(bytes: Uint8Array, name: string, onProgress: (ratio: number) => void): Promise<Float32Array> {
  const f = await ffmpeg();
  const input = inputName(name), output = "out.pcm";
  const progress = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)));
  f.on("progress", progress);
  try {
    await f.writeFile(input, bytes);
    if (await f.exec(ffmpegArgs(input, output))) throw new Error("ffmpeg couldn't read that file");
    return f32le((await f.readFile(output)) as Uint8Array);
  } finally {
    f.off("progress", progress);
    await f.deleteFile(input).catch(() => {});
    await f.deleteFile(output).catch(() => {});
  }
}
