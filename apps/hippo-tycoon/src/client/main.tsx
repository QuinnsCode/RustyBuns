// Browser entry. StrictMode is off on purpose: its double-mount would open two
// WebGL contexts, two AudioContexts and, online, two sockets.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
// The dev preview page (finale, poses, geyser, turntable). import.meta.env.DEV is a
// constant, so a production build drops this branch and never emits the preview's chunk.
if (import.meta.env.DEV && (location.pathname.replace(/\/$/, "").endsWith("/preview") || new URLSearchParams(location.search).has("preview"))) {
  void import("./preview/Preview.tsx").then(({ Preview }) => root.render(<Preview />));
} else root.render(<App />);
