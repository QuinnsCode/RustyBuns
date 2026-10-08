// Desktop entry. StrictMode is omitted on purpose: its double-mount opens two
// world sockets, two WebGL contexts and two AudioContexts in a shipped binary.
import { createRoot } from "react-dom/client";
import { App } from "../../src/client/App.tsx";
import "../../src/client/style.css";

createRoot(document.getElementById("root")!).render(<App />);
