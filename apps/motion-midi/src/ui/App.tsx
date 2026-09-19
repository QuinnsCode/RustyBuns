import { useEffect, useRef, useState } from "react";
import { bounceOnHost, hostInfo } from "../actions/bounce.ts";
import { bounceInBrowser, wavUrlFromBase64, songInfo, songBeats, type Lane, type LaneResult } from "./lanes.ts";
import { Benchmark } from "./Benchmark.tsx";
import "./app.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";

type Host = { rust: boolean; platform: string } | null | "none";
const ENGINE_NAME: Record<Lane, string> = { rust: "Rust", "ts-host": "TypeScript on Bun", "ts-browser": "TypeScript in the window" };

export function App() {
  const [host, setHost] = useState<Host>(null);
  const [unison, setUnison] = useState(4);
  const [render, setRender] = useState<LaneResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBench, setShowBench] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { hostInfo().then(setHost, () => setHost("none")); }, []);

  const available = (l: Lane) => l === "ts-browser" || (host !== null && host !== "none" && (l !== "rust" || host.rust));
  const engine: Lane = available("rust") ? "rust" : available("ts-host") ? "ts-host" : "ts-browser";

  async function renderSong() {
    setError(null); setRendering(true); setPlaying(false); setAt(0);
    try {
      const r = engine === "ts-browser" ? await bounceInBrowser(unison)
        : await bounceOnHost(engine, unison).then((h) => ({ ...h, wavUrl: wavUrlFromBase64(h.wavBase64) }));
      setRender(r);
      // Rendering is the wait; hearing it is the point, so start playing.
      requestAnimationFrame(() => audio.current?.play().catch(() => {}));
    } catch (e) { setError((e as Error).message); }
    setRendering(false);
  }

  const dur = render?.seconds ?? (songBeats / songInfo.bpm) * 60;
  return (
    <main className="panel">
      <header className="head">
        <h1>Motion MIDI</h1>
        <p className="lede">
          A synth written twice, once in Rust and once in TypeScript, inside one downloadable app.
          Play the song, then open the engine comparison to see what the Rust build buys you.
        </p>
      </header>

      <section className="transport" aria-label="Playback">
        <button className="play" onClick={() => {
          if (!render) return renderSong();
          const a = audio.current!;
          if (a.paused) { a.play(); } else { a.pause(); }
        }} disabled={rendering}>
          {rendering ? "Rendering…" : !render ? "Render and play" : playing ? "Pause" : "Play"}
        </button>
        <div className="transport-body">
          <div className="song-line">
            <strong>{songInfo.name}</strong>
            <span className="dim">{songInfo.bpm} bpm, {songInfo.bars} bars, {dur.toFixed(0)} s</span>
          </div>
          <div className="scrub" style={{ "--p": `${render ? (at / dur) * 100 : 0}%` } as React.CSSProperties}>
            <div className="scrub-fill" />
          </div>
          <p className="dim status">
            {rendering ? `${ENGINE_NAME[engine]} is computing every sample…`
              : render ? `Rendered by ${ENGINE_NAME[render.lane]} in ${(render.ms / 1000).toFixed(2)} s, which is ${render.realtimeX.toFixed(0)}× faster than playing it.`
              : "Nothing rendered yet. The synth builds the audio from the notes before it can play."}
          </p>
        </div>
      </section>

      {render && <audio ref={audio} src={render.wavUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0); }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} />}

      <section aria-label="Tracks">
        <h2>Tracks</h2>
        <ol className="tracks">
          {songInfo.tracks.map((t) => (
            <li key={t.name} className="track">
              <div className="track-name"><strong>{t.name}</strong><span className="dim">{t.wave}, {t.detail}</span></div>
              <div className="bars" aria-hidden>
                <div className="bars-span" style={{ left: `${(t.from / songBeats) * 100}%`, width: `${((t.to - t.from) / songBeats) * 100}%` }} />
                {render && playing && <div className="bars-head" style={{ left: `${(at / dur) * 100}%` }} />}
              </div>
              <span className="dim notes">{t.notes} notes</span>
            </li>
          ))}
        </ol>
        <p className="dim">Editing the song means editing <code>songs/demo.json</code> for now. A note editor and a live keyboard come next.</p>
      </section>

      <section className="bench-open">
        <button className="ghost" aria-expanded={showBench} onClick={() => setShowBench((s) => !s)}>
          {showBench ? "Hide engine comparison" : "Compare engines"}
        </button>
        {showBench && <Benchmark available={available} unison={unison} setUnison={setUnison} songSeconds={dur} />}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <footer className="dim foot">
        {host === "none" ? "Running on the web, so the TypeScript engine in this window does the work. The desktop app adds the Rust engine."
          : host ? `Desktop app on ${host.platform}${host.rust ? ", Rust engine available" : ", no Rust build for this platform"}.`
          : "Checking the app…"}
      </footer>
    </main>
  );
}
