// The lane of the track you sit at, over the jam room (#5205): sitting at an instrument is like having its lane open in
// FM DAW, so Tab (or the button by your hint) pops it up. Four tabs, each FM DAW's own editor: the patch (FM or analog
// knobs), Shape (the track's EQ), the mixer strip (level, pan, send, mute, solo) and the notes (a piano roll, or the kit's
// steps at the drums). Every change goes through lane-model.ts: an op over the sesh when your grants allow it (knobs
// and notes are "edit", EQ and mute/solo "mix"), read only when they don't. The room keeps running under it, so you keep
// playing with it open. It lives in a shadow root, so FM DAW's stylesheet styles it and nothing else on the page.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import css from "../ui/app.css?inline";
import { P } from "../engine/params.ts";
import { flatEq } from "../engine/eq.ts";
import { loopBeats } from "../project.ts";
import { KIT, randomPatch } from "../presets.ts";
import { loadSound } from "../sounds.ts";
import { TRACK_COLORS } from "../ui/colors.ts";
import { PatchEditor } from "../ui/PatchEditor.tsx";
import { Shape } from "../ui/Shape.tsx";
import { Slider } from "../ui/Slider.tsx";
import { PianoRoll } from "../ui/PianoRoll.tsx";
import { DrumGrid } from "../ui/DrumGrid.tsx";
import { laneModel, TABS, type LaneHost, type LaneModel, type Tab } from "./lane-model.ts";

const TAB_NAME: Record<Tab, string> = { patch: "Patch", eq: "EQ", mixer: "Mixer", notes: "Notes" };

