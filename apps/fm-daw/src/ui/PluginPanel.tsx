// A track's sound picked off the track menu: its own FM voice, or a CLAP plugin on this computer (#5265). On a plugin
// track the plugin's parameters are the sliders, MIDI learn works on them, and a plugin that stops says so here.
import { useEffect, useState } from "react";
import type { TrackDoc } from "../project.ts";
import type { PluginChoice, PluginParam, TrackPlugin } from "../plugin-track.ts";
import type { PluginShown } from "./plugins.ts";
import { armPlugin, useLearn } from "./learn.ts";
import { Slider } from "./Slider.tsx";
import { P } from "../engine/params.ts";

const STEPS = 1000;

/** The track menu: FM, or one of the plugins found. The current plugin stays listed even when this computer hasn't got it. */
export function TrackSound(props: { track: TrackDoc; choices: () => Promise<PluginChoice[]>; onPlugin(p: TrackPlugin | null): void }) {
  const [list, setList] = useState<PluginChoice[] | null>(null);
  useEffect(() => { let on = true; void props.choices().then((l) => { if (on) setList(l); }); return () => { on = false; }; }, [props.choices]);
  const cur = props.track.plugin;
  const key = (c: { path: string; index: number }) => `${c.index}:${c.path}`;
  const all = cur && !list?.some((c) => key(c) === key(cur)) ? [{ path: cur.path, index: cur.index, name: cur.name, vendor: "" }, ...(list ?? [])] : list ?? [];
  return (
    <label className="field inline"><span className="silk">Plays</span>
      <select value={cur ? key(cur) : ""} aria-label="What plays this track"
        onChange={(e) => {
          const c = all.find((x) => key(x) === e.currentTarget.value);
          props.onPlugin(c ? { path: c.path, index: c.index, name: c.name, values: [] } : null);
        }}>
        <option value="">FM synth</option>
        {all.length > 0 && <optgroup label="Plugins">
          {all.map((c) => <option key={key(c)} value={key(c)}>{c.name}{c.vendor ? ` · ${c.vendor}` : ""}</option>)}
        </optgroup>}
        {list?.length === 0 && !cur && <option disabled>No CLAP plugins found</option>}
      </select>
    </label>
  );
}

/** A plugin track's sliders, and how it's doing. */
export function PluginPanel(props: { track: TrackDoc; color: string; shown: PluginShown | undefined; head: React.ReactNode; onValue(id: number, v: number): void; onParam(i: number, v: number): void }) {
  const s = props.shown, plug = props.track.plugin;
  return (
    <section className="patch" style={{ "--track": props.color } as React.CSSProperties} aria-label={`${props.track.name} plugin`}>
      <header className="patch-head">
        <h2>{props.track.name} <span className="dim">· {plug?.name ?? "plugin"}</span></h2>
        {props.head}
      </header>
      {s?.error ? <p className="note-bar" role="alert">{s.error}. The rest of the mix plays on.</p>
        : s?.starting || !s ? <p className="dim">Starting {plug?.name}…</p>
        : s.params.length === 0 ? <p className="dim">{plug?.name} has no sliders.</p> : null}
      <div className="voice">
        {!!s?.params.length && <fieldset className="op">
          <legend><span className="silk">{plug?.name}</span></legend>
          {s.params.map((q) => <PluginSlider key={q.id} param={q} onChange={(v) => props.onValue(q.id, v)} />)}
        </fieldset>}
        <fieldset className="op">
          <legend><span className="silk">Mix</span></legend>
          <Slider label="Level" index={P.GAIN} value={props.track.params[P.GAIN]} onChange={(v) => props.onParam(P.GAIN, v)} />
        </fieldset>
      </div>
    </section>
  );
}

function PluginSlider(props: { param: PluginParam; onChange(v: number): void }) {
  const { param: q } = props;
  const span = q.max - q.min || 1;
  const learn = useLearn();
  const cc = learn.map.find((m) => m.plug?.id === q.id)?.cc;
  const armed = learn.armed?.plug?.id === q.id;
  const arm = () => armPlugin(q.id, q.min, q.max, q.name);
  const shown = q.stepped ? String(Math.round(q.value)) : Math.abs(span - 1) < 1e-9 && q.min === 0 ? `${Math.round(q.value * 100)}%` : q.value.toFixed(2);
  return (
    <label className={learn.on ? (armed ? "fader learn armed" : "fader learn") : "fader"} onPointerDown={arm} onFocus={arm}>
      <span className="silk">{q.name}</span>
      <input type="range" min={0} max={q.stepped ? Math.round(span) : STEPS} step={1}
        value={q.stepped ? Math.round(q.value - q.min) : Math.round(((q.value - q.min) / span) * STEPS)}
        onChange={(e) => { const x = Number(e.currentTarget.value); props.onChange(q.stepped ? q.min + x : q.min + (x / STEPS) * span); }} />
      <output className={learn.on && cc !== undefined ? "cc" : undefined}>{learn.on && cc !== undefined ? `CC ${cc}` : shown}</output>
    </label>
  );
}
