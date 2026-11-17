// What every sky page shares: the day-and-night sky (Sky.tsx) behind glass panels whose paper and ink follow the same
// clock, so a panel is white paper at noon and smoked glass at midnight. Type is one family, Lexend, served from eqosys itself
// (public/fonts, OFL): tight and heavy for greetings and card names, light for the word mark.
// The sign-in page (Login.tsx) and the home page (pages.tsx) each add their own rules on top of this one.
import { NAME } from "../env.ts";
import { CYCLE, Sky, skyCss } from "./Sky.tsx";
import { ThemeSwitch, themeCss } from "./Theme.tsx";

// Lexend's variable font, cut the way Google Fonts cuts it: Latin, preloaded, and Latin Extended, fetched only for a name that needs it.
// Ours, not Google's: a first visit opens no other host before the page draws, and nothing leaves eqosys.
const LATIN = "/fonts/lexend-latin.woff2";
const FONTS = `@font-face{font-family:Lexend;font-style:normal;font-weight:300 700;font-display:swap;src:url(${LATIN}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Lexend;font-style:normal;font-weight:300 700;font-display:swap;src:url(/fonts/lexend-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}
`;

/** What the page says hello with, for the hour the sky shows (t0 is seconds into the cycle: 0 sunrise, half sunset). */
export const greeting = (t0: number) => {
  const f = ((t0 / CYCLE) % 1 + 1) % 1;
  return f < 0.1 ? "Good morning." : f < 0.4 ? "Welcome back." : f < 0.58 ? "Good evening." : "Welcome back, night owl.";
};

const CSS = `
body:has(.sky){background:transparent}
body:has(.sky) main{max-width:none;margin:0;min-height:100dvh;padding:max(1.5rem,env(safe-area-inset-top)) max(1rem,env(safe-area-inset-right)) 1.5rem max(1rem,env(safe-area-inset-left));
 font-family:Lexend,system-ui,sans-serif;font-optical-sizing:auto;
 --ink:color-mix(in oklab,#171a24 var(--flipp),#f1f3f8);--mut:color-mix(in oklab,#646b7a var(--flipp),#9ea6b8);
 --paper:color-mix(in oklab,rgba(255,255,255,.76) var(--flipp),rgba(12,16,28,.62));
 --field:color-mix(in oklab,rgba(255,255,255,.55) var(--flipp),rgba(255,255,255,.05));
 --edge:color-mix(in oklab,rgba(255,255,255,.85) var(--flipp),rgba(255,255,255,.12));
 --rim:color-mix(in oklab,rgba(20,24,36,.12) var(--flipp),rgba(255,255,255,.09));
 --acc:color-mix(in oklab,#1d6f68 var(--flipp),#8ee8d8);--onacc:color-mix(in oklab,#fff var(--flipp),#06201d);
 --bad:color-mix(in oklab,#b3261e var(--flipp),#ff9d94);
 --ui-bg:var(--field);--ui-ink:var(--ink);--ui-line:var(--rim);--ui-soft:color-mix(in oklab,var(--ink) 8%,transparent);--ui-accent:var(--acc);--ui-on-accent:var(--onacc);--ui-border:1px;--ui-font:inherit;
 --sunmark:color-mix(in oklab,#f2b24a var(--flipp),#dfe6f5);color:var(--ink)}
.pane{padding:2.1rem 2.1rem 1.6rem;border-radius:26px;background:var(--paper);color:var(--ink);border:1px solid var(--rim);
 backdrop-filter:blur(26px) saturate(1.5);-webkit-backdrop-filter:blur(26px) saturate(1.5);
 box-shadow:0 40px 90px -36px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.08),inset 0 1px 0 var(--edge);animation:arrive .8s cubic-bezier(.2,.7,.2,1) both}
@keyframes arrive{from{opacity:0;transform:translateY(12px) scale(.98)}}
.brand{display:flex;align-items:center;gap:.5rem;font-family:Lexend,system-ui,sans-serif;font-size:1.05rem;font-weight:500;letter-spacing:.01em;color:var(--mut);margin-bottom:1.6rem}
.brand i{width:.7rem;height:.7rem;border-radius:50%;background:var(--sunmark);box-shadow:0 0 .6rem color-mix(in oklab,var(--sunmark) 70%,transparent)}
.brand b{font-weight:600;font-size:1.15rem;letter-spacing:-.02em;color:transparent;background:linear-gradient(100deg,#6cc4ff 0%,#8fd3ff 45%,#ffa45c 70%,#b69cff 100%);-webkit-background-clip:text;background-clip:text}
.pane h1{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:2.2rem;text-wrap:balance;line-height:1.05;letter-spacing:-.035em;margin:0}
.pane .lead{margin:.6rem 0 1.5rem;color:var(--mut);font-size:.95rem;line-height:1.45}
.pane .lead b{color:var(--ink);font-weight:500}
main .bad{margin:0 0 1rem;padding:.6rem .8rem;border-radius:12px;font-size:.88rem;color:var(--bad);
 background:color-mix(in oklab,var(--bad) 9%,transparent);border:1px solid color-mix(in oklab,var(--bad) 22%,transparent)}
main input,main select{font:inherit;font-size:1rem;padding:.68rem .85rem;border-radius:12px;background:var(--field);border:1px solid var(--rim);color:var(--ink);
 color-scheme:light;transition:border-color .2s,box-shadow .2s,background .2s}
main input::placeholder{color:color-mix(in oklab,var(--mut) 60%,transparent)}
main input:focus,main select:focus{outline:none;border-color:color-mix(in oklab,var(--acc) 70%,transparent);box-shadow:0 0 0 4px color-mix(in oklab,var(--acc) 18%,transparent)}
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
    <link rel="preload" href={LATIN} as="font" type="font/woff2" crossOrigin="" />
    <style dangerouslySetInnerHTML={{ __html: FONTS + skyCss(t0) + CSS + themeCss + css }} />
    <Sky />
    <ThemeSwitch />
    {children}
  </>
);

/** The kit's button classes, so the pages say `className={btn()}` or `btn(true)` for the accent one. */
export const btn = (primary = false) => primary ? "ui-btn primary" : "ui-btn";

export const Brand = () => <div className="brand"><i /><b>{NAME}</b></div>;
