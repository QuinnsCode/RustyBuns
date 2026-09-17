// The intro page: what a fresh `rustybuns add desktop` shows before an app is
// pointed at. Proves the host, the world socket, and the runtime info.
import { useEffect, useState } from "react";
import { worldSocket } from "./client.ts";

export function Intro() {
  const [info, setInfo] = useState<any>(null);
  const [msgs, setMsgs] = useState<string[]>([]);
  useEffect(() => {
    fetch("/__rb/info").then((r) => r.json()).then(setInfo).catch(() => {});
    const ws = worldSocket("/ws");
    ws.onmessage = (m) => setMsgs((s) => [...s, String(m.data)]);
    ws.onopen = () => ws.send("hello from the tab");
    return () => ws.close();
  }, []);
  const row = (k: string, v: unknown) => <tr key={k}><td style={{ opacity: .6, paddingRight: 16 }}>{k}</td><td>{String(v)}</td></tr>;
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", color: "#e8efe9", padding: 32, maxWidth: 720 }}>
      <h1 style={{ fontWeight: 500 }}>🥐 Rusty Buns</h1>
      <p>Your host is up. This page is served from the binary; the socket below is your world.</p>
      <table>{info ? Object.entries(info).map(([k, v]) => row(k, v)) : row("info", "loading…")}</table>
      <h3>world socket</h3>
      <pre style={{ background: "#121815", padding: 12 }}>{msgs.join("\n") || "connecting…"}</pre>
      <p style={{ opacity: .6 }}>Point <code>packages/desktop/main.tsx</code> at your own component to replace this.</p>
    </main>
  );
}
