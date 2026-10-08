import { useMemo, useState } from "react";
import { LocalDriver, type Driver } from "./driver.ts";
import type { Ctl } from "./input.ts";
import { loadSettings, nameOf, saveSettings, type Settings } from "./settings.ts";
import { Game } from "./ui/Game.tsx";
import { Menu } from "./ui/Menu.tsx";
import { Setup } from "./ui/Setup.tsx";

type Screen =
  | { t: "menu" }
  | { t: "couch" }
  | { t: "play"; driver: Driver; ctls: Ctl[][] };

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>({ t: "menu" });
  const update = (s: Settings) => { setSettings(s); saveSettings(s); };
  const cfg = useMemo(() => ({ secs: settings.secs, difficulty: settings.difficulty }), [settings.secs, settings.difficulty]);

  const playLocal = (ctls: Ctl[][]) => {
    const seats = ctls.map((c, i) => ({ human: c.length > 0, name: i === ctls.findIndex((x) => x.length) ? nameOf(settings) : `Player ${i + 1}` }));
    setScreen({ t: "play", driver: new LocalDriver(seats, cfg, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0), ctls });
  };
  const exit = () => {
    if (screen.t === "play") screen.driver.dispose();
    setScreen({ t: "menu" });
  };

  if (screen.t === "play") {
    return <Game driver={screen.driver} ctls={screen.ctls} muted={settings.muted} onMute={(muted) => update({ ...settings, muted })} onExit={exit} />;
  }
  if (screen.t === "couch") {
    return <Setup onBack={() => setScreen({ t: "menu" })} onStart={(seats) => playLocal(seats.map((c) => (c === "bot" ? [] : [c])))} />;
  }
  return <Menu settings={settings} onSettings={update} onSolo={() => playLocal([["kbAll", "touch"], [], [], []])} onCouch={() => setScreen({ t: "couch" })} />;
}
