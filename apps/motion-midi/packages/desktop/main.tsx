// Desktop entry. Mounts below the RSC boundary; the host vouches identity at /ws.
// StrictMode omitted on purpose: its double-mount opens two sockets in a shipped binary.
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { App } from "../../src/ui/App.tsx";

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}><App netPath="/ws" /></Suspense>,
);
