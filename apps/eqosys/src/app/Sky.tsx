// The sky behind the login: a day that turns to night and back, all CSS, no script (the page's CSP allows none).
//
// One clock drives everything: `--t` runs 0 to 1 over CYCLE seconds (a registered property, so it interpolates), and
// every layer derives from it: the sun's and moon's places on their arc (trig functions), how much day is left, how
// strong the horizon glow is and which colour it is (dawn or dusk), the clouds' colour, the panel's paper and ink. The
// phase comes from the server clock, so a reload carries on where the sky was, and everyone sees the same sky.
import { mulberry32 } from "@rustybuns/util";

/** Seconds for one day and night. */
export const CYCLE = 360;

/** Where in the cycle to start: the server's clock, or `at` (a fraction) when a page asks for a given moment. */
export const phaseAt = (at: string | null, now = Date.now()) => {
  const f = at === null ? NaN : Number(at);
  return Number.isFinite(f) ? ((f % 1) + 1) % 1 * CYCLE : Math.floor(now / 1000) % CYCLE;
};

// Stars are box-shadows on one dot, placed around the pole the sky turns on, in vmax so the field covers any screen.
const rnd = mulberry32(7);
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.1;
const TINTS = ["#fff", "#fff", "#fff", "#e3ebff", "#fff0d2"];
const dots = (n: number, spread: number, tint: boolean) => Array.from({ length: n }, () => {
  const x = (rnd() * 2 - 1) * spread, y = (rnd() * 2 - 1) * spread;
  return `${x.toFixed(1)}vmax ${y.toFixed(1)}vmax ${tint ? TINTS[Math.floor(rnd() * TINTS.length)] : "#fff"}`;
}).join(",");
// The milky way: a thick band of faint stars across the field, tilted.
const band = (n: number) => Array.from({ length: n }, () => {
  const u = (rnd() * 2 - 1) * 140, v = gauss() * 9, c = Math.cos(0.6), s = Math.sin(0.6);
  return `${(u * c - v * s + 30).toFixed(1)}vmax ${(u * s + v * c - 50).toFixed(1)}vmax #dfe6ff`;
}).join(",");
const STARS = { far: dots(700, 125, false), mid: dots(260, 125, true), near: dots(70, 125, true), way: band(700) };

