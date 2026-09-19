// The browser lane: the TS engine in this tab, off the main thread would be
// fairer to the UI but not to the race, so it runs inline after a paint.
import demo from "../../songs/demo.json";
import { compileSong, type SongJson } from "../engine/song.ts";
import { TsEngine } from "../engine/engine.ts";
import { bounce, encodeWav } from "../engine/bounce.ts";

export type Lane = "rust" | "ts-host" | "ts-browser";
export interface LaneResult { lane: Lane; ms: number; realtimeX: number; seconds: number; wavUrl: string }

export async function bounceInBrowser(unison: number): Promise<LaneResult> {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const r = bounce(new TsEngine(compileSong(demo as SongJson, { unison })), 44100);
  const wav = encodeWav(r.audio, 44100);
  return { lane: "ts-browser", ms: r.ms, realtimeX: r.realtimeX, seconds: r.frames / 44100, wavUrl: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })) };
}

export function wavUrlFromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

const song = demo as SongJson;
export const songInfo = {
  name: song.name,
  bpm: song.bpm,
  bars: Math.ceil(Math.max(...song.tracks.flatMap((t) => t.notes.map((n) => n[0] + n[1]))) / 4),
  tracks: song.tracks.map((t) => ({
    name: t.name,
    wave: t.wave,
    notes: t.notes.length,
    detail: [
      `${t.unison ?? 1} osc`,
      `cutoff ${t.cutoff} Hz`,
      ...(t.delay?.mix ? ["delay"] : []),
    ].join(", "),
    // When each track first and last plays, for the timeline strip.
    from: Math.min(...t.notes.map((n) => n[0])),
    to: Math.max(...t.notes.map((n) => n[0] + n[1])),
  })),
};
export const songBeats = Math.max(...song.tracks.flatMap((t) => t.notes.map((n) => n[0] + n[1])));
