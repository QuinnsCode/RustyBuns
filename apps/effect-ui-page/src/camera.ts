// The frame's camera: what runs beside world.ts's reporter, first in the sealed frame. The page asks it for a picture
// of the world (`{ agent_page: true, ask: "picture" }`) or a few seconds of frames for a GIF (`ask: "frames"`), and it
// answers with JPEG data: URLs of the world's largest <canvas>. Nothing leaves the frame but those, and only to the
// page that holds it. A pure string (no DOM here), like the reporter.

/** The script, saying what it takes under `key` (world.ts's SAID_KEY). */
export const camera = (key: string) => `(() => {
  // Kept before the world's code runs, so a world that replaces it can't stop its own picture.
  const next = requestAnimationFrame.bind(window);
  const post = (kind, data) => { try { parent.postMessage({ ${key}: true, kind, data }, "*"); } catch {} };
  const largest = () => [...document.querySelectorAll("canvas")].filter((c) => c.width && c.height).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  // The canvas drawn down to fit w by h, as a JPEG: over the page's own background, which a clear canvas shows through.
  const shot = (c, w, h, quality) => {
    const scale = Math.min(1, w / c.width, h / c.height);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(c.width * scale));
    out.height = Math.max(1, Math.round(c.height * scale));
    const x = out.getContext("2d");
    for (const paint of ["#000", document.body ? getComputedStyle(document.body).backgroundColor : "#000"]) { x.fillStyle = paint; x.fillRect(0, 0, out.width, out.height); }
    x.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", quality);
  };
  // Every shot is taken inside an animation frame, after the world's own draw, while a WebGL canvas still holds it.
  const picture = () => next(() => {
    const c = largest();
    if (!c) return;
    let data = "";
    // 80,000 characters of base64 is 60 KB of picture.
    for (const quality of [0.82, 0.65, 0.5, 0.35, 0.2]) { data = shot(c, 640, 360, quality); if (data.length <= 80000) break; }
    post("picture", data);
  });
  const frames = (seconds, fps) => {
    let sent = 0, from;
    const tick = (now) => {
      const c = largest();
      if (!c) return post("frames-done");
      from ??= now;
      // 4 ms early still counts, so a 60 Hz screen keeps an even 10 a second.
      if (now - from >= (sent * 1000) / fps - 4) { post("frame", shot(c, 320, 640, 0.8)); sent++; }
      if (sent < seconds * fps && now - from < seconds * 1000) next(tick); else post("frames-done");
    };
    next(tick);
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.agent_page !== true) return;
    if (m.ask === "picture") picture();
    else if (m.ask === "frames") frames(Math.min(10, Number(m.seconds) || 3), Math.min(20, Number(m.fps) || 10));
  });
})();`;
