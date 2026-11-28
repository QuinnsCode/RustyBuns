// Door mode's camera (app/events.tsx): where the browser can read QR codes itself, scan ticket after ticket without leaving the
// page. Elsewhere the phone's camera app opens each ticket's link, and this adds nothing.
import { Scanned } from "@rustybuns/util/events";
import { check } from "@rustybuns/util/guard";

declare class BarcodeDetector { constructor(o: { formats: string[] }); detect(from: HTMLVideoElement): Promise<{ rawValue: string }[]> }

/** How long a code must be out of sight before it counts as shown again: a ticket held up stays one scan. */
const AGAIN_MS = 3000;

export function mountDoor(box: HTMLElement) {
  const path = box.dataset.scan;
  if (!path || !("BarcodeDetector" in globalThis) || !navigator.mediaDevices) return;
  const button = Object.assign(document.createElement("button"), { type: "button", className: "ui-btn", textContent: "Scan with this camera" });
  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, hidden: true });
  video.style.cssText = "width:100%;max-width:24rem;border-radius:10px";
  box.append(button, video);
  const say = (words: string, ok: boolean) => {
    const el = document.getElementById("door-said");
    if (el) { el.textContent = words; el.className = ok ? "" : "bad"; }
  };
  button.addEventListener("click", () => void (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).catch(() => null);
    if (!stream) return say("The camera didn't open.", false);
    button.hidden = true;
    video.hidden = false;
    video.srcObject = stream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    let last = "", seen = 0;
    const tick = async () => {
      const code = (await detector.detect(video).catch(() => []))[0]?.rawValue;
      if (code) {
        const held = code === last && Date.now() - seen < AGAIN_MS;
        last = code;
        seen = Date.now();
        if (!held) {
          const r = await fetch(path, { method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams({ ticket: code }) }).catch(() => null);
          const answer = r?.ok ? check(Scanned, await r.json().catch(() => null)) : null;
          // Not answered: forget it, so holding it up again asks again.
          if (!answer) { last = ""; say("Couldn't check that ticket. Try again.", false); }
          else {
            say(answer.words, answer.ok);
            const count = document.getElementById("door-in");
            if (count) count.textContent = String(answer.in);
            navigator.vibrate?.(answer.ok ? 80 : [200, 80, 200]);
          }
        }
      }
      setTimeout(() => void tick(), 300);
    };
    void tick();
  })());
}
