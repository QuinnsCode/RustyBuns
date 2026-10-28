// Runs inside headless Chrome (scripts/render.ts serves it): renders the music offline, one stem at a time, and
// posts each take back as raw float32, left channel then right. ?bars=64 sets the length; the rest is a scenario.
import { Music, STEMS, type Stem } from "../src/audio.ts";
import { chartOf, fromSearch, Scenario } from "../src/scenario.ts";

const RATE = 44100;
const q = new URLSearchParams(location.search), bars = Number(q.get("bars") ?? 64);
const scene = fromSearch(location.search) ?? Scenario({ level: 5 });
const chart = { ...chartOf(scene), bars };
const beat = scene.beat;

const post = (path: string, body: BodyInit) => fetch(path, { method: "POST", body });
try {
  const parts: (Stem | null)[] = [null, ...STEMS];
  for (const only of parts) {
    const ctx = new OfflineAudioContext(2, Math.ceil(Music.length(chart, beat) * RATE), RATE);
    const music = new Music(ctx, 1);
    music.only = scene.stem ?? only;
    music.prepare(chart, beat);
    const buf = await ctx.startRendering();
    const out = new Float32Array(buf.length * 2);
    out.set(buf.getChannelData(0), 0);
    out.set(buf.getChannelData(1), buf.length);
    await post(`/stem?name=${only ?? "mix"}&rate=${RATE}&bpm=${chart.bpm}&bars=${chart.bars}&delay=${chart.delay}&from=${beat}`, out);
  }
  await post("/done", "ok");
} catch (e) {
  await post("/fail", String(e instanceof Error ? e.stack : e));
}
