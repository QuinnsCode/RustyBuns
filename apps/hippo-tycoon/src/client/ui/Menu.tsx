import { DIFFICULTIES, ROUND_SECS, type Difficulty } from "../../sim/rules.ts";
import type { Settings } from "../settings.ts";

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <span className="seg">
      {options.map((o) => <button key={String(o)} className={o === value ? "on" : ""} onClick={() => onChange(o)}>{label ? label(o) : String(o)}</button>)}
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
  return (
    <div className="menu">
      <div className="card">
        <h1 className="title">HIPPO TYCOON</h1>
        <p className="tag">Four angry oil barons. One pan. Eat the money.</p>
        <div className="col">
          <button className="btn go" onClick={onSolo}>Solo (vs 3 bots)</button>
          <button className="btn" onClick={onCouch}>Couch (2–4 on one screen)</button>
          {extra}
          <div className="row"><label>Your name</label><input className="text" style={{ width: 200 }} maxLength={32} value={settings.name} placeholder="Tycoon" onChange={(e) => onSettings({ ...settings, name: e.target.value })} /></div>
          <div className="row"><label>Bots</label><Seg<Difficulty> value={settings.difficulty} options={DIFFICULTIES} onChange={(difficulty) => onSettings({ ...settings, difficulty })} /></div>
          <div className="row"><label>Here (LAN/online)</label><Seg<1 | 2> value={settings.players} options={[1, 2]} label={(n) => (n === 1 ? "1 player" : "2 players")} onChange={(players) => onSettings({ ...settings, players })} /></div>
          <div className="row"><label>Round</label><Seg<number> value={settings.secs} options={ROUND_SECS} label={(s) => `${s}s`} onChange={(secs) => onSettings({ ...settings, secs })} /></div>
        </div>
        <p className="hint">A / D slide · W or Space chomp · Q bellow &nbsp;|&nbsp; ← / → · ↑ or Enter · / &nbsp;|&nbsp; gamepad: stick, A, B</p>
      </div>
    </div>
  );
}
