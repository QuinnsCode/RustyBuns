import { useEffect, useState } from "react";
import { api, type Status } from "./api.ts";
import { Welcome } from "./Welcome.tsx";
import { Workspace } from "./Workspace.tsx";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => api.status().then(setStatus, (e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  if (error) return <div className="fatal">The desktop host isn't answering: {error}. Start the app with <code>rustybuns run desktop</code>.</div>;
  if (!status) return null;
  return status.project
    ? <Workspace status={status} onClose={() => setStatus({ ...status, project: null })} />
    : <Welcome status={status} onOpened={refresh} />;
}
