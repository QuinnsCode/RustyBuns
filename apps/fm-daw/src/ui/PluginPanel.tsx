// A track's sound picked off the track menu: its own FM voice, a CLAP plugin on this computer (#5265), or a Web Audio
// Module played in the page (#4899): one FM DAW carries, or one from a link. On a plugin track the plugin's parameters
// are the sliders, MIDI learn works on them, and a plugin that stops says so here.
import { useEffect, useState } from "react";
import type { TrackDoc } from "../project.ts";
import { ownCopy, type PluginChoice, type PluginParam, type TrackPlugin } from "../plugin-track.ts";
import type { PluginShown } from "./plugins.ts";
import { armPlugin, useLearn } from "./learn.ts";
import { Slider } from "./Slider.tsx";
import { P } from "../engine/params.ts";
import { siteOf } from "./wam.ts";

const STEPS = 1000;

/** The track menu: FM, or one of the plugins found. The current plugin stays listed even when this computer hasn't got it. */
export function TrackSound(props: { track: TrackDoc; choices: () => Promise<PluginChoice[]>; onPlugin(p: TrackPlugin | null): void }) {
  const [list, setList] = useState<PluginChoice[] | null>(null);
  useEffect(() => { let on = true; void props.choices().then((l) => { if (on) setList(l); }); return () => { on = false; }; }, [props.choices]);
  const cur = props.track.plugin;
  const [link, setLink] = useState<string | null>(null);
  const key = (c: { path: string; index: number; web?: boolean }) => `${c.web ? "w" : ""}${c.index}:${c.path}`;
  // a friend's groove names the plugin in their folder: this computer's own copy is the one picked in the menu
  const mine = cur && list ? ownCopy(cur, list) : null;
  const all = cur && !mine ? [{ path: cur.path, index: cur.index, name: cur.name, vendor: "", web: cur.web }, ...(list ?? [])] : list ?? [];
  const at = link === null ? null : siteOf(link.trim(), location.href);
  if (link !== null) return (
    <form className="field inline" onSubmit={(e) => {
      e.preventDefault();
      if (!at) return;
      // named after its folder until it loads: ".../obxd/index.js" reads "obxd"
      const name = new URL(at.url).pathname.split("/").filter((x) => x && !/^index\.m?js$/.test(x)).pop() ?? "Web plugin";
      props.onPlugin({ path: at.url, index: 0, name: decodeURIComponent(name).slice(0, 200), web: true, values: [] });
      setLink(null);
    }}>
      <span className="silk">Link</span>
      <input type="url" autoFocus value={link} placeholder="https://…/index.js" aria-label="A Web Audio Module's address" onChange={(e) => setLink(e.currentTarget.value)} />
      <button className="ghost" disabled={!at}>Load</button>
      <button className="ghost" type="button" onClick={() => setLink(null)}>Cancel</button>
    </form>
  );
  return (
    <label className="field inline"><span className="silk">Plays</span>
      <select value={cur ? key(mine ?? cur) : ""} aria-label="What plays this track"
        onChange={(e) => {
          if (e.currentTarget.value === "link") return setLink("");
          const c = all.find((x) => key(x) === e.currentTarget.value);
          props.onPlugin(c ? { path: c.path, index: c.index, ...(c.id ? { id: c.id } : {}), name: c.name, ...(c.web ? { web: true } : {}), values: [] } : null);
        }}>
        <option value="">FM synth</option>
        {all.length > 0 && <optgroup label="Plugins">
          {all.map((c) => <option key={key(c)} value={key(c)}>{c.name}{c.vendor ? ` · ${c.vendor}` : ""}</option>)}
        </optgroup>}
        <option value="link">A web plugin from a link…</option>
      </select>
    </label>
  );
}

/** A plugin track's sliders, and how it's doing. */
export function PluginPanel(props: { track: TrackDoc; color: string; shown: PluginShown | undefined; head: React.ReactNode; onValue(id: number, v: number): void; onParam(i: number, v: number): void; onEditor(): Promise<string | null>; onTrust(): void }) {
  const s = props.shown, plug = props.track.plugin;
  const [editorNote, setEditorNote] = useState<string | null>(null);
  return (
    <section className="patch" style={{ "--track": props.color } as React.CSSProperties} aria-label={`${props.track.name} plugin`}>
      <header className="patch-head">
        <h2>{props.track.name} <span className="dim">· {plug?.name ?? "plugin"}</span></h2>
        {props.head}
        {s?.editor && !s.error && <div className="patch-actions">
          <button className="ghost" title="Open the plugin's own window" onClick={() => { void props.onEditor().then(setEditorNote); }}>Editor</button>
        </div>}
      </header>
      {editorNote && <p className="note-bar" role="status">{editorNote}</p>}
      {s?.site ? <p className="note-bar" role="alert">{s.error}. A plugin is code: it can do anything this page can, as you. Say yes only for a site you know.{" "}
          <button className="ghost" onClick={props.onTrust}>Let {new URL(s.site).host} run plugins here</button></p>
        : s?.error ? <p className="note-bar" role="alert">{s.error}. The rest of the mix plays on.</p>
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
