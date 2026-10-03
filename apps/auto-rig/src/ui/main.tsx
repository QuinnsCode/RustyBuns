// StrictMode omitted on purpose: its double mount would build two WebGL stages.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app.css";

createRoot(document.getElementById("root")!).render(<App />);
