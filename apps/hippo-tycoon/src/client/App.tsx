import { useEffect, useMemo, useState } from "react";
import { LocalDriver, type Driver } from "./driver.ts";
import type { Ctl } from "./input.ts";
import { closeLan, hostInfo, lanSocket, makeJoinCode, onlineSocket, openLan, ownWorldSocket, type HostInfo } from "./lan.ts";
import { NetDriver } from "./netDriver.ts";
import { loadSettings, nameOf, saveSettings, type Settings } from "./settings.ts";
import { Game } from "./ui/Game.tsx";
import { JoinLan, JoinOnline } from "./ui/Join.tsx";
import { Menu } from "./ui/Menu.tsx";
import { NetLobby } from "./ui/NetLobby.tsx";
import { Setup } from "./ui/Setup.tsx";
import type { Difficulty } from "../sim/rules.ts";

type Screen =
  | { t: "menu"; error?: string }
  | { t: "couch" } | { t: "joinLan" } | { t: "joinOnline" }
  | { t: "play"; driver: Driver; ctls: Ctl[][]; lan?: { code: string; info: HostInfo } };

const SOLO_CTL: Ctl[][] = [["kbAll", "touch"], [], [], []];
/** Two players on one machine in a net game: by local player, not by seat (the room picks seats). */
const NET_PAIR_CTL: Ctl[][] = [["kb1", "pad0"], ["kb2", "pad1"]];

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>({ t: "menu" });
  const [desktop, setDesktop] = useState<HostInfo | null>(null);
  useEffect(() => { void hostInfo().then(setDesktop); }, []);
  const update = (s: Settings) => { setSettings(s); saveSettings(s); };
  const cfg = useMemo(() => ({ secs: settings.secs, difficulty: settings.difficulty }), [settings.secs, settings.difficulty]);
  const name = nameOf(settings);

  const playLocal = (ctls: Ctl[][], bots?: Difficulty[]) => {
    const first = ctls.findIndex((x) => x.length);
    const seats = ctls.map((c, i) => ({ human: c.length > 0, name: i === first ? name : `Player ${i + 1}` }));
    setScreen({ t: "play", driver: new LocalDriver(seats, bots ? { ...cfg, bots } : cfg, (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0), ctls });
  };
  const playNet = (open: () => WebSocket, lan?: { code: string; info: HostInfo }) =>
    setScreen({ t: "play", driver: new NetDriver(open, settings.players), ctls: settings.players > 1 ? NET_PAIR_CTL : SOLO_CTL, lan });

  const exit = () => {
    if (screen.t === "play") { screen.driver.dispose(); if (screen.lan) void closeLan(); }
    setScreen({ t: "menu" });
  };

  const hostLan = async () => {
    try {
      const code = makeJoinCode();
      const info = await openLan(code);
      playNet(() => ownWorldSocket(name), { code, info });
    } catch (e) { setScreen({ t: "menu", error: String((e as Error).message ?? e) }); }
  };

  if (screen.t === "play") {
    const lan = screen.lan;
    const info = lan && (
      <div style={{ marginBottom: 12, textAlign: "center" }}>
        <div className="hint" style={{ margin: "0 0 6px" }}>Friends: Join LAN game, then enter</div>
        <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{(lan.info.lan?.length ? lan.info.lan : ["<this machine's IP>"]).map((ip) => `${ip}:${lan.info.listen.port}`).join("   ")}</div>
        <div className="hint" style={{ margin: "6px 0 0" }}>join code <b className="mono" style={{ color: "var(--gold)", fontSize: 16 }}>{lan.code}</b></div>
      </div>
    );
    return <Game driver={screen.driver} ctls={screen.ctls} muted={settings.muted} onMute={(muted) => update({ ...settings, muted })} onExit={exit}
      lobby={screen.driver.kind === "net" ? (frame) => <NetLobby frame={frame} driver={screen.driver} info={info} onExit={exit} /> : undefined} />;
  }
  if (screen.t === "couch") return <Setup difficulty={settings.difficulty} onBack={() => setScreen({ t: "menu" })} onStart={(seats, bots) => playLocal(seats.map((c) => (c === "bot" ? [] : [c])), bots)} />;
  if (screen.t === "joinLan") return <JoinLan onBack={() => setScreen({ t: "menu" })} onJoin={(address, code) => playNet(() => lanSocket(address, code, name))} />;
  if (screen.t === "joinOnline") return <JoinOnline onBack={() => setScreen({ t: "menu" })} onJoin={(room) => playNet(() => onlineSocket(room, name))} />;

  const canJoinLan = desktop !== null || location.protocol === "http:";
  return (
    <Menu settings={settings} onSettings={update} onSolo={() => playLocal(SOLO_CTL)} onCouch={() => setScreen({ t: "couch" })}
      extra={<>
        {desktop && <button className="btn" onClick={hostLan}>Host a LAN game</button>}
        {canJoinLan && <button className="btn" onClick={() => setScreen({ t: "joinLan" })}>Join a LAN game</button>}
        {!desktop && <button className="btn" onClick={() => setScreen({ t: "joinOnline" })}>Online room</button>}
        {screen.error && <p className="err">{screen.error}</p>}
      </>} />
  );
}
