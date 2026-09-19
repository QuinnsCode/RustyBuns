import { useState } from "react";
import { bounceOnHost } from "../actions/bounce.ts";
import { bounceInBrowser, wavUrlFromBase64, type Lane, type LaneResult } from "./lanes.ts";

const LANES: { id: Lane; name: string; where: string }[] = [
  { id: "rust", name: "Rust", where: "Native engine in the app, through FFI" },
  { id: "ts-host", name: "TypeScript on Bun", where: "Same engine in TypeScript, in the app" },
  { id: "ts-browser", name: "TypeScript in the window", where: "Same engine in TypeScript, in the page" },
];

export function Benchmark({ available, unison, setUnison, songSeconds }: {
  available: (l: Lane) => boolean; unison: number; setUnison: (n: number) => void; songSeconds: number;
}) {
  const [results, setResults] = useState<Partial<Record<Lane, LaneResult>>>({});
  const [running, setRunning] = useState<Lane | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function race() {
    setError(null); setResults({});
    for (const { id } of LANES) {
      if (!available(id)) continue;
      setRunning(id);
      try {
        const r = id === "ts-browser" ? await bounceInBrowser(unison)
          : await bounceOnHost(id, unison).then((h) => ({ ...h, wavUrl: wavUrlFromBase64(h.wavBase64) }));
        setResults((prev) => ({ ...prev, [id]: r }));
      } catch (e) { setError(`${LANES.find((l) => l.id === id)!.name}: ${(e as Error).message}`); }
    }
    setRunning(null);
  }

  const best = Math.max(1, ...Object.values(results).map((r) => r!.realtimeX));
  return (
    <div className="bench">
      <p className="bench-lede">
        Each engine below computes this whole song from silence: every oscillator, filter and delay,
        about {Math.round((songSeconds * 44100) / 1000) / 1000} million samples per channel. They all produce
        the same audio, so the only question is how long each one takes.
      </p>
      <div className="bench-controls">
        <label className="knob">
          <span className="silk">Oscillators per voice</span>
          <input type="range" min={1} max={8} value={unison} disabled={!!running} onChange={(e) => setUnison(Number(e.target.value))} />
          <output>{unison}</output>
          <span className="dim">More oscillators, more work per sample.</span>
        </label>
        <button className="go" onClick={race} disabled={!!running}>{running ? "Rendering…" : "Run all three"}</button>
      </div>
      <ol className="lanes">
        {LANES.map((l) => {
          const r = results[l.id], off = !available(l.id);
          return (
            <li key={l.id} className={`lane lane-${l.id}${running === l.id ? " is-running" : ""}${off ? " is-off" : ""}`}>
              <div className="lane-label">
                <span className="jack" aria-hidden />
                <div><h3>{l.name}</h3><p className="dim">{off ? "Needs the desktop app" : l.where}</p></div>
              </div>
              <div className="meter"><div className="fill" style={{ width: r ? `${(r.realtimeX / best) * 100}%` : "0%" }} /></div>
              <div className="readout">
                {r ? <>
                  <span className="big">{r.seconds.toFixed(0)} s in {(r.ms / 1000).toFixed(2)} s</span>
                  <span className="dim">{r.realtimeX.toFixed(0)}× faster than playing it</span>
                  <audio controls src={r.wavUrl} preload="none" />
                </> : <span className="dim">{running === l.id ? "Rendering…" : off ? "Unavailable" : "Not run yet"}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="dim bench-note">
        The two TypeScript lanes run on different JavaScript engines, the app's and this window's, so
        either can win. The Rust lane is the same machine code in both places.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
