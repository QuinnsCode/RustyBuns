import type { Driver, Frame } from "../driver.ts";
import { DIFFICULTIES, ROUND_SECS, SEAT_NAMES, type Difficulty } from "../../sim/rules.ts";
import { Seg } from "./Menu.tsx";

/** The lobby over the 3D pan: seats, ready, the host's settings, and where friends join. */
export function NetLobby({ frame, driver, info, onExit }: { frame: Frame; driver: Driver; info?: React.ReactNode; onExit: () => void }) {
  const net = frame.net;
  const you = frame.mine[0] ?? -1;
  const host = you >= 0 && you === frame.hostSeat;
  const status = net?.state ?? "online";
  if (status !== "online" || you < 0) {
    return (
      <div className="podium"><div className="card" style={{ textAlign: "center" }}>
        <h1 className="title" style={{ fontSize: 30 }}>{status === "refused" ? "CAN'T JOIN" : status === "connecting" ? "CONNECTING" : "CONNECTION LOST"}</h1>
        <p className="tag">{net?.message ?? (status === "online" ? "Taking a seat…" : status === "connecting" ? "Knocking on the door…" : "Trying again…")}</p>
        <button className="btn" onClick={onExit}>Back</button>
      </div></div>
    );
  }
  if (frame.phase !== "lobby") return null;
  return (
    <div className="lobby"><div className="card" style={{ width: "100%" }}>
      {net?.code && (
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div className="code">{net.code}</div>
          <div className="hint" style={{ margin: 0 }}>Room code: friends pick "Online room" and type it in</div>
        </div>
      )}
      {info}
      <div className="seats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {frame.seats.map((s, i) => (
          <div key={i} className={"seat" + (s.mine ? " mine" : "")}>
            <b>{s.human ? s.name : SEAT_NAMES[i]}</b>
            <span className="who">{s.human ? (i === frame.hostSeat ? "Host" : "Player") : "Bot"}{s.human && s.ready ? " · " : ""}{s.human && s.ready && <span className="ready">ready</span>}</span>
            {!s.human && <button className="btn" style={{ padding: "5px 8px", fontSize: 13 }} onClick={() => driver.command({ t: "seat", seat: i })}>Sit here</button>}
          </div>
        ))}
      </div>
      <div className="col" style={{ marginTop: 14 }}>
        {host && <>
          <div className="row"><label>Bots</label><Seg<Difficulty> value={frame.cfg.difficulty} options={DIFFICULTIES} onChange={(difficulty) => driver.command({ t: "cfg", cfg: { difficulty } })} /></div>
          <div className="row"><label>Round</label><Seg<number> value={frame.cfg.secs} options={ROUND_SECS} label={(s) => `${s}s`} onChange={(secs) => driver.command({ t: "cfg", cfg: { secs } })} /></div>
        </>}
        <div className="row">
          <button className="btn" style={{ flex: 1 }} onClick={() => driver.input(you, 0, false, true)}>{frame.seats[you]?.ready ? "Not ready" : "Ready (or bellow: Q)"}</button>
          {host ? <button className="btn go" style={{ flex: 1 }} onClick={() => driver.command({ t: "start" })}>Start round</button> : <span className="hint" style={{ flex: 1, margin: 0 }}>The host starts the round.</span>}
          <button className="btn" onClick={onExit}>Leave</button>
        </div>
        {net?.ping !== undefined && <p className="hint" style={{ margin: 0 }}>ping {net.ping} ms</p>}
      </div>
    </div></div>
  );
}
