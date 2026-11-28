import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { addCommands, buttonCommand } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { App } from "./App.tsx";
import "./app.css";

addCommands([buttonCommand('[data-cmd="summarize"]', { name: "py_summarize", title: "Summarize in Python", description: "Send the numbers in the box to Python and show the summary.", group: "Python" })]);
mountPalette({ button: true });
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
