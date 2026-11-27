// The page's side of the frame's camera (camera.ts). A little after each load of the world that reported no errors, it
// asks for a picture and keeps it on the room (share.ts), where link previews find it. And Export GIF: it asks for a
// few seconds of frames, encodes them (gif.ts) and hands the person the file. One `exportGif` for the dock's button
// and Cmd+K alike; `watchGif` is how the button says how far along it is.
import { unb64url } from "@rustybuns/util/bytes";
import { check, field, obj, opt, str } from "@rustybuns/util/guard";
import { encodeGif } from "./gif.ts";
import { SAID_KEY } from "./world.ts";

const SECONDS = 3, FPS = 10;
/** After a load, this long for the world to have drawn something. */
const DRAWN_MS = 1500;
/** No frame for this long means the world isn't going to answer. */
const QUIET_MS = 8000;

/** What the frame's camera sends: a JPEG data: URL (`frames-done` has none). Anything else is dropped. */
const Shot = obj({ kind: str(16), data: opt(str(200_000, { re: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/ })) });

const worldFrame = (): HTMLIFrameElement | null => {
  const f = document.querySelector("iframe.world");
  return f instanceof HTMLIFrameElement ? f : null;
};
const fromWorld = (e: MessageEvent) => {
  const f = worldFrame();
  return f !== null && e.source === f.contentWindow && field(e.data, SAID_KEY) === true;
};
const ask = (message: object) => worldFrame()?.contentWindow?.postMessage({ agent_page: true, ...message }, "*");

/** Keep this room's picture up to date, for as long as the page is open. */
export function startPictures(room: string) {
  let failed = false, due: ReturnType<typeof setTimeout> | undefined;
  addEventListener("message", (e) => {
    if (!fromWorld(e)) return;
    if (field(e.data, "kind") === "start") failed = false;
    else if (field(e.data, "kind") === "error") failed = true;
    const shot = check(Shot, e.data);
    if (shot?.kind !== "picture" || !shot.data) return;
    const jpeg = unb64url(shot.data.slice(shot.data.indexOf(",") + 1));
    // A picture that doesn't get there is only a stale preview: the next write sends another.
    void fetch(`/api/r/${room}/picture`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: jpeg }).catch(() => {});
  });
  // A frame's load doesn't bubble, so it is caught on the way down.
  document.addEventListener("load", (e) => {
    if (e.target !== worldFrame()) return;
    clearTimeout(due);
    due = setTimeout(() => { if (!failed) ask({ ask: "picture" }); }, DRAWN_MS);
  }, true);
}

export interface GifState { busy: boolean; says: string }
let state: GifState = { busy: false, says: "" };
const watchers = new Set<(s: GifState) => void>();
export const watchGif = (f: (s: GifState) => void) => {
  watchers.add(f);
  f(state);
  return () => void watchers.delete(f);
};
const tell = (busy: boolean, says: string) => {
  state = { busy, says };
  for (const f of watchers) f(state);
};

/** The world's frames, as data: URLs, or null when it stopped answering. */
const record = () => new Promise<string[] | null>((done) => {
  const frames: string[] = [];
  let quiet: ReturnType<typeof setTimeout>;
  const finish = (out: string[] | null) => { clearTimeout(quiet); removeEventListener("message", hear); done(out); };
  const wait = () => { clearTimeout(quiet); quiet = setTimeout(() => finish(null), QUIET_MS); };
  const hear = (e: MessageEvent) => {
    const shot = fromWorld(e) ? check(Shot, e.data) : null;
    if (shot?.kind === "frames-done") finish(frames);
    else if (shot?.kind === "frame" && shot.data && frames.length < SECONDS * FPS) {
      frames.push(shot.data);
      tell(true, `Recording ${Math.round((frames.length / (SECONDS * FPS)) * 100)}%`);
      wait();
    }
  };
  addEventListener("message", hear);
  wait();
  ask({ ask: "frames", seconds: SECONDS, fps: FPS });
});

/** Every frame's pixels at the first one's size. */
async function pixels(urls: readonly string[]) {
  const images = await Promise.all(urls.map(async (url) => { const i = new Image(); i.src = url; await i.decode(); return i; }));
  const canvas = document.createElement("canvas");
  canvas.width = images[0]!.naturalWidth;
  canvas.height = images[0]!.naturalHeight;
  const x = canvas.getContext("2d", { willReadFrequently: true })!;
  return { width: canvas.width, height: canvas.height, frames: images.map((i) => { x.drawImage(i, 0, 0, canvas.width, canvas.height); return x.getImageData(0, 0, canvas.width, canvas.height).data; }) };
}

const download = (bytes: Uint8Array<ArrayBuffer>, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

async function gifOf(room: string): Promise<string> {
  if (!worldFrame()) return "Open your world first, then export it.";
  tell(true, "Recording 0%");
  const urls = await record();
  if (urls === null) return "The world stopped answering. Keep this tab in front and try again.";
  if (urls.length === 0) return "No canvas in this world, so there's nothing to record.";
  tell(true, "Making the GIF");
  const shots = await pixels(urls);
  // The frames span the seconds asked for, however many the browser managed.
  download(encodeGif({ ...shots, delayMs: (SECONDS * 1000) / urls.length }), `${room}.gif`);
  return `Saved ${room}.gif`;
}

let running: Promise<string> | null = null;
/** Record the world and hand over the GIF; the answer is one line saying what happened. A second ask joins the first. */
export const exportGif = (room: string): Promise<string> => running ??= gifOf(room)
  .catch((e: unknown) => `Couldn't make the GIF: ${e instanceof Error ? e.message : String(e)}`)
  .then((says) => { running = null; tell(false, says); return says; });
