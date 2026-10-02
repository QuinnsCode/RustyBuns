import { useEffect, useState } from "react";
import { listScenes, type SceneSummary } from "../actions/scenes.ts";
import { loadRecords, type Records } from "../game/score.ts";
import { Browser } from "./Browser.tsx";
import { Game } from "./Game.tsx";
import { HowTo, Menu, RoomSelect } from "./Menu.tsx";
import "./app.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";

type Screen = { to: "menu" } | { to: "rooms" } | { to: "howto" } | { to: "browse" } | { to: "play"; sceneId: string };

export const randomPlayable = (scenes: SceneSummary[], not?: string) => {
  const pool = scenes.filter((s) => s.hasSplats && s.id !== not);
  const any = pool.length ? pool : scenes.filter((s) => s.hasSplats);
  return any[Math.floor(Math.random() * any.length)]?.id ?? null;
};

export function App(_: { netPath?: string }) {
  const [scenes, setScenes] = useState<SceneSummary[] | null>(null);
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<Records>(loadRecords);
  const [screen, setScreen] = useState<Screen>({ to: "menu" });

  // Re-read the folder whenever the menu comes back up, so scenes downloaded
  // mid-session appear without a restart.
  useEffect(() => {
    if (screen.to !== "menu" && scenes) return;
    listScenes().then((r) => { setScenes(r.scenes); setDir(r.dir); setError(r.error ?? null); }, (e) => setError(String(e.message ?? e)));
  }, [screen.to]);

  const menu = () => setScreen({ to: "menu" });
  const play = (sceneId: string | null) => sceneId && setScreen({ to: "play", sceneId });

  switch (screen.to) {
    case "rooms": return <RoomSelect scenes={scenes ?? []} records={records} onPick={play} onBack={menu} />;
    case "howto": return <HowTo onBack={menu} />;
    case "browse": return <Browser scenes={scenes ?? []} dir={dir} onBack={menu} />;
    case "play":
      return (
        <Game
          key={screen.sceneId}
          sceneId={screen.sceneId}
          records={records}
          onRecords={setRecords}
          onAnotherRoom={() => play(randomPlayable(scenes ?? [], screen.sceneId))}
          onRooms={() => setScreen({ to: "rooms" })}
          onQuit={menu}
        />
      );
    default:
      return (
        <Menu scenes={scenes} dir={dir} error={error} records={records}
          onQuick={() => play(randomPlayable(scenes ?? []))}
          onRooms={() => setScreen({ to: "rooms" })}
          onBrowse={() => setScreen({ to: "browse" })}
          onHowTo={() => setScreen({ to: "howto" })} />
      );
  }
}
