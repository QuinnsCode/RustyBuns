// Race the engines on the current groove: TS and Rust-as-wasm here in the
// window, Rust over bun:ffi and TS under Bun on the desktop host.
import { useState } from "react";
import { TsEngine } from "../engine/engine.ts";
import { WasmEngine, instantiateFm } from "../engine/wasm.ts";
import { renderProject } from "../engine/offline.ts";
import { benchOnHost } from "../actions/files.ts";
import type { Project } from "../project.ts";

const SECONDS = 20;
type Row = { name: string; where: string; x: number | null; note?: string };

export function Bench(props: { project: Project; wasm: () => Promise<ArrayBuffer | null> }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const out: Row[] = [];
    const time = (make: () => import("../engine/engine.ts").FmEngine) => {
      const e = make();
      const t0 = performance.now();
      renderProject(e, props.project, 48000, SECONDS, 0.5);
      e.free?.();
      return SECONDS / ((performance.now() - t0) / 1000);
    };
    await new Promise((r) => setTimeout(r, 30)); // let "Racing…" paint
    out.push({ name: "TypeScript", where: "in the window", x: time(() => new TsEngine(48000)) });
    const bytes = await props.wasm();
    const ex = bytes ? await instantiateFm(bytes) : null;
    out.push(ex
      ? { name: "Rust → wasm", where: "in the window", x: time(() => new WasmEngine(ex, 48000)) }
      : { name: "Rust → wasm", where: "in the window", x: null, note: "not built" });
    try {
      const h = await benchOnHost(props.project, SECONDS);
      out.push({ name: "Rust", where: `on the host (bun:ffi, ${h.platform})`, x: h.rustX, note: h.rustX === null ? "not built for this platform" : undefined });
      out.push({ name: "TypeScript", where: "on the host (Bun)", x: h.tsX });
    } catch {
      out.push({ name: "Host lanes", where: "desktop app only", x: null, note: "no host here" });
    }
    setRows(out);
    setBusy(false);
  }

  const best = Math.max(...(rows ?? []).map((r) => r.x ?? 0), 1);
  return (
    <section className="bench" aria-label="Engine race">
      <div className="bench-head">
        <p className="dim">Renders {SECONDS} s of this groove as fast as possible. Same notes, same output, bit for bit; only the language differs.</p>
        <button className="ghost" onClick={run} disabled={busy}>{busy ? "Racing…" : rows ? "Race again" : "Race the engines"}</button>
      </div>
      {rows && (
        <ul className="race">
          {rows.map((r, i) => (
            <li key={i}>
              <span><strong>{r.name}</strong> <span className="dim">{r.where}</span></span>
              <span className="race-bar"><span style={{ width: `${((r.x ?? 0) / best) * 100}%` }} /></span>
              <span className="race-x">{r.x === null ? r.note : `${Math.round(r.x)}× realtime`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
