// A world's pictures through the running app (`bun scripts/dev.ts` and headless Chrome): the agent writes a world over
// HTTP, the page open in the browser sends its picture to the room, the room's link previews it, and Export GIF hands
// the person a file. And what the picture route turns away.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Chrome, launchChrome, load, openTab, type Tab, waitFor } from "../../../scripts/chrome.ts";
import { PICTURE_MAX } from "../src/share.ts";

setDefaultTimeout(120_000);

let server: ReturnType<typeof serve>, url: string, chrome: Chrome;
const downloads = mkdtempSync(join(tmpdir(), "agentworld-gif-"));
const serve = () => Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/dev.ts"), "--port", "0", "--with-parent"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "inherit" });

beforeAll(async () => {
  server = serve();
  const first = await server.stdout.getReader().read();
  url = new TextDecoder().decode(first.value).match(/http:\/\/[\d.]+:\d+/)![0];
  chrome = await launchChrome();
});
afterAll(() => {
  chrome?.stop();
  server?.kill();
  rmSync(downloads, { recursive: true, force: true });
});

const picture = (room: string) => fetch(`${url}/api/r/${room}/picture`);
const jpegOf = async (room: string) => new Uint8Array(await (await picture(room)).arrayBuffer());
const until = async (what: string, ok: () => Promise<boolean>, ms = 30_000) => {
  for (const end = Date.now() + ms; !(await ok()); await Bun.sleep(200)) if (Date.now() > end) throw new Error(`never: ${what}`);
};

/** A world that keeps drawing: a square crossing a wash of `color`, with enough shades to fill a GIF's tables. */
const world = (color: string, extra = "") => `<!doctype html><body style="margin:0"><canvas width="960" height="540"></canvas><script>
const x = document.querySelector("canvas").getContext("2d");
let t = 0;
(function draw() {
  x.fillStyle = "${color}"; x.fillRect(0, 0, 960, 540);
  for (let i = 0; i < 960; i += 8) { x.fillStyle = "hsl(" + (i / 3) + " 80% 50%)"; x.fillRect(i, 400, 8, 140); }
  x.fillStyle = "#fff"; x.fillRect((t++ * 12) % 960, 180, 120, 120);
  requestAnimationFrame(draw);
})();
${extra}</script>`;

/** An agent writing index.html over HTTP, once the page's relay is up. */
const write = async (room: string, text: string) => {
  const r = await fetch(`${url}/api/r/${room}/tools/page_write_file`, { method: "POST", body: JSON.stringify({ path: "index.html", text }) });
  expect(r.status).toBe(200);
};
const read = async (room: string) => (await fetch(`${url}/api/r/${room}/tools/page_read`, { method: "POST" }));

/** The link preview tags of the page at `path`, as a crawler reads them. */
async function card(path: string) {
  const tags: Record<string, string> = {};
  await new HTMLRewriter().on("head meta", { element(m) {
    const key = m.getAttribute("property") ?? m.getAttribute("name");
    if (key) tags[key] = m.getAttribute("content") ?? "";
  } }).transform(await fetch(`${url}${path}`)).text();
  return tags;
}

const click = (tab: Tab, label: string) => tab.eval(`document.querySelector('button[aria-label="${label}"]').click()`);

test("an agent's world gets a picture, its link previews it, and Export GIF hands over a moving one", async () => {
  const room = "picturesroom01";
  await chrome.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  const tab = await openTab(chrome.cdp, { w: 1100, h: 760 });
  await load(chrome.cdp, tab, `${url}/r/${room}`, 0);
  await until("the relay is up", async () => (await read(room)).status === 200);
  expect((await card(`/r/${room}`))["og:image"]).toBe(`${url}/og.jpg`);

  await write(room, world("#102060"));
  await until("a picture", async () => (await picture(room)).status === 200);
  const first = await picture(room);
  expect(first.headers.get("content-type")).toBe("image/jpeg");
  const kept = new Uint8Array(await first.arrayBuffer());
  expect([...kept.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  // The camera's messages are not the agent's business.
  expect((await (await read(room)).json()).said).toEqual(["nothing: no errors since it loaded"]);

  expect(await card(`/r/${room}`)).toMatchObject({ "og:image": `${url}/api/r/${room}/picture`, "twitter:card": "summary_large_image", "og:title": "Agent World" });
  expect((await card("/"))["og:image"]).toBe(`${url}/og.jpg`);
  expect((await fetch(`${url}/og.jpg`)).headers.get("content-type")).toBe("image/jpeg");

  // A world that failed as it loaded keeps the old picture.
  await write(room, world("#a01010", "throw new Error('broken');"));
  await Bun.sleep(4000);
  expect(await jpegOf(room)).toEqual(kept);

  await write(room, world("#106030"));
  await until("the new world's picture", async () => Buffer.compare(await jpegOf(room), kept) !== 0);
  await click(tab, "Export GIF");
  const file = join(downloads, `${room}.gif`);
  await until("the GIF", async () => existsSync(file));
  const gif = readFileSync(file);
  expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
  // Chrome's own decoder reads every frame of it.
  const seen = await tab.eval<{ frames: number; width: number }>(`(async () => {
    const data = Uint8Array.from(atob("${gif.toString("base64")}"), (c) => c.charCodeAt(0));
    const decoder = new ImageDecoder({ data, type: "image/gif" });
    await decoder.completed;
    await decoder.tracks.ready;
    const frames = decoder.tracks.selectedTrack.frameCount;
    let width = 0;
    for (let i = 0; i < frames; i++) width = (await decoder.decode({ frameIndex: i })).image.displayWidth;
    return { frames, width };
  })()`);
  expect(seen.frames).toBeGreaterThan(1);
  expect(seen.width).toBe(320);

  await write(room, "<!doctype html><body><h1>words only</h1>");
  await Bun.sleep(500);
  await click(tab, "Export GIF");
  await waitFor(tab, "the one line about no canvas", `document.querySelector(".dock").textContent.includes("No canvas in this world")`);
  await tab.close();
});

describe("a picture PUT", () => {
  const jpeg = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
  const put = (room: string, body: Uint8Array<ArrayBuffer>, origin = url) => fetch(`${url}/api/r/${room}/picture`, { method: "PUT", headers: { "content-type": "image/jpeg", origin }, body });

  test.each([
    ["from another site", jpeg(100), "https://elsewhere.example", 403],
    ["that isn't a JPEG", new TextEncoder().encode("<svg/>"), undefined, 415],
    ["too big", jpeg(PICTURE_MAX + 1), undefined, 413],
  ] as const)("is refused %s", async (_, body, origin, status) => {
    expect((await put("refusedroom01", body, origin)).status).toBe(status);
    expect((await picture("refusedroom01")).status).toBe(404);
  });

  test("from this page is kept", async () => {
    expect((await put("acceptedroom1", jpeg(100))).status).toBe(200);
    expect(await jpegOf("acceptedroom1")).toEqual(jpeg(100));
  });
});
