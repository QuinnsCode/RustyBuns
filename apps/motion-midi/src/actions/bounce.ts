"use server";
// Runs on the desktop host. Rust through FFI, or the same TS engine under Bun.
import demo from "../../songs/demo.json";
import { compileSong, type SongJson } from "../engine/song.ts";
import { TsEngine } from "../engine/engine.ts";
import { bounce, encodeWav } from "../engine/bounce.ts";
import { createRustEngine } from "../engine/native.ts";

export interface HostBounce { lane: "rust" | "ts-host"; ms: number; realtimeX: number; seconds: number; wavBase64: string }

export async function hostInfo() {
  const rust = await createRustEngine(compileSong(demo as SongJson));
  rust?.free?.();
  return { rust: !!rust, platform: `${process.platform}-${process.arch}`, bun: Bun.version };
}

export async function bounceOnHost(lane: "rust" | "ts-host", unison: number): Promise<HostBounce> {
  const song = compileSong(demo as SongJson, { unison });
  const engine = lane === "rust" ? await createRustEngine(song) : new TsEngine(song);
  if (!engine) throw new Error("No Rust engine for this platform. Build it with `bun run build:native`.");
  const r = bounce(engine, 44100);
  return {
    lane, ms: r.ms, realtimeX: r.realtimeX, seconds: r.frames / 44100,
    wavBase64: Buffer.from(encodeWav(r.audio, 44100)).toString("base64"),
  };
}
