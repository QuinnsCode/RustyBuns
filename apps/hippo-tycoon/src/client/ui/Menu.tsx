import { useState } from "react";
import type { Settings } from "../settings.ts";
import { About, ControlHint } from "./Help.tsx";
import { Account } from "./Account.tsx";
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
  /** Why a sign-in did not go through. */
  note?: string;
}

export function Menu({ settings, onSettings, onSolo, onCouch, extra, note }: MenuProps) {
  const [options, setOptions] = useState(false);
  return (
    <div className="menu">
      <main className="card" aria-labelledby="menu-title">
        <h1 className="title" id="menu-title">HIPPO TYCOON</h1>
        <About id="menu-about">
          <p className="tag">Four angry oil barons. One geyser. Eat the money.</p>
          <ControlHint seats={[{ name: "You", ctls: ["kbAll", "touch", "pad0"] }]} />
        </About>
        <div className="col">
          {/* The ways to play and nothing else: name, bots, players and round length wait under Options, as last picked. */}
          <button className="btn go big" onClick={onSolo} autoFocus>Solo<small>You against 3 bots</small></button>
          <button className="btn" onClick={onCouch}>Couch<small>2 to 4 players on one screen</small></button>
          {extra}
          <Account note={note} />
          <button className="btn quiet" onClick={() => setOptions(true)}>Options</button>
        </div>
      </main>
      {options && <OptionsDialog game settings={settings} onSettings={onSettings} onClose={() => setOptions(false)} />}
    </div>
  );
}
