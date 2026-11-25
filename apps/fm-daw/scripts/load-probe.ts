// Where a Qollab Studio page's load goes in headless Chrome: when DOMContentLoaded and load fire, whether a look into the
// page is answered or held, the requests still open, the shader programs it links (by the material's name where it has
// one), and the functions that held the main thread. CI's runners draw in SwiftShader, so ask for it here to see what
// CI sees (#5919: the front door spent ~37 s compiling shaders before its load event).
//   CHROME_GL=software bun scripts/load-probe.ts [path]        default jam.html?quality=low
//   bun run builder run apps/fm-daw env CHROME_GL=software bun scripts/load-probe.ts
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { launchChrome, openTab, startVite } from "../../../scripts/chrome.ts";

help(import.meta.path);
const path = process.argv[2] ?? "jam.html?quality=low";
const [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(join(import.meta.dir, ".."))]);
try {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
  const t0 = Date.now();
  const at = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s ${what}`);
  chrome.cdp.on((m) => {
    if (m.sessionId !== tab.sessionId) return;
    if (m.method === "Page.domContentEventFired") at("DOMContentLoaded");
    else if (m.method === "Page.loadEventFired") at("load");
  });
  // every program the page links, named by three.js's SHADER_NAME (a named material) where it has one
  await tab.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const P = WebGL2RenderingContext.prototype, link = P.linkProgram, src = P.shaderSource;
    const gl = window.__probeGl = { links: 0, named: {} };
    P.linkProgram = function (p) { gl.links++; return link.call(this, p); };
    P.shaderSource = function (s, text) { const m = /gl_FragColor|pc_fragColor/.test(text) && text.match(/SHADER_NAME (\\S+)/); if (m) gl.named[m[1]] = (gl.named[m[1]] ?? 0) + 1; return src.call(this, s, text); };
  })()` });
  await tab.call("Profiler.enable");
  await tab.call("Profiler.setSamplingInterval", { interval: 1000 });
  await tab.call("Profiler.start");
  await tab.call("Page.navigate", { url: vite.url + path });
  for (let i = 0; i < 40; i++) {
    const asked = Date.now();
    const r = await Promise.race([tab.eval<string>("document.readyState"), Bun.sleep(3000).then(() => "held")]);
    const open = [...tab.pending.values()].map((u) => u.replace(vite.url, "/").slice(0, 80));
    at(`look ${r} (${Date.now() - asked} ms)${open.length ? `; open: ${open.slice(0, 3).join(" | ")}` : ""}`);
    if (r === "complete") break;
    await Bun.sleep(1000);
  }
  if (tab.noise.length) console.log("noise", tab.noise.slice(0, 8).join("\n  "));
  console.log("programs", JSON.stringify(await tab.eval("window.__probeGl")));
  console.log("picture", JSON.stringify(await tab.eval("window.qjam?.state().picture ?? null")));
  const { profile } = await tab.call("Profiler.stop");
  const node = new Map<number, { callFrame: { functionName: string; url: string; lineNumber: number } }>(profile.nodes.map((n: { id: number }) => [n.id, n]));
  const self = new Map<string, number>();
  (profile.samples as number[]).forEach((id, i) => {
    const f = node.get(id)!.callFrame, key = `${f.functionName || "(anon)"} ${f.url.split("?")[0]!.split("/").slice(-2).join("/")}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  console.log("main thread, self time:");
  for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${ms.toFixed(0).padStart(7)} ms  ${k.slice(0, 140)}`);
} finally { chrome.stop(); vite.stop(); }
