// How smooth the home is on a slow phone: an iPhone XR's size, the CPU slowed 4x, frames timed while it sits and while it scrolls.
// `bun scripts/perf-home.ts` (the preview server in preview-home.tsx must be up: `bun scripts/preview-home.tsx --serve`, on PORTS.eqosysPreview).
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { PORTS } from "@rustybuns/util/ports";

const url = process.env.URL ?? `http://127.0.0.1:${PORTS.eqosysPreview}/`;
const chrome = await launchChrome();
for (const [name, w, h, mobile, slow] of [["xr", 414, 896, true, 4], ["mbp", 1512, 945, false, 1]] as const) {
  const tab = await openTab(chrome.cdp, { w, h }, mobile);
  await load(chrome.cdp, tab, url, 1500);
  if (process.env.CSS) await tab.eval(`document.head.append(Object.assign(document.createElement("style"),{textContent:${JSON.stringify(process.env.CSS)}}))`);
  await tab.call("Emulation.setCPUThrottlingRate", { rate: slow });
  const frames = (ms: number) => tab.eval<number[]>(`new Promise(ok=>{const t=[];let s=performance.now();const f=n=>{t.push(n);n-s<${ms}?requestAnimationFrame(f):ok(t.slice(1).map((x,i)=>x-t[i]))};requestAnimationFrame(f)})`);
  const sum = (d: number[]) => { const s = [...d].sort((a, b) => a - b); return `fps ${(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(0)}, p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(0)} ms, janky ${d.filter((x) => x > 34).length}/${d.length}`; };
  const idle = await frames(2500);
  const scroll = tab.call("Input.synthesizeScrollGesture", { x: w / 2, y: h / 2, yDistance: -2500, speed: 1500, gestureSourceType: mobile ? "touch" : "mouse" });
  const moving = await frames(2500); await scroll;
  console.log(name, "idle:", sum(idle), "| scrolling:", sum(moving));
  await tab.close();
}
chrome.stop();
