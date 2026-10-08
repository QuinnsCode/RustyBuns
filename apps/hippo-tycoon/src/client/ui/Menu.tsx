import { useState } from "react";
import { DIFFICULTIES, ROUND_SECS, type Difficulty } from "../../sim/rules.ts";
import type { Settings } from "../settings.ts";
import { ControlHint } from "./Help.tsx";
import { OptionsDialog } from "./Options.tsx";

/** A row of toggle buttons; screen readers hear it as a named group of pressed/unpressed buttons. */
export function Seg<T extends string | number | boolean>({ value, options, onChange, label, labelledBy, name }: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: (v: T) => string; labelledBy?: string; name?: string }) {
  return (
    <span className="seg" role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : name}>
      {options.map((o) => <button key={String(o)} type="button" className={o === value ? "on" : ""} aria-pressed={o === value} onClick={() => onChange(o)}>{label ? label(o) : String(o)}</button>)}
    </span>
  );
}

export interface MenuProps {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onSolo: () => void;
  onCouch: () => void;
  extra?: React.ReactNode;
}

export function Menu({ settings, onSettings, onSolo, onCouch, extra }: MenuProps) {
  const [options, setOptions] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <div className="menu">
      <main className="card" aria-labelledby="menu-title">
        <h1 className="title" id="menu-title">HIPPO TYCOON</h1>
        <p className="tag">Four angry oil barons. One geyser. Eat the money.</p>
        <div className="col">
          <button className="btn go" onClick={onSolo} autoFocus>Solo (vs 3 bots)</button>
          <button className="btn" onClick={onCouch}>Couch (2–4 on one screen)</button>
          {extra}
          <div className="row"><label htmlFor="menu-name">Your name</label><input id="menu-name" className="text" style={{ width: 200 }} maxLength={32} value={settings.name} placeholder="Tycoon" onChange={(e) => onSettings({ ...settings, name: e.target.value })} /></div>
          <div className="row"><label id="menu-bots">Bots</label><Seg<Difficulty> labelledBy="menu-bots" value={settings.difficulty} options={DIFFICULTIES} onChange={(difficulty) => onSettings({ ...settings, difficulty })} /></div>
          <div className="row"><label id="menu-round">Round</label><Seg<number> labelledBy="menu-round" value={settings.secs} options={ROUND_SECS} label={(s) => `${s}s`} onChange={(secs) => onSettings({ ...settings, secs })} /></div>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={() => setOptions(true)}>Options</button>
            <button className="btn" style={{ flex: 1 }} aria-expanded={help} onClick={() => setHelp((h) => !h)}>{help ? "Hide controls" : "How to play"}</button>
          </div>
        </div>
        {help && <div style={{ marginTop: 14 }}><ControlHint seats={[{ name: "You", ctls: ["kbAll", "touch"] }]} /></div>}
        {!help && <p className="hint">A / D slide · W or Space chomp · Q bellow &nbsp;|&nbsp; ← / → · ↑ or Enter · / &nbsp;|&nbsp; gamepad: stick, A, B</p>}
      </main>
      {options && <OptionsDialog settings={settings} onSettings={onSettings} onClose={() => setOptions(false)} />}
    </div>
  );
}
