// The talks' slide keys. Right, Space or Page Down: next slide. Left or Page Up: back. Home and End.
// N: speaker notes on or off. The address keeps the slide number (#4), so a link opens on that slide.
(() => {
  const slides = [...document.querySelectorAll(".slide")];
  if (!slides.length) return;

  const bar = document.createElement("nav");
  bar.className = "deckbar";
  bar.setAttribute("aria-label", "Slides");
  bar.innerHTML =
    '<a href="index.html">All talks</a><div class="track"><div class="fill"></div></div>' +
    '<span class="count" aria-live="polite"></span><span class="hint">arrows to move</span>' +
    '<button type="button" aria-pressed="false">Notes</button>';
  document.body.append(bar);
  const fill = bar.querySelector(".fill");
  const count = bar.querySelector(".count");
  const notesButton = bar.querySelector("button");

  let at = 0;
  const show = (i) => {
    at = Math.max(0, Math.min(slides.length - 1, i));
    fill.style.width = `${((at + 1) / slides.length) * 100}%`;
    count.textContent = `${at + 1} / ${slides.length}`;
  };
  const go = (i) => {
    show(i);
    slides[at].scrollIntoView();
    history.replaceState(null, "", `#${at + 1}`);
  };

  // Follow the reader's own scrolling too, not just the keys.
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) show(slides.indexOf(e.target));
    },
    { threshold: 0.55 },
  );
  for (const s of slides) seen.observe(s);

  const setNotes = (on) => {
    document.body.classList.toggle("show-notes", on);
    notesButton.setAttribute("aria-pressed", String(on));
    try { localStorage.setItem("talks:notes", on ? "1" : ""); } catch {}
  };
  notesButton.addEventListener("click", () => setNotes(!document.body.classList.contains("show-notes")));
  try { if (localStorage.getItem("talks:notes")) setNotes(true); } catch {}

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, button")) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " ") go(at + 1);
    else if (k === "ArrowLeft" || k === "PageUp") go(at - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(slides.length - 1);
    else if (k === "n" || k === "N") setNotes(!document.body.classList.contains("show-notes"));
    else return;
    e.preventDefault();
  });

  const start = Number(location.hash.slice(1)) - 1;
  if (start > 0) go(start);
  else show(0);
})();
