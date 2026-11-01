// The sky's light/dark switch: a System / Day / Night slider, and a double-click on the sun or moon does the same.
// The sky is driven by one clock (`--t`, Sky.tsx). Switching pins that clock: the sun and the moon trade places by
// sliding half a turn round the arc (the moon lands where the sun was); choosing the side the sky is already on just settles at its nearest peak instead of spinning a full turn, and the choice is kept in localStorage.
// With nothing chosen the sky keeps its live day and night. This is the page's only script; the Worker's CSP names it by hash.

/** The one inline script. Kept as plain ES5-ish text so its hash is stable. */
export const THEME_SCRIPT = `(function(){var K="eqosys-sky",d=document,b=d.body,h=d.documentElement,m=matchMedia("(prefers-color-scheme: dark)");
function get(){try{return localStorage.getItem(K)}catch(e){return null}}
function put(v){try{localStorage.setItem(K,v)}catch(e){}}
function cur(){return parseFloat(getComputedStyle(b).getPropertyValue("--t"))||0}
function night(){var t=cur()%1;return t>0.5||t<0}
function peak(isNight,from){var base=isNight?0.75:0.25,k=isNight===night()?Math.round(from-base):Math.ceil(from-base+0.001);return base+Math.max(k,0)}
function go(mode,slide){h.dataset.sky=mode||"";if(!mode){b.style.animation="";b.style.transition="";b.style.removeProperty("--t");return}
var wantNight=mode==="night"||(mode==="system"&&m.matches),from=cur(),to=peak(wantNight,from);
b.style.animation="none";b.style.setProperty("--t",from);
if(!slide){b.style.transition="none";b.style.setProperty("--t",to);return}
void b.offsetWidth;b.style.transition="--t 1.8s cubic-bezier(.45,.05,.3,1)";b.style.setProperty("--t",to)}
function pick(mode){put(mode);go(mode,true)}
d.addEventListener("click",function(e){var x=e.target.closest&&e.target.closest("[data-sky-pick]");if(x)pick(x.dataset.skyPick)});
d.addEventListener("dblclick",function(e){if(e.target.closest&&e.target.closest("a,button,input,select,label,.pane,.bar,.card"))return;
["sun","moon"].some(function(c){var n=d.querySelector(".sky ."+c);if(!n)return false;var r=n.getBoundingClientRect(),p=r.width*0.25;
if(+getComputedStyle(n).opacity<0.3||e.clientX<r.left-p||e.clientX>r.right+p||e.clientY<r.top-p||e.clientY>r.bottom+p)return false;
pick(night()?"day":"night");return true})});
m.addEventListener("change",function(){if(get()==="system")go("system",true)});
var s=get();if(s)go(s,false)})();`;

const CSS = `
.skyswitch{position:fixed;top:max(.9rem,env(safe-area-inset-top));right:max(.9rem,env(safe-area-inset-right));z-index:5;display:flex;padding:3px;border-radius:999px;
 background:var(--paper);border:1px solid var(--rim);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);box-shadow:inset 0 1px 0 var(--edge),0 10px 24px -16px rgba(0,0,0,.5)}
.skyswitch::before{content:"";position:absolute;top:3px;left:3px;width:2rem;height:2rem;border-radius:50%;background:var(--acc);opacity:0;transition:transform .35s cubic-bezier(.3,.8,.3,1),opacity .2s}
html[data-sky] .skyswitch::before{opacity:.22}
html[data-sky=day] .skyswitch::before{transform:translateX(2rem)}html[data-sky=night] .skyswitch::before{transform:translateX(4rem)}
.skyswitch button{position:relative;display:grid;place-items:center;width:2rem;height:2rem;padding:0;margin:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--mut);cursor:pointer}
.skyswitch button:hover{filter:none;color:var(--ink)}
html[data-sky=system] .skyswitch [data-sky-pick=system],html[data-sky=day] .skyswitch [data-sky-pick=day],html[data-sky=night] .skyswitch [data-sky-pick=night]{color:var(--ink)}
.skyswitch svg{width:1.05rem;height:1.05rem}
@media(prefers-reduced-motion:reduce){.skyswitch::before{transition:none}}
`;
export const themeCss = CSS;

// Lucide's monitor, sun and moon (ISC), inline so the page fetches nothing for them.
const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const Btn = ({ pick, label, children }: { pick: string; label: string; children: React.ReactNode }) => <button type="button" data-sky-pick={pick} title={label} aria-label={label}><Icon>{children}</Icon></button>;

export const ThemeSwitch = () => (
  <>
    <div className="skyswitch" role="group" aria-label="Sky">
      <Btn pick="system" label="Match my device"><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></Btn>
      <Btn pick="day" label="Day">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
      </Btn>
      <Btn pick="night" label="Night"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></Btn>
    </div>
    <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
  </>
);
