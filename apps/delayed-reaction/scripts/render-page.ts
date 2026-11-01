// Runs inside headless Chrome (scripts/render.ts serves it): renders the music offline, one stem at a time, and
// posts each take back as raw float32, left channel then right. ?bars=64 sets the length; the rest is a scenario.
import { Music, STEMS, type Stem } from "../src/audio.ts";
import { chartOf, fromSearch, Scenario, setupOf } from "../src/scenario.ts";

const RATE = 44100;
const q = new URLSearchParams(location.search);
const scene = fromSearch(location.search) ?? Scenario({ level: 5 });
const setup = setupOf(scene), made = chartOf(scene);
// A fixed loop is as long as asked (64 bars unless said); a setup's track is as long as its form.
const chart = { ...made, bars: q.get("bars") ? Number(q.get("bars")) : setup ? made.bars : 64 };
const beat = scene.beat;

const post = async (path: string, body: BodyInit) => {
  const res = await fetch(path, { method: "POST", body });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
};
try {
  // All five renders at once: each OfflineAudioContext has its own thread, and a 128-bar track is six minutes long.
  const parts: (Stem | null)[] = [null, ...STEMS];
  await Promise.all(parts.map(async (only) => {
    const ctx = new OfflineAudioContext(2, Math.ceil(Music.length(chart, beat) * RATE), RATE);
    const music = new Music(ctx, 1);
    music.only = scene.stem ?? only;
    music.prepare(chart, beat, setup);
    const buf = await ctx.startRendering();
    const out = new Float32Array(buf.length * 2);
    out.set(buf.getChannelData(0), 0);
    out.set(buf.getChannelData(1), buf.length);
    await post(`/stem?name=${only ?? "mix"}&rate=${RATE}&bpm=${chart.bpm}&bars=${chart.bars}&setup=${setup?.name ?? ""}&delay=${chart.delay}&from=${beat}`, out);
  }));
  await post("/done", "ok");
} catch (e) {
  await post("/fail", String(e instanceof Error ? e.stack : e));
}