/** The page's style: the clock on the body (so the panel reads it too), then every layer of the sky. */
export const skyCss = (t0: number) => `
@property --t{syntax:'\\3c number>';inherits:true;initial-value:0}
body:has(.sky){--t0:${t0};animation:clock ${CYCLE}s linear infinite;animation-delay:calc(var(--t0) * -1s);
 --th:calc(var(--t) * 1turn);
 --el:sin(var(--th));
 --day:clamp(0,calc(0.42 + var(--el) * 1.9),1);
 --night:calc(1 - var(--day));
 --glow:clamp(0,calc(1 - var(--el) * var(--el) * 11),1);
 --dawn:calc(var(--glow) * clamp(0,calc(0.5 + cos(var(--th)) * 1.5),1));
 --dusk:calc(var(--glow) - var(--dawn));
 --sx:calc(50vw - cos(var(--th)) * 46vw);--sy:calc(80vh - var(--el) * 72vh);
 --mx:calc(50vw + cos(var(--th)) * 46vw);--my:calc(80vh + var(--el) * 72vh);
 --dayp:calc(var(--day) * 100%);
 --flip:clamp(0,calc(var(--day) * 20 - 9.5),1);--flipp:calc(var(--flip) * 100%);
 --cloud:color-mix(in oklab,color-mix(in oklab,#fff var(--dayp),#1c2440),#ffb38f calc(var(--glow) * 45%));
 --hill:color-mix(in oklab,#6f8f86 var(--dayp),#070a14);
 --hill2:color-mix(in oklab,#8fb0a3 var(--dayp),#0d1222)}
@keyframes clock{from{--t:0}to{--t:1}}
.sky{position:fixed;inset:0;z-index:-1;overflow:hidden;background:linear-gradient(#05070f,#0b1020 55%,#141c33)}
.sky>*{position:absolute}
.sky .day{inset:0;background:linear-gradient(#2f6fcf,#6ea9e6 45%,#bfdcf2 85%,#e8f1f7);opacity:var(--day)}
.sky .dawn{inset:0;background:radial-gradient(ellipse 90vw 48vh at var(--sx) 84vh,#ffc9a0 0%,rgba(255,150,120,.55) 35%,rgba(240,140,160,.18) 60%,transparent 75%);opacity:var(--dawn)}
.sky .dusk{inset:0;background:radial-gradient(ellipse 100vw 50vh at var(--sx) 84vh,#ff9a5c 0%,rgba(255,110,90,.6) 30%,rgba(190,90,150,.25) 58%,transparent 76%);opacity:var(--dusk)}
.sky .haze{inset:auto 0 0 0;height:45vh;background:linear-gradient(transparent,rgba(255,255,255,.55));opacity:var(--day)}
.sky .stars{left:18vw;top:114vh;width:0;height:0;opacity:clamp(0,calc(var(--night) * 1.5 - .5),1);animation:wheel ${CYCLE * 4}s linear infinite;animation-delay:calc(var(--t0) * -1s)}
@keyframes wheel{to{transform:rotate(1turn)}}
.sky .stars i{position:absolute;display:block;border-radius:50%;background:#fff;will-change:opacity}
.sky .far{width:1px;height:1px;opacity:.7;box-shadow:${STARS.far};animation:twinkle 7s ease-in-out infinite alternate}
.sky .mid{width:1.5px;height:1.5px;opacity:.85;box-shadow:${STARS.mid};animation:twinkle 5s ease-in-out infinite alternate-reverse}
.sky .near{width:2.4px;height:2.4px;box-shadow:${STARS.near};animation:twinkle 9s ease-in-out infinite alternate}
.sky .way{width:1px;height:1px;opacity:.32;box-shadow:${STARS.way};filter:blur(.3px)}
.sky .milk{left:18vw;top:114vh;width:0;height:0;opacity:calc(clamp(0,calc(var(--night) * 1.5 - .5),1) * .5);animation:wheel ${CYCLE * 4}s linear infinite;animation-delay:calc(var(--t0) * -1s)}
.sky .milk b{position:absolute;left:-150vmax;top:-70vmax;width:300vmax;height:40vmax;transform:rotate(34.4deg);transform-origin:50% 50%;
 background:linear-gradient(transparent,rgba(170,185,230,.1) 35%,rgba(205,215,245,.2) 50%,rgba(170,185,230,.1) 65%,transparent);filter:blur(18px)}
@keyframes twinkle{from{opacity:.45}to{opacity:1}}
.sky .meteor{top:12vh;left:20vw;width:16vw;height:1px;transform:rotate(28deg);transform-origin:0 0;opacity:0;
 background:linear-gradient(90deg,transparent,rgba(255,255,255,.9));animation:shoot 53s linear infinite;animation-delay:-50s}
.sky .meteor+.meteor{top:30vh;left:55vw;width:11vw;animation-duration:79s;animation-delay:-23s;transform:rotate(38deg)}
@keyframes shoot{0%,100%{translate:0 0;opacity:0}.4%{opacity:var(--night)}2.4%{translate:30vw 16vh;opacity:0}}
.sky .sun{left:0;top:0;width:9vmin;height:9vmin;border-radius:50%;translate:var(--sx) var(--sy);margin:-4.5vmin 0 0 -4.5vmin;
 --sunc:color-mix(in oklab,#fff6dc,#ff9a4a calc(var(--glow) * 75%));
 background:radial-gradient(circle,#fffdf5 0 30%,var(--sunc) 52%,color-mix(in oklab,var(--sunc) 55%,transparent) 100%);
 box-shadow:0 0 5vmin 2vmin color-mix(in oklab,var(--sunc) 55%,transparent),0 0 24vmin 10vmin color-mix(in oklab,var(--sunc) 22%,transparent);
 opacity:clamp(0,calc(.6 + var(--el) * 8),1)}
.sky .moon{left:0;top:0;width:6vmin;height:6vmin;border-radius:50%;translate:var(--mx) var(--my);margin:-3vmin 0 0 -3vmin;
 background:radial-gradient(circle at 36% 38%,rgba(0,0,0,.14) 0 7%,transparent 8%),radial-gradient(circle at 62% 62%,rgba(0,0,0,.12) 0 10%,transparent 11%),
 radial-gradient(circle at 30% 68%,rgba(0,0,0,.1) 0 5%,transparent 6%),radial-gradient(circle at 65% 30%,rgba(0,0,0,.08) 0 4%,transparent 5%),
 radial-gradient(circle at 40% 40%,#f4f6fb,#d9deea);
 box-shadow:inset 1.3vmin -.4vmin 1vmin rgba(6,9,20,.55),0 0 3vmin 1vmin rgba(200,215,255,.22),0 0 12vmin 4vmin rgba(180,200,255,.1);
 opacity:clamp(.1,calc(.55 - var(--el) * 3),1)}
.sky .cl{left:0;width:200vw;display:flex;will-change:transform;mask-image:linear-gradient(transparent,#000 30%,#000 78%,transparent)}
.sky .cl svg{width:100vw;height:100%;flex:none;display:block}
.sky .cl1{top:2vh;height:40vh;opacity:calc(.45 + var(--day) * .47);animation:drift 440s linear infinite}
.sky .cl2{top:16vh;height:34vh;opacity:calc(.3 + var(--day) * .4);animation:drift 290s linear infinite reverse}
.sky .cl feFlood{flood-color:var(--cloud)}
@keyframes drift{to{transform:translateX(-50%)}}
.sky .hills{left:0;bottom:0;width:100%;height:22vh}
.sky .hills svg{width:100%;height:100%;display:block}
.sky .hills .h0{fill:color-mix(in oklab,var(--hill2) 55%,var(--cloud))}.sky .hills .h1{fill:var(--hill2)}.sky .hills .h2{fill:var(--hill)}
.sky .mist{inset:auto 0 0 0;height:30vh;background:linear-gradient(transparent,color-mix(in oklab,#fff var(--dayp),#0a0e1c) );opacity:calc(.25 + var(--night) * .35)}
@media(prefers-reduced-motion:reduce){body:has(.sky),.sky,.sky *{animation-play-state:paused}}
`;

