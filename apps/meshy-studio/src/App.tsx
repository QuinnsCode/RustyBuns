import { useEffect, useState } from "react";
import { api, type Status } from "./api.ts";
import { Setup } from "./Setup.tsx";
import { Studio } from "./Studio.tsx";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => api.status().then(setStatus, (e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  if (error) return <p className="fatal">The desktop host isn't answering: {error}. Start the app with <code>bun run desktop:dev</code>.</p>;
  if (!status) return null;
  return status.hasKey && status.workspace
    ? <Studio status={status} onLeave={() => api.close().then(refresh)} onStatus={refresh} />
    : <Setup status={status} onDone={refresh} />;
}
