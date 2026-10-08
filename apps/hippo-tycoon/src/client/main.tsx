// Browser entry. StrictMode is off on purpose: its double-mount would open two
// WebGL contexts, two AudioContexts and, online, two sockets.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App />);