/** One drifting cloud bank: fractal noise cut to shapes, coloured by the clock (`--cloud` on the feFlood). */
const Clouds = ({ id, freq, octaves, seed, cut }: { id: string; freq: string; octaves: number; seed: number; cut: [number, number] }) => {
  const bank = (k: number) => (
    <svg key={k} viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
      {k === 0 && (
        <defs>
          <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={octaves} seed={seed} stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${cut[0]} ${cut[1]}`} result="a" />
            <feGaussianBlur in="a" stdDeviation="2.5" result="soft" />
            <feFlood result="paint" />
            <feComposite in="paint" in2="soft" operator="in" />
          </filter>
        </defs>
      )}
      <rect width="1000" height="300" filter={`url(#${id})`} />
    </svg>
  );
  return <div className={`cl ${id}`}>{bank(0)}{bank(1)}</div>;
};

export const Sky = () => (
  <div className="sky" aria-hidden="true">
    <div className="day" />
    <div className="dawn" />
    <div className="dusk" />
    <div className="haze" />
    <div className="milk"><b /></div>
    <div className="stars"><i className="way" /><i className="far" /><i className="mid" /><i className="near" /></div>
    <div className="meteor" /><div className="meteor" />
    <div className="moon" />
    <div className="sun" />
    <Clouds id="cl1" freq="0.004 0.011" octaves={6} seed={3} cut={[9, -4.3]} />
    <Clouds id="cl2" freq="0.0025 0.008" octaves={5} seed={11} cut={[10, -4.9]} />
    <div className="hills">
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
        <path className="h0" d="M0 60 C150 30 260 52 380 40 S560 10 680 34 S860 20 1000 30 V120 H0Z" /><path className="h1" d="M0 70 C120 40 180 56 260 50 S420 20 520 44 S700 30 790 52 S920 48 1000 38 V120 H0Z" />
        <path className="h2" d="M0 96 C90 80 160 92 240 84 S400 62 480 80 S640 70 740 88 S900 78 1000 72 V120 H0Z" />
      </svg>
    </div>
    <div className="mist" />
  </div>
);
