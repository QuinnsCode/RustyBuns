// Desktop entry. StrictMode omitted on purpose: its double-mount opens two
// world sockets and two AudioContexts in a shipped binary.
import { createRoot } from "react-dom/client";
import { App } from "../../src/ui/App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
