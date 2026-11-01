// What every sky page shares: the day-and-night sky (Sky.tsx) behind glass panels whose paper and ink follow the same
// clock, so a panel is white paper at noon and smoked glass at midnight. Type is Lexend (Poppins ExtraLight for game titles) (tight for
// greetings, headings and the word mark), from Google Fonts; the Worker's CSP lets those two hosts in.
// The sign-in page (Login.tsx) and the home page (pages.tsx) each add their own rules on top of this one.
import { NAME } from "../env.ts";
import { CYCLE, Sky, skyCss } from "./Sky.tsx";
import { ThemeSwitch, themeCss } from "./Theme.tsx";

const FONTS = "https://fonts.googleapis.com/css2?family=Lexend:wght@300..600&family=Poppins:wght@200&family=Share+Tech+Mono&display=swap";

/** What the page says hello with, for the hour the sky shows (t0 is seconds into the cycle: 0 sunrise, half sunset). */
export const greeting = (t0: number) => {
  const f = ((t0 / CYCLE) % 1 + 1) % 1;
  return f < 0.1 ? "Good morning." : f < 0.4 ? "Welcome back." : f < 0.58 ? "Good evening." : "Welcome back, night owl.";
};

const CSS = `
body:has(.sky){background:transparent}
body:has(.sky) main{max-width:none;margin:0;min-height:100dvh;padding:1.5rem 1rem;
 font-family:Lexend,system-ui,sans-serif;font-optical-sizing:auto;
 --ink:color-mix(in oklab,#171a24 var(--flipp),#f1f3f8);--mut:color-mix(in oklab,#646b7a var(--flipp),#9ea6b8);
 --paper:color-mix(in oklab,rgba(255,255,255,.76) var(--flipp),rgba(12,16,28,.62));
 --field:color-mix(in oklab,rgba(255,255,255,.55) var(--flipp),rgba(255,255,255,.05));
 --edge:color-mix(in oklab,rgba(255,255,255,.85) var(--flipp),rgba(255,255,255,.12));
 --rim:color-mix(in oklab,rgba(20,24,36,.12) var(--flipp),rgba(255,255,255,.09));
 --acc:color-mix(in oklab,#1d6f68 var(--flipp),#8ee8d8);--onacc:color-mix(in oklab,#fff var(--flipp),#06201d);
 --bad:color-mix(in oklab,#b3261e var(--flipp),#ff9d94);
 --sunmark:color-mix(in oklab,#f2b24a var(--flipp),#dfe6f5);color:var(--ink)}
.pane{padding:2.1rem 2.1rem 1.6rem;border-radius:26px;background:var(--paper);color:var(--ink);border:1px solid var(--rim);
 backdrop-filter:blur(26px) saturate(1.5);-webkit-backdrop-filter:blur(26px) saturate(1.5);
 box-shadow:0 40px 90px -36px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.08),inset 0 1px 0 var(--edge);animation:arrive .8s cubic-bezier(.2,.7,.2,1) both}
@keyframes arrive{from{opacity:0;transform:translateY(12px) scale(.98)}}
.brand{display:flex;align-items:center;gap:.5rem;font-family:Lexend,system-ui,sans-serif;font-size:1.05rem;font-weight:500;letter-spacing:.01em;color:var(--mut);margin-bottom:1.6rem}
.brand svg{height:4rem;width:auto;display:block;overflow:visible}
.pane h1{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:2.2rem;text-wrap:balance;line-height:1.05;letter-spacing:-.035em;margin:0}
.pane .lead{margin:.6rem 0 1.5rem;color:var(--mut);font-size:.95rem;line-height:1.45}
.pane .lead b{color:var(--ink);font-weight:500}
main .bad{margin:0 0 1rem;padding:.6rem .8rem;border-radius:12px;font-size:.88rem;color:var(--bad);
 background:color-mix(in oklab,var(--bad) 9%,transparent);border:1px solid color-mix(in oklab,var(--bad) 22%,transparent)}
main input,main select{font:inherit;font-size:1rem;padding:.68rem .85rem;border-radius:12px;background:var(--field);border:1px solid var(--rim);color:var(--ink);
 color-scheme:light;transition:border-color .2s,box-shadow .2s,background .2s}
main input::placeholder{color:color-mix(in oklab,var(--mut) 60%,transparent)}
main input:focus,main select:focus{outline:none;border-color:color-mix(in oklab,var(--acc) 70%,transparent);box-shadow:0 0 0 4px color-mix(in oklab,var(--acc) 18%,transparent)}
main button{padding:.78rem 1rem;border-radius:12px;font:inherit;font-size:1rem;font-weight:500;letter-spacing:.005em;background:var(--acc);color:var(--onacc);
 border:1px solid transparent;cursor:pointer;transition:transform .12s,filter .2s;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 8px 20px -12px var(--acc)}
main button:hover{filter:brightness(1.05)}main button:active{transform:translateY(1px)}
main button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
main button.ghost{background:var(--field);color:var(--ink);border-color:var(--rim);box-shadow:none}
main button.ghost:hover{filter:none;background:color-mix(in oklab,var(--ink) 8%,transparent)}
.me{display:flex;align-items:center;gap:.85rem}
.me i{display:grid;place-items:center;flex:none;width:2.75rem;height:2.75rem;border-radius:50%;background:var(--acc);color:var(--onacc);font-family:Lexend,system-ui,sans-serif;font-style:normal;font-weight:500;font-size:1.2rem;text-transform:uppercase}
.me div{min-width:0}.me b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.me span{color:var(--mut);font-size:.86rem}
.foot{margin-top:1.1rem;font-size:.8rem;color:var(--mut);text-align:center;animation:arrive 1s .15s cubic-bezier(.2,.7,.2,1) both}
.foot a{color:inherit;text-underline-offset:3px}
@media(prefers-reduced-motion:reduce){.pane,.foot{animation:none}}
@media(max-width:28rem){.pane{padding:1.7rem 1.35rem 1.3rem}.pane h1{font-size:1.85rem}}
`;

