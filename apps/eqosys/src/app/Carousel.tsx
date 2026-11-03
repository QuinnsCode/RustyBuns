// The home's rows drift by themselves: one inline script (hashed into the Worker's CSP beside the sky switch's) moves each `.rail`
// sideways. It stops while the pointer or focus is on a row, or for a few seconds after a wheel, touch or drag, and a pad's d-pad or stick
// steers the row nearest the middle of the screen. Without script, or with reduced motion, a row is an ordinary scrolling strip.
// A row with two or more panels is rendered twice (the copy aria-hidden) so it wraps without a seam.
import type { Maturity } from "../apps.ts";

/** Seconds a panel takes to cross the screen; 0 is off. The menu's choices, and the default. */
export const SPEEDS: [number, string][] = [[0, "Off"], [60, "Slow"], [30, "Normal"], [15, "Fast"], [8, "Faster"]];
export const DEFAULT_SPEED = 30;

export const CAROUSEL_SCRIPT = `(function(){var K="eqosys-rail",d=document,rails=[].slice.call(d.querySelectorAll(".rail")),sel=d.querySelector("[data-rail-speed]");
if(!rails.length)return;
function get(){try{var v=localStorage.getItem(K);return v===null?null:+v}catch(e){return null}}
var secs=get();if(secs===null||isNaN(secs))secs=${DEFAULT_SPEED};
var still=matchMedia("(prefers-reduced-motion: reduce)").matches;
if(sel){sel.value=String(secs);sel.addEventListener("change",function(){secs=+sel.value;try{localStorage.setItem(K,String(secs))}catch(e){}})}
var R=rails.map(function(el){var s={el:el,pos:el.scrollLeft,hold:false,until:0,drag:null,moved:false,loop:el.dataset.loop==="1"};
el.addEventListener("pointerenter",function(e){if(e.pointerType==="mouse")s.hold=true});
el.addEventListener("pointerleave",function(e){if(e.pointerType==="mouse"){s.hold=false;s.drag=null}});
el.addEventListener("focusin",function(){s.hold=true});el.addEventListener("focusout",function(){s.hold=false});
el.addEventListener("wheel",function(){s.until=performance.now()+3000},{passive:true});
el.addEventListener("touchstart",function(){s.until=performance.now()+4000},{passive:true});
el.addEventListener("scroll",function(){if(Math.abs(el.scrollLeft-s.pos)>1.5)s.pos=el.scrollLeft},{passive:true});
el.addEventListener("pointerdown",function(e){if(e.pointerType==="mouse"&&e.button===0){s.drag={x:e.clientX,l:el.scrollLeft};s.moved=false}});
el.addEventListener("pointermove",function(e){if(!s.drag)return;var dx=e.clientX-s.drag.x;if(Math.abs(dx)>5){s.moved=true;el.classList.add("drag")}if(s.moved){el.scrollLeft=s.drag.l-dx;s.pos=el.scrollLeft}});
function end(){s.drag=null;el.classList.remove("drag")}
el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
el.addEventListener("click",function(e){if(s.moved){e.preventDefault();e.stopPropagation();s.moved=false}},true);
el.addEventListener("dragstart",function(e){e.preventDefault()});
return s});
function wrap(s){var el=s.el;if(!s.loop)return;var half=el.scrollWidth/2;if(half<=el.clientWidth)return;if(el.scrollLeft>=half){s.pos-=half;el.scrollLeft=s.pos}else if(el.scrollLeft<=0&&s.pos<=0){s.pos+=half;el.scrollLeft=s.pos}}
function nearest(){var best=null,bd=1e9,mid=innerHeight/2;R.forEach(function(s){var r=s.el.getBoundingClientRect(),dd=Math.abs((r.top+r.bottom)/2-mid);if(dd<bd){bd=dd;best=s}});return best}
var last=performance.now();
function tick(now){var dt=Math.min(now-last,100)/1000;last=now;
R.forEach(function(s){var el=s.el;if(secs>0&&!still&&!s.hold&&!s.drag&&now>s.until&&el.scrollWidth>el.clientWidth+2){s.pos+=el.clientWidth/secs*dt;el.scrollLeft=s.pos;wrap(s)}else if(s.loop)wrap(s)});
var pads=navigator.getGamepads?navigator.getGamepads():[];
for(var i=0;i<pads.length;i++){var p=pads[i];if(!p)continue;var x=Math.abs(p.axes[0])>0.25?p.axes[0]:0;if(p.buttons[14]&&p.buttons[14].pressed)x=-1;if(p.buttons[15]&&p.buttons[15].pressed)x=1;
if(x){var s=nearest();if(s){s.until=now+3000;s.pos=Math.max(0,s.pos+x*900*dt);s.el.scrollLeft=s.pos;wrap(s)}}}
requestAnimationFrame(tick)}
requestAnimationFrame(tick)})();`;

const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

// Lucide's sprout, leaf and flask-conical (ISC).
const BADGES: Record<Maturity, { label: string; tip: string; icon: React.ReactNode }> = {
  alpha: { label: "Alpha", tip: "Alpha: early, and changing fast", icon: <><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></> },
  beta: { label: "Beta", tip: "Beta: works, still being polished", icon: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></> },
  experimental: { label: "Experimental", tip: "Experimental: an idea being tried out", icon: <><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" /><path d="M6.453 15h11.094" /><path d="M8.5 2h7" /></> },
};

/** A maturity badge: a lucide icon, with the word as its tooltip and its accessible name. */
export const Badge = ({ m }: { m: Maturity }) => {
  const b = BADGES[m];
  return <span className={`badge-m ${m}`} title={b.tip} role="img" aria-label={b.label}><Icon>{b.icon}</Icon></span>;
};

/** One row: its panels, doubled for a seamless wrap when there are two or more. */
export function Rail({ label, items }: { label: string; items: React.ReactNode[] }) {
  const loop = items.length > 1;
  return (
    <div className="rail" data-loop={loop ? "1" : "0"} role="region" aria-label={label} tabIndex={-1}>
      {items}
      {loop && <div className="copy" aria-hidden="true" inert>{items}</div>}
    </div>
  );
}

/** The speed menu in the page head. */
export const SpeedMenu = () => (
  <label className="speed" title="How fast the rows drift">Drift
    <select data-rail-speed defaultValue={String(DEFAULT_SPEED)} aria-label="Row speed">{SPEEDS.map(([s, w]) => <option key={s} value={s}>{w}</option>)}</select>
  </label>
);
