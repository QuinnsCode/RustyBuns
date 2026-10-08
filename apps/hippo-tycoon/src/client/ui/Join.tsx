import { useState } from "react";
import { lanUrl, makeRoomCode } from "../lan.ts";

export function JoinLan({ onJoin, onBack }: { onJoin: (address: string, code: string) => void; onBack: () => void }) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const ok = lanUrl(address) !== null && code.trim().length > 0;
  return (
    <div className="menu"><div className="card">
      <h1 className="title" style={{ fontSize: 34 }}>JOIN LAN GAME</h1>
      <p className="tag">Ask the host for the address and join code on their screen.</p>
      <div className="col">
        <input className="text mono" placeholder="192.168.1.20:4000" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus />
        <input className="text mono" placeholder="join code, like crude-kettle" value={code} onChange={(e) => setCode(e.target.value)} />
        {address && lanUrl(address) === null && <p className="err">Include the port, like 192.168.1.20:4000.</p>}
        <button className="btn go" disabled={!ok} onClick={() => onJoin(address, code.trim())}>Join</button>
        <button className="btn" onClick={onBack}>Back</button>
      </div>
      <p className="hint">Same Wi-Fi or wired network. No TLS: this is for a network you trust. Browser pages must be served over http (the dev server or a desktop build), not https.</p>
    </div></div>
  );
}

export function JoinOnline({ onJoin, onBack }: { onJoin: (room: string) => void; onBack: () => void }) {
  const [room, setRoom] = useState("");
  const clean = room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return (
    <div className="menu"><div className="card">
      <h1 className="title" style={{ fontSize: 34 }}>ONLINE ROOM</h1>
      <p className="tag">Share the room code. Empty seats get bots.</p>
      <div className="col">
        <input className="text mono" placeholder="ROOM CODE" value={clean} onChange={(e) => setRoom(e.target.value)} autoFocus maxLength={8} />
        <button className="btn go" disabled={clean.length < 3} onClick={() => onJoin(clean)}>Join room</button>
        <button className="btn" onClick={() => onJoin(makeRoomCode())}>Make a new room</button>
        <button className="btn" onClick={onBack}>Back</button>
      </div>
    </div></div>
  );
}