/** The sky, the fonts and the shared glass rules, with the page's own `css` after them. */
export const Glass = ({ t0, css, children }: { t0: number; css: string; children: React.ReactNode }) => (
  <>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link rel="stylesheet" href={FONTS} precedence="default" />
    <style dangerouslySetInnerHTML={{ __html: skyCss(t0) + CSS + themeCss + css }} />
    <Sky />
    <ThemeSwitch />
    {children}
  </>
);

// The word mark: an oval badge (light sky, black type) with a moon on one side and a sun on the other, ringed from
// black-purple at the ends to orange in the middle. Type sits a little high so the q and y clear the rim.
export const Badge = () => (
  <svg viewBox="0 0 600 300" role="img" aria-label={NAME}>
    <defs>
      <linearGradient id="eqr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0b0f1a" /><stop offset=".22" stopColor="#6b4fb8" /><stop offset=".5" stopColor="#ff9d5c" /><stop offset=".78" stopColor="#6b4fb8" /><stop offset="1" stopColor="#0b0f1a" /></linearGradient>
      <filter id="eqb"><feGaussianBlur stdDeviation="9" /></filter>
      <filter id="eqs"><feGaussianBlur stdDeviation="5" /></filter>
      <clipPath id="eqe"><ellipse cx="300" cy="150" rx="258" ry="108" /></clipPath>
      <mask id="eqm"><rect width="600" height="300" fill="#fff" /><circle cx="96" cy="138" r="26" fill="#000" /></mask>
    </defs>
    <ellipse cx="300" cy="150" rx="272" ry="122" fill="none" stroke="url(#eqr)" strokeWidth="8" />
    <ellipse cx="300" cy="150" rx="258" ry="108" fill="#8fd0ff" />
    <g clipPath="url(#eqe)">
      <ellipse cx="80" cy="60" rx="110" ry="40" fill="#c9b6ff" opacity=".8" filter="url(#eqb)" />
      <ellipse cx="300" cy="28" rx="160" ry="20" fill="#fff" opacity=".7" filter="url(#eqb)" />
      <ellipse cx="480" cy="255" rx="120" ry="40" fill="#ff9d5c" opacity=".7" filter="url(#eqb)" />
      <circle cx="510" cy="150" r="46" fill="#ff9d5c" opacity=".55" filter="url(#eqs)" />
      <circle cx="510" cy="150" r="27" fill="#ff8a3d" />
      <circle cx="90" cy="150" r="40" fill="#fff" opacity=".45" filter="url(#eqs)" />
      <circle cx="90" cy="150" r="27" fill="#fdfbff" mask="url(#eqm)" />
    </g>
    <ellipse cx="300" cy="150" rx="258" ry="108" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
    <text x="300" y="170" fontFamily="'Share Tech Mono',ui-monospace,monospace" fontSize="84" textAnchor="middle" letterSpacing="5" fill="#0b0f1a">{NAME}</text>
  </svg>
);

export const Brand = () => <div className="brand"><Badge /></div>;
