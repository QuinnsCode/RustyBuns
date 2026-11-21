// Options: motion, the film look, quality, and the three sound switches. Saved
// locally with the other settings (see settings.ts).
import { useEffect, useRef } from "react";
import { DIFFICULTIES, ROUND_SECS, type Difficulty } from "../../sim/rules.ts";
import { QUALITIES, systemPrefersReducedMotion, type Quality, type Settings } from "../settings.ts";
import { Seg } from "./Menu.tsx";

type Motion = "system" | "on" | "off";
const onOff = (v: boolean) => (v ? "On" : "Off");
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function OptionsPanel({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const set = (p: Partial<Settings>) => onSettings({ ...settings, ...p });
  const motion: Motion = settings.reducedMotion === null ? "system" : settings.reducedMotion ? "on" : "off";
  const row = (id: string, label: string, control: React.ReactNode, note?: string) => (
    <div className="opt">
      <div className="row"><label id={id}>{label}</label>{control}</div>
      {note && <p className="note">{note}</p>}
    </div>
  );
  return (
    <div className="col options">
      {row("o-motion", "Reduced motion",
        <Seg<Motion> labelledBy="o-motion" value={motion} options={["system", "on", "off"]} label={cap} onChange={(m) => set({ reducedMotion: m === "system" ? null : m === "on" })} />,
        `No screen shake, camera sway, fly-in, flailing or bouncing text. System follows your device (${systemPrefersReducedMotion() ? "reduced" : "full motion"} now).`)}
      {row("o-film", "Film look",
        <Seg<boolean> labelledBy="o-film" value={settings.filmLook} options={[true, false]} label={onOff} onChange={(filmLook) => set({ filmLook })} />,
        "Colour fringe, grain, scanline and vignette.")}
      {row("o-quality", "Quality",
        <Seg<Quality> labelledBy="o-quality" value={settings.quality} options={QUALITIES} label={cap} onChange={(quality) => set({ quality })} />,
        "Lower drops shadows and bloom, thins the jungle and the geyser's spray.")}
      {row("o-sound", "Sound", <Seg<boolean> labelledBy="o-sound" value={!settings.muted} options={[true, false]} label={onOff} onChange={(on) => set({ muted: !on })} />)}
      {row("o-music", "Music", <Seg<boolean> labelledBy="o-music" value={settings.music} options={[true, false]} label={onOff} onChange={(music) => set({ music })} />)}
      {row("o-fx", "Effects", <Seg<boolean> labelledBy="o-fx" value={settings.effects} options={[true, false]} label={onOff} onChange={(effects) => set({ effects })} />, "Chomps, bellows, the finale and the jungle.")}
    </div>
  );
}

/** The next game's own picks, under Options on the menu: your name, the bots, players on this device and round length. */
export function GamePanel({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const set = (p: Partial<Settings>) => onSettings({ ...settings, ...p });
  return (
    <div className="col options">
      <div className="row"><label htmlFor="o-name">Your name</label><input id="o-name" className="text" style={{ width: 200 }} maxLength={32} value={settings.name} placeholder="Tycoon" onChange={(e) => set({ name: e.target.value })} /></div>
      <div className="row"><label id="o-bots">Bots</label><Seg<Difficulty> labelledBy="o-bots" value={settings.difficulty} options={DIFFICULTIES} onChange={(difficulty) => set({ difficulty })} /></div>
      <div className="opt">
        <div className="row"><label id="o-players">On this device</label><Seg<1 | 2> labelledBy="o-players" value={settings.players} options={[1, 2]} label={(n) => (n === 1 ? "1 player" : "2 players")} onChange={(players) => set({ players })} /></div>
        <p className="note">For a home-network or online game.</p>
      </div>
      <div className="row"><label id="o-round">Round length</label><Seg<number> labelledBy="o-round" value={settings.secs} options={ROUND_SECS} label={(s) => `${s}s`} onChange={(secs) => set({ secs })} /></div>
    </div>
  );
}

/** The options as a dialog (with the next game's picks first when opened from the menu): focus moves in, Tab stays in, Escape closes, focus goes back. */
export function OptionsDialog({ settings, onSettings, onClose, game }: { settings: Settings; onSettings: (s: Settings) => void; onClose: () => void; game?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const all = [...box.current.querySelectorAll<HTMLElement>("button, input, select")].filter((el) => !el.hasAttribute("disabled"));
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); back?.focus?.(); };
  }, []);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="options-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" ref={box}>
        <h2 id="options-title" className="title" style={{ fontSize: 28, marginBottom: 18 }}>Options</h2>
        {game && <><GamePanel settings={settings} onSettings={onSettings} /><hr className="split" /></>}
        <OptionsPanel settings={settings} onSettings={onSettings} />
        <button className="btn go" style={{ width: "100%", marginTop: 18 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
