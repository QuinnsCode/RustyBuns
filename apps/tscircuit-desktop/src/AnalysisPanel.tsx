import { useEffect, useRef, useState } from "react";
import { api, type Timed } from "./api.ts";
import { analyzeInBrowser } from "./analysis/client.ts";

const ENGINE_LABEL: Record<string, string> = {
  "rust-native": "Rust, native (host, all cores)",
  "ts-host": "TypeScript (host)",
  "rust-wasm": "Rust, wasm (browser)",
  "ts-worker": "TypeScript (browser)",
};
const fmt = (n: number | null | undefined, d = 2) => (n == null ? "–" : n.toFixed(d));

export function AnalysisPanel({ native, board, circuitJson, renderedAt }: {
  native: boolean; board: string | null; circuitJson: unknown[] | null; renderedAt: number;
}) {
  const [min, setMin] = useState(0.15);
  const [latest, setLatest] = useState<Timed | null>(null);
  const [race, setRace] = useState<Timed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ text: string; dir?: string } | null>(null);
  const seq = useRef(0);

  // Every finished render gets analyzed on the fastest engine available.
  // Only the newest request may land: typing a new gap fires several.
  useEffect(() => {
    if (!circuitJson) return;
    setRace(null);
    const mine = ++seq.current;
    api.analyze(JSON.stringify(circuitJson), min).then(
      (r) => { if (mine === seq.current) { setLatest(r); setError(null); } },
      (e) => { if (mine === seq.current) setError(e.message); },
    );
  }, [renderedAt, min]);

  const compare = async () => {
    if (!circuitJson) return;
    setBusy(true);
    const text = JSON.stringify(circuitJson);
    try {
      const runs = [
        ...(native ? [await api.analyze(text, min, "auto")] : []),
        await api.analyze(text, min, "ts"),
        await analyzeInBrowser(text, min),
      ];
      setRace(runs);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const exportAs = async (format: string) => {
    if (!circuitJson || !board) return;
    try {
      const r = await api.export(format, circuitJson, board);
      setExported({ text: `Wrote ${r.written.length} file${r.written.length === 1 ? "" : "s"} to ${r.dir}`, dir: r.dir });
    } catch (e) { setExported({ text: `Export failed: ${(e as Error).message}` }); }
  };

  const r = latest?.result;
  const slowest = race ? Math.max(...race.map((x) => x.ms), 0.01) : 1;

  return (
    <aside className="inspector" aria-label="Board analysis">
      <section>
        <h2>Analysis</h2>
        {!circuitJson && <p className="muted">Waiting for the board to finish rendering.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {latest && (
          <p className="engine-line">
            <span className={`engine-chip ${latest.engine.startsWith("rust") ? "on" : ""}`}>{ENGINE_LABEL[latest.engine] ?? latest.engine}</span>
            <span className="num">{fmt(latest.ms)} ms</span>
          </p>
        )}
      </section>

      {r && (
        <>
          <section>
            <h3>Clearance</h3>
            <label className="row">
              Minimum gap
              <input type="number" step="0.01" min="0" value={min} onChange={(e) => setMin(Math.max(0, Number(e.target.value)))} /> mm
            </label>
            <p className={r.clearance.violation_count ? "drc bad" : "drc ok"}>
              {r.clearance.violation_count
                ? `${r.clearance.violation_count} spot${r.clearance.violation_count === 1 ? "" : "s"} closer than ${fmt(min)} mm`
                : `No copper closer than ${fmt(min)} mm`}
            </p>
            <dl>
              <dt>Closest gap</dt><dd className="num">{fmt(r.clearance.min_gap_mm, 3)} mm</dd>
              <dt>Pairs measured</dt>
              <dd className="num" title="The spatial index only measures copper that could be close. Brute force would measure every pair.">
                {r.clearance.pairs_checked.toLocaleString()} of {r.clearance.pairs_possible.toLocaleString()}
              </dd>
            </dl>
            {r.clearance.violations.length > 0 && (
              <ol className="violations">
                {r.clearance.violations.slice(0, 12).map((v, i) => (
                  <li key={i} title={`${v.a} to ${v.b}`}>
                    <span className="nets">{v.net_a ?? <code>{v.a}</code>} ↔ {v.net_b ?? <code>{v.b}</code>}</span>
                    <span className="num">{fmt(v.gap_mm, 3)} mm</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3>Board</h3>
            <dl>
              <dt>Size</dt><dd className="num">{fmt(r.board.width_mm, 1)} × {fmt(r.board.height_mm, 1)} mm</dd>
              <dt>Layers</dt><dd className="num">{r.board.layers}</dd>
              <dt>Parts</dt><dd className="num">{r.counts.components}</dd>
              <dt>Nets</dt><dd className="num">{r.counts.nets}{r.routing.unrouted_nets ? `, ${r.routing.unrouted_nets} unrouted` : ""}</dd>
              <dt>Trace length</dt><dd className="num">{fmt(r.routing.total_length_mm, 1)} mm</dd>
              <dt>Thinnest trace</dt><dd className="num">{fmt(r.routing.min_width_mm, 3)} mm</dd>
              <dt>Vias</dt><dd className="num">{r.counts.vias}</dd>
              <dt>Copper</dt><dd className="num">{fmt(r.copper.total_mm2, 1)} mm² ({fmt(r.copper.density_pct, 1)}%)</dd>
            </dl>
          </section>

          {r.longest_nets.length > 0 && (
            <section>
              <h3>Longest nets</h3>
              <table className="nets">
                <tbody>
                  {r.longest_nets.map((n) => (
                    <tr key={n.name}><td>{n.name}</td><td className="num">{n.ports} pins</td><td className="num">{fmt(n.length_mm, 1)} mm</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="race">
            <h3>Engines</h3>
            <p className="muted">Run the same analysis on every engine and compare.</p>
            <button onClick={compare} disabled={busy}>{busy ? "Running…" : "Compare engines"}</button>
            {race && (
              <ul className="plain bars">
                {race.map((x) => (
                  <li key={x.engine} className={x.engine.startsWith("rust") ? "rust" : ""}>
                    <span>{ENGINE_LABEL[x.engine] ?? x.engine}</span>
                    <span className="bar" style={{ ["--w" as string]: `${Math.max(2, (x.ms / slowest) * 100)}%` }} />
                    <span className="num">{fmt(x.ms)} ms</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Export</h3>
            <p className="muted">Files go to <code>exports/</code> in the project folder.</p>
            <div className="row wrap">
              <button onClick={() => exportAs("gerbers")}>Gerbers + drill (.zip)</button>
              <button onClick={() => exportAs("bom")}>BOM</button>
              <button onClick={() => exportAs("pnp")}>Pick and place</button>
              <button onClick={() => exportAs("json")}>Circuit JSON</button>
            </div>
            {exported && (
              <p className="muted" role="status">
                {exported.text}{" "}
                {exported.dir && <button className="link" onClick={() => api.reveal(exported.dir!)}>Show in folder</button>}
              </p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
