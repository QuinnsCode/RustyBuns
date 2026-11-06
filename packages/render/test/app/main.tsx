// The app's entry, as it would be in index.html's script tag.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
