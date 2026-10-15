import { greeting } from "./greeting.ts";

// A mini app made to be edited: agents rewrite these lines live in the codeSplitter welcome tour.
let waves = 0;
const title = document.getElementById("greeting")!;
const count = document.getElementById("clicks")!;

title.textContent = greeting("world");
count.textContent = "No waves yet.";

document.getElementById("wave")!.addEventListener("click", () => {
  waves++;
  count.textContent = `${waves} wave${waves === 1 ? "" : "s"}.`;
});