// lucide's sliders-horizontal and x (ISC)
const SLIDERS = [[21, 4, 14, 4], [10, 4, 3, 4], [21, 12, 12, 12], [8, 12, 3, 12], [21, 20, 16, 20], [12, 20, 3, 20], [14, 2, 14, 6], [8, 10, 8, 14], [16, 18, 16, 22]];
const Icon = ({ name }: { name: "sliders" | "x" }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    {name === "x" ? <path d="M18 6 6 18M6 6l12 12" /> : SLIDERS.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
  </svg>
);

// FM DAW's sheet has a .lane of its own (the piano roll's rows), so these are .jam-lane and .jl-*
const LANE_CSS = `
:host { all: initial; }
.jl-btn { position: fixed; right: 16px; bottom: 64px; z-index: 30; display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: rgba(21,23,27,.82); color: #f4f1ea; border: 1px solid #3a3f47; border-radius: 10px; font: 600 15px var(--silk); }
.jl-btn:hover { background: rgba(38,41,48,.92); }
.jam-lane { position: fixed; top: 60px; right: 12px; bottom: 12px; width: min(720px, calc(100vw - 24px)); z-index: 31; display: flex; flex-direction: column;
  background: var(--bg); color: var(--ink); font: 14px/1.45 var(--body); border: 1px solid var(--edge); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; }
.jl-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--edge); border-top: 3px solid var(--track); }
.jl-head h2 { margin: 0; font: 600 18px var(--silk); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jl-head select { padding: 3px 6px; background: var(--raised); border: 1px solid var(--edge); border-radius: 4px; }
.jl-x { display: grid; place-items: center; width: 32px; height: 32px; background: var(--raised); border: 1px solid var(--edge); border-radius: 6px; }
.jl-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.jl-tabs button { flex: 1; padding: 6px 4px; background: var(--panel); border: 1px solid var(--edge); border-bottom: none; border-radius: 6px 6px 0 0; font: 600 15px var(--silk); color: var(--dim); }
.jl-tabs button.on { background: var(--raised); color: var(--ink); }
.jl-body { flex: 1; overflow: auto; padding: 10px 12px 14px; display: grid; gap: 10px; align-content: start; }
.jl-body.ro > :not(.jl-ro) { pointer-events: none; opacity: .7; }
.jl-ro, .jl-said { margin: 0; padding: 6px 10px; border-radius: 6px; background: var(--raised); color: var(--warn); font-size: 13px; }
.jl-strip { display: grid; gap: 10px; padding: 14px; background: var(--panel); border: 1px solid var(--edge); border-top: 3px solid var(--track); border-radius: 6px; }
.jl-strip .row { display: flex; gap: 8px; }
.jl-strip .row button { flex: 1; padding: 8px; background: var(--raised); border: 1px solid var(--edge); border-radius: 6px; font: 600 15px var(--silk); }
.jl-strip .row button.on { background: var(--track); color: #15171b; }
@media (max-width: 520px) { .jam-lane { top: 52px; right: 0; left: 0; bottom: 0; width: auto; border-radius: 10px 10px 0 0; } .jl-btn { bottom: 96px; right: 12px; } }
`;

function View({ m }: { m: LaneModel }) {
  useSyncExternalStore(m.subscribe, m.version);
  const host = m.host, seat = host.seat(), p = host.project(), i = m.track(), t = p.tracks[i];
  if (!seat || !t) return null;
  if (!m.isOpen()) return <button className="jl-btn" type="button" title="Open this track's lane (Tab)" aria-label="Open this track's lane" onClick={() => m.open()}><Icon name="sliders" />Tab</button>;
  const tab = m.tab(), s = m.state(), color = TRACK_COLORS[i % TRACK_COLORS.length]!;
  const ro = tab === "mixer" ? s.readOnly.edit && s.readOnly.mix : tab === "eq" ? s.readOnly.mix : s.readOnly.edit;
  const withParams = (params: number[]) => m.edit({ t: "replace", project: { ...p, tracks: p.tracks.map((x, k) => (k === i ? { ...x, params } : x)) } });
  const param = (k: number, v: number) => m.edit({ t: "param", track: i, i: k, v });
  const drums = p.tracks.map((x, k) => ({ x, k })).filter(({ x }) => x.kind === "drum");
  return (
    <section className="jam-lane" role="dialog" aria-label={`${t.name}'s lane`} style={{ "--track": color } as React.CSSProperties}>
      <header className="jl-head">
        <h2>{t.name} <span className="dim">· {seat.label}</span></h2>
        {seat.drums && drums.length > 1 && (
          <select aria-label="Which drum" value={i} onChange={(e) => m.pick(Number(e.currentTarget.value))}>
            {drums.map(({ x, k }) => <option key={k} value={k}>{x.name}</option>)}
          </select>
        )}
        <button className="jl-x" type="button" title="Close (Tab)" aria-label="Close the lane" onClick={() => m.close()}><Icon name="x" /></button>
      </header>
      <nav className="jl-tabs" role="tablist">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => m.setTab(k)}>{TAB_NAME[k]}</button>)}
      </nav>
      <div className={ro ? "jl-body ro" : "jl-body"}>
        {ro && <p className="jl-ro">Read only: you may listen and play, not change this. H raises your hand</p>}
        {s.refused && !ro && <p className="jl-said">{s.refused}</p>}
        {tab === "patch" && (
          <PatchEditor track={t} color={color} onParam={param} duck={{ names: p.tracks.map((x) => x.name), self: i }}
            onSound={(x) => withParams(loadSound(t.params, x))}
            onRandom={() => withParams(randomPatch(t.kind, t.params))}
            onReset={() => withParams((KIT[i]?.params ?? t.params).slice())}
            onAudition={() => host.audition(i)} />
        )}
        {tab === "eq" && (
          <Shape key={`lane:${i}`} head={<span className="silk">Shape · {t.name}</span>} doc={t.eq ?? flatEq()} sampleRate={48000} analyser={null}
            onChange={(bands) => m.edit({ t: "eq", bands, track: i })} />
        )}
        {tab === "mixer" && (
          <div className="jl-strip" aria-label={`${t.name}'s mixer strip`}>
            <Slider label="Level" index={P.GAIN} value={t.params[P.GAIN]!} onChange={(v) => param(P.GAIN, v)} />
            <Slider label="Pan" index={P.PAN} value={t.params[P.PAN]!} unit="pan" onChange={(v) => param(P.PAN, v)} />
            <Slider label="Send" index={P.SEND} value={t.params[P.SEND]!} onChange={(v) => param(P.SEND, v)} />
            <div className="row">
              <button type="button" className={t.mute ? "on" : ""} aria-pressed={t.mute} onClick={() => m.edit({ t: "track", track: i, mute: !t.mute })}>Mute</button>
              <button type="button" className={t.solo ? "on" : ""} aria-pressed={t.solo} onClick={() => m.edit({ t: "track", track: i, solo: !t.solo })}>Solo</button>
            </div>
          </div>
        )}
        {tab === "notes" && (t.kind === "drum"
          ? <DrumGrid tracks={p.tracks} colors={TRACK_COLORS} selected={i} loopBeats={loopBeats(p)}
              onSelect={(k) => m.pick(k)} onAudition={(k) => host.audition(k)}
              onNotes={(k, notes) => m.edit({ t: "notes", track: k, notes })} />
          : <PianoRoll key={i} track={t} color={color} loopBeats={loopBeats(p)} grid={0.25}
              onNotes={(notes) => m.edit({ t: "notes", track: i, notes })}
              onPreview={(_, on) => { if (on) host.audition(i); }} />)}
      </div>
    </section>
  );
}

/** Mount the lane on the page: a button that shows while you sit, and the modal it opens. */
export function mountLane(host: LaneHost): LaneModel {
  const el = document.createElement("div");
  el.id = "jl-host";
  document.body.append(el);
  const root = el.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // FM DAW's sheet, its page-wide rules turned onto this root alone
  style.textContent = css.replaceAll(":root", ":host").replace(/html, body, #root \{[^}]*\}/, "").replace(/body \{[^}]*\}/, "") + LANE_CSS;
  const mount = document.createElement("div");
  root.append(style, mount);
  const m = laneModel(host);
  createRoot(mount).render(<View m={m} />);
  // sitting and standing happen in many places (a key, a click, a pad, an agent's tool): watch the seat a few times a second
  let seatWas = "";
  setInterval(() => { const k = JSON.stringify(host.seat()); if (k !== seatWas) { seatWas = k; m.refresh(); } }, 200);
  return m;
}
