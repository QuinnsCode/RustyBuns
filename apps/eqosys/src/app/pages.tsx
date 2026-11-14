import { createElement } from "react";
import { APPS, GENRES, ourApp, playOf, type QApp } from "../apps.ts";
import { isListing } from "../listings.ts";
import type { Me, Way } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Friend, HubState, Note } from "../qollab/hub.ts";
import type { Side } from "../qollab/side.ts";
import type { Member } from "../members.ts";
import { Glass, btn, greeting } from "./Glass.tsx";
import { Art } from "./Art.tsx";
import { Badge } from "./Badge.tsx";
import { ACHIEVEMENTS, catalogOf, shownFor, TOTAL, type Achievement } from "../achievements.ts";
import { cardOf } from "../cards.ts";
import { HOLDERS } from "../privacy.ts";
import type { Visitors as Counts } from "../visitors.ts";
import type { Load } from "../scale.ts";
import { SCALE_CSS, Scale } from "./Scale.tsx";
import { STUDIO_CSS, Studios } from "./Studio.tsx";
import type { Studio } from "../studios.ts";

type Unlocks = Map<string, Map<string, number>>;

/** The words for a page's `?e=`: only its own keys, so `?e=__proto__` or `?e=constructor` shows nothing rather than failing the page. */
export const messageOf = (e?: string) => e && Object.hasOwn(MESSAGES, e) ? MESSAGES[e] : undefined;

export const MESSAGES: Record<string, string> = {
  bad: "That email and password don't match.",
  taken: "Couldn't make that account: the email may be in use, or the password under 10 characters.",
  slow: "Too many tries. Wait a minute.",
  in: "Sign in first.",
  provider: "That sign-in isn't available right now.",
  app: "That app isn't one of ours, or it asked to send you somewhere it doesn't own.",
  role: "A role is one word: letters, numbers, - or _.",
  who: "No such person or app.",
  full: "Too many friends or requests waiting. Drop some first.",
  hub: "That didn't go through. Try again.",
  confirm: "That isn't your email. Nothing was deleted.",
  nohub: "Friends are off right now.",
  link: "That sign-in couldn't be added. It may already belong to another account.",
  last: "That is your only way to sign in, so it stays.",
  nolink: "That friend link is no longer good. Ask them for a new one.",
  nobody: "Nobody has signed up with that email yet.",
  studio: "Only a studio's owner or admin adds people, and only an owner makes another owner.",
  owned: "You own three studios already.",
  name: "A studio's name is 1 to 60 characters.",
  making: "That game is still being made: only its studio can sign in to it until it is listed.",
  game: "Check the game: an id like rocket-golf, a name, a genre, and at least one https origin with nothing after it.",
  gamestep: "That id is taken, or the game can't take that step now.",
  gameowner: "Only a studio's owner or admin changes its games.",
};

const nameOf = (id: string) => cardOf(id, ourApp(id)?.name ?? id).name;
/** An app's card: ours from cards.json, a studio's game from its own line. */
const cardFor = (app: QApp) => app.blurb === undefined ? cardOf(app.id, app.name) : { ...cardOf(app.id, app.name), blurb: app.blurb };
/** "by Acme · " on a studio's game. */
const byOf = (app: QApp) => isListing(app) ? `by ${app.studio.name} · ` : "";

const day = (t: number) => (t ? new Date(t).toISOString().slice(0, 10) : "not yet");

function AppsTable({ m }: { m: Member }) {
  return m.apps.length === 0 ? <span className="mut">none yet</span> : (
    <>{m.apps.map((a) => <div key={a.app}>{nameOf(a.app)} <span className="mut">{a.access.join(", ") || "no access"} · {day(a.last_at)}</span></div>)}</>
  );
}

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** One button that posts an op on the person's own hub (handle.ts). */
const Act = ({ to, id, label, ghost }: { to: "accept" | "drop" | "clear" | "relink"; id?: string; label: string; ghost?: boolean }) => (
  <form method="post" action={`/do/${to}`}>
    {id && <input type="hidden" name="id" value={id} />}
    <button className={btn(!ghost)} type="submit">{label}</button>
  </form>
);

/** Where a friend is right now: each app they have open and what they said they're doing there, or off. */
const where = (f: Friend) => f.presence.length ? f.presence.map((p) => `in ${nameOf(p.app)}${p.doing ? `: ${p.doing}` : ""}`).join(" · ") : "off";

const NoteLine = ({ n }: { n: Note }) => {
  if (n.kind === "ask") return <span><b>{n.from.name}</b> wants to be friends.</span>;
  if (n.kind === "accept") return <span><b>{n.from.name}</b> is now your friend.</span>;
  // An app's nudge: the hub only let a link through on that app's own site.
  return <span><b>{n.from.name}</b> in {nameOf(n.app ?? "")}: {n.link ? <a href={n.link}>{n.text}</a> : n.text}</span>;
};

const WAY_NAMES: Record<string, string> = { credential: "Email and password", github: "GitHub", google: "Google", apple: "Apple" };
/** Ways to sign in: each one on the account (taken off unless it is the last), and a button for each provider not on it yet. */
function Ways({ ways, social }: { ways: Way[]; social: string[] }) {
  const more = social.filter((p) => !ways.some((w) => w.provider === p));
  return (
    <>
      <h2>Ways to sign in</h2>
      <p className="mut">Each one opens this same account: your games, friends, saves and achievements. Add the ones you use on your other devices.</p>
      <div className="card list">
        {ways.map((w) => (
          <div key={w.id}><b>{WAY_NAMES[w.provider] ?? w.provider}</b><span className="grow mut">on your account</span>
            {ways.length > 1 && <form method="post" action="/do/unlink"><input type="hidden" name="id" value={w.id} /><button className={btn()} type="submit">Take off</button></form>}</div>
        ))}
        {more.map((p) => (
          <div key={p}><b>{WAY_NAMES[p] ?? p}</b><span className="grow mut">not added</span>
            <form method="post" action="/do/link"><input type="hidden" name="provider" value={p} /><button className={btn(true)} type="submit">Add {WAY_NAMES[p] ?? p}</button></form></div>
        ))}
      </div>
    </>
  );
}

/** Friends, who is asking whom, and what friends' apps said: the person's hub (hub.ts), read on the way in. */
function Friends({ hub, counts, invite, origin }: { hub: HubState; counts: Map<string, number>; invite?: { id: string; name: string } | null; origin: string }) {
  const nobody = hub.friends.length + hub.incoming.length + hub.outgoing.length === 0;
  // The friend link this browser opened (handle.ts /add), unless it is their own or a friend's already.
  const from = invite && invite.id !== hub.me?.id && !hub.friends.some((f) => f.id === invite.id) ? invite : null;
  return (
    <>
      <h2>Friends</h2>
      {from && (
        <div className="row card invite">
          <span className="grow"><b>{from.name}</b> sent you their friend link.</span>
          <form method="post" action="/do/add"><button className={btn(true)} type="submit">Be friends with {from.name}</button></form>
          <form method="post" action="/do/add"><input type="hidden" name="no" value="1" /><button className={btn()} type="submit">No thanks</button></form>
        </div>
      )}
      {hub.link && (
        <div className="row card">
          <label className="grow link"><span className="mut">Your friend link: send it to anyone. They open it, sign in or make an account, and you're friends.</span>
            <input readOnly value={`${origin}/add/${hub.link}`} aria-label="Your friend link" /></label>
          <Act to="relink" label="New link" ghost />
        </div>
      )}
      <form className="row card" method="post" action="/do/befriend">
        <input name="email" type="email" placeholder="or a friend's email" required />
        <button className={btn(true)} type="submit">Ask to be friends</button>
      </form>
      <div className="card list">
        {nobody && <div><span className="mut">Nobody yet. Send someone your friend link.</span></div>}
        {hub.incoming.map((p) => (
          <div key={p.id}><b>{p.name}</b><span className="grow mut">wants to be friends</span><Act to="accept" id={p.id} label="Accept" /><Act to="drop" id={p.id} label="No thanks" ghost /></div>
        ))}
        {hub.friends.map((f) => (
          <div key={f.id}><b>{f.name}</b><span className="grow mut">{where(f)}</span><span className="mut">{counts.get(f.id) ?? 0} of {TOTAL} achievements</span><Act to="drop" id={f.id} label="Drop" ghost /></div>
        ))}
        {hub.outgoing.map((p) => (
          <div key={p.id}><b>{p.name}</b><span className="grow mut">asked {when(p.at)}, waiting</span><Act to="drop" id={p.id} label="Never mind" ghost /></div>
        ))}
      </div>
      {hub.notes.length > 0 && (
        <>
          <h2>Notifications</h2>
          <div className="card list">
            {hub.notes.map((n) => <div key={n.key}><NoteLine n={n} /><span className="grow mut">{when(n.at)}</span></div>)}
            <div><Act to="clear" label="Clear" ghost /></div>
          </div>
        </>
      )}
    </>
  );
}

// The home page: the same sky and glass as sign-in (Glass.tsx), laid out like a game store's home and as wide as the window
// allows: the menu on the left, then your games (one big, the ones you played last, a shelf of screenshot tiles a genre), then
// which friends are on. Its words come from cards.json (cards.ts); the pictures are the apps' screenshots (public/cards).
const HOME_CSS = `
.home{width:min(100%,110rem);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:1rem;align-items:start;
 --tile:color-mix(in oklab,rgba(255,255,255,.9) var(--flipp),rgba(16,20,34,.88))}
.home a,.home button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.home .menu{display:grid;gap:.6rem;min-width:0}
.home .top{display:grid;gap:1rem;padding:1.5rem 1.8rem 1.1rem}
.home .top .brand{margin:0;justify-content:space-between}
.home .top .brand span{display:flex;align-items:center;gap:.5rem}
.home .avatar{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:50%;background:var(--acc);color:var(--onacc);font:500 1.05rem Lexend,system-ui,sans-serif;text-transform:uppercase;text-decoration:none}
.home .top h1{font-size:2.4rem}
.home .body{display:grid;gap:1rem;min-width:0}
.home h2{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;margin:1rem .4rem 0;color:var(--ink);opacity:.8;
 text-shadow:0 1px 12px color-mix(in oklab,var(--paper) 90%,transparent)}
.home h2 em{font-style:normal;font-weight:400;opacity:.7;margin-left:.4rem;font-variant-numeric:tabular-nums}
.home .mut{color:var(--mut)}
.home .rowhead{display:flex;align-items:center;justify-content:space-between;gap:1rem}.home .rowhead h2{margin:1rem .4rem 0}
.home .badge-m{display:inline-grid;place-items:center;width:1.7rem;height:1.7rem;border-radius:50%;border:1px solid var(--rim);background:var(--field);color:var(--mut);flex:none}
.home .badge-m svg{width:.95rem;height:.95rem}.home .badge-m.beta{color:var(--acc)}.home .badge-m.experimental{color:color-mix(in oklab,#d9822b var(--flipp),#ffc27a)}
.home .glass{position:relative;min-width:0;border-radius:22px;overflow:hidden;color:var(--ink);background:var(--paper);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge)}
/* Tiles are solid, not blurred glass: thirty blurs over a moving sky is what made a phone stutter. */
.home .game,.home .recent .glass{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--tile)}
.home .shot{position:relative;display:block;width:100%;aspect-ratio:16/9;max-width:100%;overflow:hidden;background:color-mix(in oklab,var(--ink) 6%,transparent)}
.home .shot img,.home .shot .art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .5s}
.home .play{position:relative;z-index:2;display:inline-flex;align-items:center;gap:.35rem;flex:none;white-space:nowrap;font-size:.9rem;font-weight:500;color:var(--onacc);
 padding:.5rem 1rem;border-radius:999px;background:var(--acc);text-decoration:none;transition:filter .2s}
.home .play:hover{filter:brightness(1.08)}.home .play svg{width:.9rem;height:.9rem}
.home .play.ghost{color:var(--ink);background:var(--field);border:1px solid var(--rim)}
.home .play.icon{width:2.75rem;height:2.75rem;padding:0;justify-content:center}
.home .kick{font-size:.68rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);min-height:1em}
.home .title{color:inherit;text-decoration:none}.home .title:after{content:"";position:absolute;inset:0;z-index:1}
.home .glass:has(.title:focus-visible){outline:2px solid var(--acc);outline-offset:3px}.home .title:focus-visible{outline:none}
.home .tally{display:inline-flex;align-items:center;gap:.25rem;padding:.1rem .45rem;border-radius:999px;border:1px solid var(--rim);color:var(--ink);opacity:.8;font-size:.74rem;font-variant-numeric:tabular-nums}
.home .tally svg{width:.75rem;height:.75rem}
/* The big one: the featured game you played last, its screenshot beside its words. */
.home .feature{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}
.home .feature .shot{aspect-ratio:auto;min-height:18rem}
.home .feature .cap{display:grid;align-content:center;gap:.7rem;padding:1.6rem 1.8rem}
.home .feature b{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:2.4rem;line-height:1.05;letter-spacing:-.03em;text-wrap:balance}
.home .feature .blurb{font-size:1.05rem;line-height:1.45;opacity:.85;text-wrap:pretty}
.home .feature .facts{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;color:var(--mut);font-size:.82rem}
/* Pick up where you left off: the last few you played, a small picture and a Play button each. */
.home .recent{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:.8rem}
.home .recent .glass{display:flex;align-items:center;gap:.8rem;padding:.6rem .8rem .6rem .6rem}
.home .recent .shot{width:5.5rem;flex:none;border-radius:12px}
.home .recent span.w{display:grid;min-width:0;flex:1}.home .recent b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .recent small{color:var(--mut);font-size:.78rem;white-space:nowrap}
/* A shelf: a genre's games as screenshot tiles, as many across as the width holds. */
.home .shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.9rem}
.home .game{display:grid;transition:transform .18s,box-shadow .18s,border-color .18s}
.home .game:active,.home .recent .glass:active{transform:scale(.97)}
.home .game .cap{display:grid;gap:.25rem;padding:.75rem .9rem .85rem}
.home .game .name{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.home .game b{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:1.1rem;line-height:1.15;letter-spacing:-.02em;min-width:0}
.home .game small{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .5rem;white-space:nowrap;color:var(--mut);font-size:.76rem;font-variant-numeric:tabular-nums}
.home .game:focus-within{border-color:color-mix(in oklab,var(--acc) 60%,transparent)}
@media(hover:hover){.home .game:hover{transform:translateY(-3px);border-color:color-mix(in oklab,var(--acc) 60%,transparent);box-shadow:0 26px 44px -22px rgba(0,0,0,.55),inset 0 1px 0 var(--edge)}
 .home .game:hover .shot img,.home .game:hover .shot .art{transform:scale(1.04)}}
/* Your party, friends and spaces: a column on the right when it's wide, a row you swipe under your games when it isn't. */
.home .lib{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"main" "side" "shelves";gap:1rem;min-width:0}
.home .lib>.main,.home .lib>.shelves{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem;min-width:0}.home .lib>.main{grid-area:main}.home .lib>.shelves{grid-area:shelves}
.home .side{grid-area:side;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(15rem,1fr);gap:.8rem;align-items:start;min-width:0;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x mandatory}
.home .side::-webkit-scrollbar{display:none}.home .side>*{scroll-snap-align:start}
.home .rail{display:grid;gap:.4rem;padding:1rem 1.1rem;align-content:start;min-width:0}
.home .rail h2{margin:0 0 .3rem;display:flex;align-items:center;gap:.45rem}.home .rail h2 svg{width:1.05rem;height:1.05rem;flex:none;color:var(--mut)}
.home .party{border-color:color-mix(in oklab,var(--acc) 55%,transparent)}
.home .party .code{font:600 1.35rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em}
.home .rail .seats{display:flex;flex-wrap:wrap;gap:.4rem}
.home .rail .seats li{position:relative;display:grid;place-items:center;width:2.1rem;height:2.1rem;padding:0;border-radius:50%;background:var(--field);border:1px solid var(--rim);font:500 .78rem Lexend,system-ui,sans-serif;text-transform:uppercase}
.home .rail .seats li.ready{box-shadow:0 0 0 2px #3fb871}
.home .rail .seats li svg{position:absolute;right:-4px;bottom:-4px;width:.85rem;height:.85rem;padding:1px;border-radius:50%;background:#3fb871;color:#fff}
.home .rail .seats li.open{border-style:dashed;color:var(--mut)}
.home .rail .spaces li{padding:0}.home .rail .spaces a{display:flex;align-items:center;gap:.5rem;width:100%;min-width:0;padding:.45rem .55rem;border-radius:.6rem;color:var(--ink);text-decoration:none;border:1px solid var(--rim)}
.home .rail .spaces a:hover{background:var(--field)}.home .rail .spaces svg{width:.95rem;height:.95rem;flex:none;color:var(--mut)}
.home .rail .spaces b{flex:1}.home .rail .spaces small.on{color:#3fb871}
.home .rail ul{list-style:none;margin:0;padding:0;display:grid;gap:.15rem}
.home .rail li{display:flex;align-items:center;gap:.7rem;padding:.4rem 0;min-width:0}
.home .rail li i{position:relative;flex:none;display:grid;place-items:center;width:2.1rem;height:2.1rem;border-radius:50%;background:var(--field);border:1px solid var(--rim);font:500 .9rem Lexend,system-ui,sans-serif;font-style:normal;text-transform:uppercase}
.home .rail li i:after{content:"";position:absolute;right:-2px;bottom:-2px;width:.65rem;height:.65rem;border-radius:50%;background:var(--mut);border:2px solid var(--paper)}
.home .rail li.on i:after{background:#3fb871}
.home .rail li span{display:grid;min-width:0}.home .rail li b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .rail li small{color:var(--mut);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .rail>a{font-size:.85rem}
@media(prefers-reduced-motion:reduce){.home .game,.home .shot img,.home .shot .art{transition:none}}
.home .tabs{display:flex;gap:.25rem;flex-wrap:wrap;padding:.35rem;border-radius:18px;background:var(--paper);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:inset 0 1px 0 var(--edge)}
.home .tabs a{position:relative;display:inline-flex;align-items:center;gap:.6rem;min-height:2.75rem;padding:.4rem .9rem;border-radius:13px;color:var(--mut);text-decoration:none;font-weight:500;transition:background .15s,color .15s}
.home .tabs a svg{width:1.2rem;height:1.2rem;flex:none}
.home .tabs a:hover{color:var(--ink)}.home .tabs a:active{background:color-mix(in oklab,var(--ink) 8%,transparent)}
.home .tabs a[aria-current]{color:var(--ink);background:color-mix(in oklab,var(--acc) 20%,transparent)}.home .tabs a[aria-current] svg{color:var(--acc)}
.home .tabs em{font-style:normal;font-size:.72rem;font-weight:600;min-width:1.2rem;padding:.05rem .35rem;border-radius:999px;background:#e5484d;color:#fff;text-align:center}
/* Wide: the menu becomes a column on the left that stays put, and the friends a column on the right. */
@media(min-width:68rem){.home{grid-template-columns:15rem minmax(0,1fr)}
 .home .menu{position:sticky;top:1.5rem}.home .top{padding:1.4rem 1.2rem}.home .top h1{font-size:1.8rem}
 .home .tabs{flex-direction:column}.home .tabs em{margin-left:auto}}
@media(min-width:84rem){.home .lib{grid-template-columns:minmax(0,1fr) 17rem;grid-template-areas:"main side" "shelves side"}
 .home .side{grid-row:1/span 2;grid-auto-flow:row;grid-auto-columns:auto;align-content:start;align-self:start;overflow:visible;position:sticky;top:4.5rem;margin-top:3rem}}
@media(max-width:52rem){.home .feature{grid-template-columns:minmax(0,1fr)}.home .feature .shot{aspect-ratio:16/9;min-height:0}.home .feature .cap{padding:1.1rem 1.2rem 1.3rem}.home .feature b{font-size:1.9rem}}
.home .trophies{display:grid;gap:.6rem}
.home .trophies header{display:flex;align-items:baseline;gap:.6rem;margin-bottom:.7rem}.home .trophies header b{flex:1;font-family:Lexend,system-ui,sans-serif;font-weight:600}
.home .trophies meter{width:100%;height:.4rem;margin:-.3rem 0 .8rem}
.home .badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem}
.home .badge{display:grid;grid-template-columns:2.2rem minmax(0,1fr);gap:.2rem .7rem;align-items:center;padding:.6rem .7rem;border-radius:14px;border:1px solid var(--rim)}
.home .badge svg{grid-row:span 2;width:2.2rem;height:2.2rem;padding:.45rem;border-radius:50%;background:var(--acc);color:var(--onacc)}
.home .badge.locked{opacity:.55}.home .badge.locked svg{background:none;color:var(--mut);border:1px dashed var(--rim)}
.home .badge .glyph{font:700 15px ui-monospace,SFMono-Regular,Menlo,monospace;fill:currentColor}.home .badge b{font-weight:500}.home .badge span{font-size:.8rem;color:var(--mut)}
.home .roster{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.5rem}
.home .roster>div{display:flex;align-items:baseline;gap:.5rem;padding:.6rem .8rem;border-radius:14px;background:var(--paper);border:1px solid var(--rim)}
.home .roster b{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home .roster span{font-size:.72rem}.home .roster em{font-style:normal;font-variant-numeric:tabular-nums}
.home .danger{margin-top:2.5rem;opacity:.85}.home .danger summary{cursor:pointer;color:var(--mut)}
.home .card{padding:1.1rem 1.25rem;border-radius:20px;background:var(--paper);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge)}
.home .card+.card{margin-top:.6rem}
.home .row input{flex:1;min-width:10rem}
.home .link{display:grid;gap:.4rem;min-width:min(100%,16rem)}.home .link input{width:100%;font-family:ui-monospace,monospace;font-size:.82rem}
.home .list>div{padding:.55rem 0}.home .list>div+div{border-top-color:var(--rim)}
.home table td,.home table th{border-bottom-color:var(--rim)}.home table th{color:var(--mut)}
.home a{color:var(--acc)}
/* A phone: the tabs are a bar along the bottom under your thumb, a big Play, and each shelf a row you swipe. */
@media(max-width:40rem){.home{padding-top:2.6rem;padding-bottom:calc(5rem + env(safe-area-inset-bottom))}
 .home .top{padding:1.1rem 1.2rem 1.2rem;gap:.7rem}.home .top h1{font-size:1.75rem}
 .home .tabs{position:fixed;z-index:6;left:0;right:0;bottom:0;flex-wrap:nowrap;gap:0;overflow-x:auto;scrollbar-width:none;border-radius:0;border-width:1px 0 0;
  padding:.3rem max(.3rem,env(safe-area-inset-right)) calc(.3rem + env(safe-area-inset-bottom)) max(.3rem,env(safe-area-inset-left))}
 .home .tabs::-webkit-scrollbar{display:none}
 .home .tabs a{flex:1 0 3.8rem;flex-direction:column;justify-content:center;gap:.2rem;min-height:3.2rem;padding:.3rem .2rem;font-size:.68rem;letter-spacing:.01em}
 .home .tabs a svg{width:1.45rem;height:1.45rem}
 .home .tabs a[aria-current]{background:none}
 .home .tabs em{position:absolute;top:.15rem;left:calc(50% + .3rem)}
 .home .feature .play{display:flex;justify-content:center;min-height:3.2rem;font-size:1.1rem}
 .home .side{grid-auto-columns:85%;margin:0 -1rem;padding:0 1rem;scroll-padding:0 1rem}
 .home .shelves .shelf{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:11rem;gap:.7rem;overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain;
  scroll-snap-type:x mandatory;margin:0 -1rem;padding:.1rem 1rem .4rem;scroll-padding:0 1rem}
 .home .shelves .shelf::-webkit-scrollbar{display:none}.home .shelves .shelf>*{scroll-snap-align:start}
 .home .game b{font-size:1rem}}
.home .range{display:flex;gap:.3rem;margin:0 .4rem}.home .range a{padding:.25rem .7rem;border-radius:999px;color:var(--mut);text-decoration:none;font-size:.82rem;border:1px solid var(--rim)}
.home .range a[aria-current]{color:var(--ink);border-color:color-mix(in oklab,var(--acc) 55%,transparent)}
.home .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.6rem}
.home .tiles .tile{display:grid;gap:.2rem;padding:.9rem 1.1rem}.home .tiles .tile b{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:2rem;line-height:1;font-variant-numeric:tabular-nums}
.home .tiles .tile span{font-size:.8rem;color:var(--mut)}.home .tiles .tile.hero{display:grid;border-color:color-mix(in oklab,var(--acc) 45%,var(--rim))}.home .tiles .tile.hero b{font-size:2.6rem}
.home .bars{display:flex;align-items:flex-end;gap:2px;height:8rem;border-bottom:1px solid var(--rim)}
.home .bars>div{flex:1;height:100%;display:flex;align-items:flex-end}.home .bars>div:hover i{opacity:.75}
.home .bars i{display:block;width:100%;min-height:2px;border-radius:4px 4px 0 0;background:var(--acc)}
.home .axis{display:flex;justify-content:space-between;font-size:.72rem;color:var(--mut);margin-top:.35rem;font-variant-numeric:tabular-nums}
.home .num{text-align:right;font-variant-numeric:tabular-nums}.home .ua{max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem}
.home.detail{width:min(100%,64rem);grid-template-columns:minmax(0,1fr)}.home.detail .shot{border-radius:16px}
.home .detail .pane,.home.detail .pane{display:grid;gap:1rem}
.home.detail h1{margin:0;font-size:2.2rem}
.spaces-page #spaces{min-width:0}.spaces-page .rb-spaces{max-height:none}
.home.detail .more{white-space:pre-line;line-height:1.6;text-wrap:pretty}.home.detail .facts{display:flex;flex-wrap:wrap;align-items:center;gap:.7rem;color:var(--mut);font-size:.85rem}
.home.detail .facts span{display:inline-flex;align-items:center;gap:.4rem}
/* One game's page: stacked on a phone; on a wide window the picture takes most of the width and the words sit beside it,
   with a margin either side left clear (a streamer's camera or chat sits there). */
.home.detail.game-page{width:min(100%,120rem)}
.game-page .words{display:grid;gap:1rem;align-content:center;min-width:0}
@media(min-width:60rem){.home.detail.game-page{padding-inline:clamp(0rem,6vw - 2rem,8rem)}
 .game-page .pane{grid-template-columns:minmax(0,1.7fr) minmax(19rem,1fr);gap:1.6rem 2.2rem;align-items:center;padding:1.6rem}
 .game-page .pane .shot{aspect-ratio:16/9}.game-page .words{padding-right:.6rem}.home.detail.game-page h1{font-size:clamp(2.2rem,1rem + 2vw,3.4rem)}}
.home .back{display:inline-flex;align-items:center;gap:.4rem;color:var(--ink);text-decoration:none;font-size:.9rem;opacity:.85}
`;

const Out = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg>;

const Trophy = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>;
const Lock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;

/** An achievement's badge: its lucide icon, a letter in the console font ("A" for alpha), or the trophy. */
const Mark = ({ icon }: { icon: Achievement["icon"] }) => typeof icon === "string"
  ? <svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="13" textAnchor="middle" dominantBaseline="central" className="glyph">{icon}</text></svg>
  : icon ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}</svg>
  : <Trophy />;
const iconOf = (app: string | QApp, id: string) => catalogOf(app).find((a) => a.id === id)?.icon;

/** [earned, all] for a game with achievements, or null. */
const tally = (app: QApp, unlocks: Unlocks): [number, number] | null => {
  const list = catalogOf(app), got = unlocks.get(app.id);
  return list.length ? [list.filter((a) => got?.has(a.id)).length, list.length] : null;
};

/** Every game's achievements, the ones the person has lit up and the rest locked (a secret one says nothing until then): ours, then
 * each listed studio's game they have played. */
function Achievements({ apps, unlocks }: { apps: QApp[]; unlocks: Unlocks }) {
  const theirs = apps.filter((a) => isListing(a) && unlocks.has(a.id));
  return (
    <div className="trophies">
      {[...Object.keys(ACHIEVEMENTS), ...theirs].map((app) => {
        const id = typeof app === "string" ? app : app.id, list = shownFor(app, unlocks.get(id)), got = list.filter((a) => a.at !== null).length;
        return (
          <section key={id} className="card">
            <header><b>{typeof app === "string" ? nameOf(id) : app.name}</b><span className="mut">{got} of {list.length}</span></header>
            <meter min={0} max={list.length} value={got} />
            <div className="badges">
              {list.map((a) => (
                <div key={a.id} className={a.at === null ? "badge locked" : "badge"} title={a.at === null ? "Locked" : `Unlocked ${day(a.at)}`}>
                  {a.at === null && a.secret ? <Lock /> : <Mark icon={iconOf(app, a.id)} />}<b>{a.name}</b><span>{a.blurb}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** When, the way a kid would say it: today, yesterday, 3 days ago, or the day of the month. */
export const ago = (t: number, now = Date.now()) => {
  const d = Math.floor((now - t) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const ctaOf = (app: QApp, c = cardFor(app)) => c.cta || (app.kind === "game" ? "Play it" : "Open it");
/** When you last played it, or nothing when you never have (a shelf of "not played yet" is just noise). */
const whatOf = (app: QApp, mine: Member["apps"][number] | undefined) => app.soon ? "Coming soon" : mine ? `${app.kind === "game" ? "Played" : "Opened"} ${ago(mine.last_at)}` : null;

type Used = Member["apps"][number] | undefined;

/** An app's screenshot (public/cards/<id>.jpg), or its drawn key art when it has none. */
const Shot = ({ app, eager }: { app: QApp; eager?: boolean }) => (
  <span className="shot">{app.shot ? <img src={`/cards/${app.id}.jpg`} alt="" width={640} height={360} loading={eager ? undefined : "lazy"} fetchPriority={eager ? "high" : undefined} decoding="async" draggable={false} /> : <Art id={app.id} />}</span>
);
const PlayLink = ({ app, small }: { app: QApp; small?: boolean }) => { const url = playOf(app); return url ? (small
  ? <a className="play ghost icon" href={url} title={ctaOf(app)} aria-label={`${ctaOf(app)}: ${cardFor(app).name}`}><Out /></a>
  : <a className="play" href={url}>{ctaOf(app)} <Out /></a>) : null; };

/** The big one at the top: its screenshot, kicker, name, line, badge and Play. */
function Feature({ app, mine, unlocks }: { app: QApp; mine: Used; unlocks: Unlocks }) {
  const c = cardFor(app), t = tally(app, unlocks);
  return (
    <section className="glass feature" aria-label="Featured">
      <Shot app={app} eager />
      <span className="cap">
        {c.kicker && <span className="kick">{c.kicker}</span>}
        <b><a className="title" href={`/app/${app.id}`}>{c.name}</a></b>
        <span className="blurb">{c.blurb}</span>
        <span className="facts"><Badge m={app.maturity ?? "alpha"} />{whatOf(app, mine) && <span>{whatOf(app, mine)}</span>}{t && <span className="tally"><Trophy />{t[0]}/{t[1]}</span>}</span>
        <span><PlayLink app={app} /></span>
      </span>
    </section>
  );
}

/** One app on a shelf: its screenshot, name, badge and when you last played. The tile opens the app's page. */
function Tile({ app, mine, unlocks }: { app: QApp; mine: Used; unlocks: Unlocks }) {
  const c = cardFor(app), t = tally(app, unlocks);
  return (
    <div className="glass game">
      <Shot app={app} />
      <span className="cap">
        <span className="name"><b><a className="title" href={`/app/${app.id}`}>{c.name}</a></b><Badge m={app.maturity ?? "alpha"} /></span>
        {(byOf(app) || whatOf(app, mine) || t) && <small>{byOf(app)}{whatOf(app, mine)}{t && <span className="tally"><Trophy />{t[0]}/{t[1]}</span>}</small>}
      </span>
    </div>
  );
}

const Icon = ({ d }: { d: string[] }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p) => <path key={p} d={p} />)}</svg>;
// lucide: users, door-open, hash, check.
const USERS = ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"];
const DOOR = ["M13 4h3a2 2 0 0 1 2 2v14", "M2 20h3", "M13 20h9", "M10 12v.01", "M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"];
const HASH = ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"];
const CHECK = ["M20 6 9 17l-5-5"];

/** The party you are in now: its room code, a seat a member (ringed when ready), an open seat while there's room, and how many are ready. */
function PartyCard({ party }: { party: NonNullable<Side["party"]> }) {
  const ready = party.members.filter((m) => m.ready).length;
  return (
    <section className="glass rail party" aria-label="Your party">
      <h2><Icon d={DOOR} />Your party</h2>
      <span className="code" title="Room code">{party.code}</span>
      <ul className="seats">
        {party.members.map((m) => <li key={m.id} className={m.ready ? "ready" : undefined} title={`${m.name}${m.host ? ", host" : ""}${m.ready ? ", ready" : ""}`}>{m.name.slice(0, 2)}{m.ready && <Icon d={CHECK} />}</li>)}
        {party.members.length < party.size && <li className="open" title="An open seat">+</li>}
      </ul>
      <small>{nameOf(party.app)}. {ready} of {party.members.length} ready.</small>
    </section>
  );
}

/** Your spaces, the first few by name, with how many are in each now; each opens on /spaces. */
function Spaces({ side }: { side: Side }) {
  return (
    <section className="glass rail" aria-label="Your spaces">
      <h2><Icon d={HASH} />Your spaces</h2>
      {side.spaces.length === 0 ? <span className="mut">None yet. A space is a group that lasts between games.</span> : (
        <ul className="spaces">{side.spaces.map((sp) => (
          <li key={sp.id}><a href={`/spaces?open=${sp.id}`}><Icon d={HASH} /><b>{sp.name}</b>{sp.on !== null && <small className={sp.on ? "on" : undefined}>{sp.on} on</small>}</a></li>
        ))}</ul>
      )}
      <a href="/spaces">{side.more ? `All spaces (${side.more} more)` : side.spaces.length ? "All spaces" : "Make or join a space"}</a>
    </section>
  );
}

/** Who of your friends is on, and in which game; the rest below them. */
function Online({ hub }: { hub: HubState }) {
  const friends = [...hub.friends].sort((a, b) => b.presence.length - a.presence.length), asked = hub.incoming.length;
  return (
    <section className="glass rail" aria-label="Friends">
      <h2><Icon d={USERS} />Friends<em>{friends.filter((f) => f.presence.length).length} on</em></h2>
      {friends.length === 0 ? <span className="mut">Nobody yet.</span> : (
        <ul>{friends.slice(0, 12).map((f) => (
          <li key={f.id} className={f.presence.length ? "on" : undefined}><i>{f.name.slice(0, 1)}</i><span><b>{f.name}</b><small>{f.presence.length ? where(f) : "off"}</small></span></li>
        ))}</ul>
      )}
      <a href="/?tab=friends">{asked ? `${asked} asking to be friends` : friends.length ? "All friends" : "Ask a friend"}</a>
    </section>
  );
}

/** The column beside the library: your party while you're in one, then friends, then your spaces. */
function SidePanel({ hub, side }: { hub: HubState | null; side: Side | null }) {
  if (!hub && !side) return null;
  return (
    <aside className="side">
      {side?.party && <PartyCard party={side.party} />}
      {hub && <Online hub={hub} />}
      {side && <Spaces side={side} />}
    </aside>
  );
}

/** Home: the featured game you played last up top, the ones you played last, then a shelf a genre (yours first, most recent first), friends beside. */
function Library({ apps, mine, unlocks, hub, side }: { apps: QApp[]; mine: Member | undefined; unlocks: Unlocks; hub: HubState | null; side: Side | null }) {
  const used = new Map(mine?.apps.map((a) => [a.app, a]));
  const recent = (a: QApp) => used.get(a.id)?.last_at ?? -1;
  const sorted = (list: QApp[]) => [...list].sort((a, b) => recent(b) - recent(a));
  const top = sorted(apps.filter((a) => a.featured))[0] ?? apps[0]!;
  const last = sorted(apps.filter((a) => used.has(a.id) && a.id !== top.id)).slice(0, 4);
  return (
    <div className="lib">
      <div className="main">
        <Feature app={top} mine={used.get(top.id)} unlocks={unlocks} />
        {last.length > 0 && (
          <section aria-label="Pick up where you left off">
            <h2>Pick up where you left off</h2>
            <div className="recent">{last.map((a) => (
              <div key={a.id} className="glass"><Shot app={a} /><span className="w"><b><a className="title" href={`/app/${a.id}`}>{cardFor(a).name}</a></b><small>{whatOf(a, used.get(a.id))}</small></span><PlayLink app={a} small /></div>
            ))}</div>
          </section>
        )}
      </div>
      <SidePanel hub={hub} side={side} />
      <div className="shelves">
        {GENRES.map((g) => {
          const list = sorted(apps.filter((a) => a.genre === g));
          return list.length ? (
            <section key={g} aria-label={g}>
              <h2>{g}<em>{list.length}</em></h2>
              <div className="shelf">{list.map((a) => <Tile key={a.id} app={a} mine={used.get(a.id)} unlocks={unlocks} />)}</div>
            </section>
          ) : null;
        })}
      </div>
    </div>
  );
}

/** Your spaces: the panel a game opens (spaces.client.ts mounts it in #spaces), on the sky. */
export function SpacesPage({ t0 }: { t0: number }) {
  return (
    <Glass t0={t0} css={HOME_CSS}>
      <div className="home detail spaces-page">
        <a className="back" href="/">&larr; Home</a>
        <section className="pane">
          <h1>Your spaces</h1>
          <p className="mut">A space is a group that lasts between games, with channels. Make one, or join one with its invite.</p>
          <div id="spaces" aria-label="Your spaces"><span className="mut">Loading your spaces.</span></div>
        </section>
      </div>
    </Glass>
  );
}

/** The streaming-service page for one app: big picture, the long words, its badge, Play it. */
export function AppPage({ app, mine, unlocks, t0 }: { app: QApp; mine: Member["apps"][number] | undefined; unlocks: Unlocks; t0: number }) {
  const c = cardFor(app), t = tally(app, unlocks), m = app.maturity ?? "alpha", url = playOf(app);
  return (
    <Glass t0={t0} css={HOME_CSS}>
      <div className="home detail game-page">
        <a className="back" href="/">&larr; Library</a>
        <section className="pane">
          <span className="shot">{app.shot ? <img src={`/cards/${app.id}.jpg`} alt="" /> : <Art id={app.id} />}</span>
          <div className="words">
          {c.kicker && <span className="kick">{c.kicker}</span>}
          <h1>{c.name}</h1>
          <div className="facts"><Badge m={m} /><span>{m}</span><span>{app.genre}</span><span>{whatOf(app, mine) ?? "New to you"}</span>{t && <span className="tally"><Trophy />{t[0]}/{t[1]} achievements</span>}</div>
          <p className="blurb">{c.blurb}</p>
          {c.more && <p className="more">{c.more}</p>}
          <div className="row">{url ? <a className="play" href={url}>{ctaOf(app, c)} <Out /></a> : <span className="mut">{app.soon ? "Coming soon." : "Not open yet."}</span>}</div>
          </div>
        </section>
      </div>
    </Glass>
  );
}

// lucide: house, trophy, users, building, contact, chart-column, gauge, circle-user.
const TABS = [
  ["library", "Home", ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]],
  ["achievements", "Trophies", ["M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2", "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2", "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3", "M4 22h16", "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z", "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"]],
  ["friends", "Friends", USERS],
  ["studio", "Studio", ["M12 10h.01", "M12 14h.01", "M12 6h.01", "M16 10h.01", "M16 14h.01", "M16 6h.01", "M8 10h.01", "M8 14h.01", "M8 6h.01", "M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3", "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"]],
  ["people", "People", ["M16 2v2", "M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2", "M8 2v2", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"]],
  ["visitors", "Visitors", ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"]],
  ["scale", "Scale", ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"]],
  ["account", "Me", ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"]],
] as const;
const ADMIN_TABS = new Set<string>(["people", "visitors", "scale"]);

const KIND: Record<string, string> = { person: "browser", agent: "agent", bot: "bot" };
const short = (t: number) => new Date(t).toISOString().slice(5, 10);

/** The super admin's view of who is coming (visitors.ts): real people first, then every browser, agents and bots, by site and by day. */
function Visitors({ v }: { v: Counts }) {
  const top = Math.max(1, ...v.by_day.map((d) => d.real));
  const errRate = v.health.hits ? v.health.errors / v.health.hits : 0;
  return (
    <>
      <div className="rowhead">
        <h2>Visitors<em>last {v.days === 1 ? "day" : `${v.days} days`}</em></h2>
        <nav className="range" aria-label="Range">{[1, 7, 30].map((d) => <a key={d} href={`/?tab=visitors&days=${d}`} aria-current={d === v.days ? "page" : undefined}>{d === 1 ? "Today" : `${d} days`}</a>)}</nav>
      </div>
      <div className="tiles">
        <div className="card tile hero"><b>{v.totals.real}</b><span>real people: a browser that tapped, typed or scrolled</span></div>
        <div className="card tile"><b>{v.totals.browsers}</b><span>browsers in all</span></div>
        <div className="card tile"><b>{v.totals.agents}</b><span>agents and scripts</span></div>
        <div className="card tile"><b>{v.totals.bots}</b><span>bots that say so</span></div>
        <div className="card tile"><b>{v.signups}</b><span>new accounts</span></div>
      </div>
      {v.days > 1 && (
        <div className="card">
          <div className="mut" style={{ fontSize: ".85rem", marginBottom: ".6rem" }}>Real people a day <span style={{ float: "right" }}>most {top}</span></div>
          <div className="bars" role="img" aria-label={`Real people a day: ${v.by_day.map((d) => `${short(d.day)} ${d.real}`).join(", ")}`}>
            {v.by_day.map((d) => (
              <div key={d.day} title={`${short(d.day)}: ${d.real} real of ${d.browsers} browsers, ${d.agents} agents, ${d.bots} bots`}>
                <i style={{ height: `${(d.real / top) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="axis"><span>{short(v.by_day[0]!.day)}</span><span>today</span></div>
        </div>
      )}
      <h2>By site</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {v.sites.length === 0 ? <span className="mut">Nobody yet.</span> : (
          <table>
            <thead><tr><th>Site</th><th className="num">Real</th><th className="num">Browsers</th><th className="num">Agents</th><th className="num">Bots</th><th className="num">Requests</th></tr></thead>
            <tbody>{v.sites.map((s) => <tr key={s.site}><td>{s.name}</td><td className="num"><b>{s.real}</b></td><td className="num">{s.browsers}</td><td className="num">{s.agents}</td><td className="num">{s.bots}</td><td className="num mut">{s.hits}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {v.refs.length > 0 && (
        <>
          <h2>Where real people came from</h2>
          <div className="roster">{v.refs.map((r) => <div key={r.ref}><b>{r.ref}</b><em>{r.real}</em></div>)}</div>
        </>
      )}
      <h2>Health<em>last day</em></h2>
      <div className="tiles">
        <div className="card tile"><b>{v.health.db_ms} ms</b><span>database answer</span></div>
        <div className="card tile"><b>{v.health.errors}</b><span>server errors in {v.health.hits} requests{errRate > 0.02 ? " (high)" : ""}</span></div>
      </div>
      <h2>The last day's callers</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {v.recent.length === 0 ? <span className="mut">Nobody in the last day.</span> : (
          <table>
            <thead><tr><th>Last seen</th><th>Site</th><th>Looks like</th><th className="num">Requests</th><th className="num">Taps</th><th>Browser</th></tr></thead>
            <tbody>{v.recent.map((c) => (
              <tr key={`${c.who} ${c.site} ${c.kind} ${c.via}`}>
                <td className="mut">{when(c.last_at).slice(11)}</td><td>{c.site === "eqosys" ? "eqosys" : nameOf(c.site)}</td>
                <td>{c.kind === "person" && c.engaged > 0 ? <b>person</b> : KIND[c.kind] ?? c.kind}<div className="mut">{c.via}{c.ref ? ` · from ${c.ref}` : ""}</div></td>
                <td className="num">{c.hits}</td><td className="num">{c.engaged}</td><td className="ua mut" title={c.ua ?? ""}>{c.ua ?? "none"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="mut" style={{ margin: "0 .4rem", fontSize: ".8rem" }}>Each caller is a code made from the address and browser, new every day; no address is kept, and your own visits are left out.</p>
    </>
  );
}
export type Tab = (typeof TABS)[number][0];
export const tabOf = (v: unknown): Tab => TABS.find(([k]) => k === v)?.[0] ?? "library";

export function Home({ apps = APPS, me, mine, hub, side, everyone, unlocks, counts, error, t0, tab, visitors, scale, studios, invite, origin = "", ways, social = [] }: { /** The Account tab: how they sign in now, and the providers switched on here. */ ways?: Way[] | null; social?: string[]; invite?: { id: string; name: string } | null; origin?: string; apps?: QApp[]; side?: Side | null; visitors?: Counts | null; scale?: Load | null; studios?: Studio[] | null; counts: Map<string, number>; me: Me; mine: Member | undefined; hub: HubState | null; everyone: Member[] | null; unlocks: Unlocks; error?: string; t0: number; tab: Tab }) {
    const tabs = TABS.filter(([k]) => !ADMIN_TABS.has(k) || everyone);
  const asked = hub?.incoming.length ?? 0;
  return (
    <Glass t0={t0} css={HOME_CSS + SCALE_CSS + STUDIO_CSS}>
      <div className="home">
        {/* The nav sits outside the glass pane: a blurred parent would pin a phone's fixed tab bar to itself instead of the screen. */}
        <div className="menu">
          <section className="pane top">
            <div className="brand"><span><i /><b>{NAME}</b></span><a className="avatar" href="/?tab=account" title={me.name || me.email} aria-label="Me">{(me.name || me.email).slice(0, 1)}</a></div>
            <h1>{greeting(t0)}</h1>
            {messageOf(error) && <p className="bad" role="alert">{messageOf(error)}</p>}
          </section>
          <nav className="tabs" aria-label="eqosys">
            {tabs.map(([k, label, d]) => <a key={k} href={k === "library" ? "/" : `/?tab=${k}`} aria-current={k === tab ? "page" : undefined}><Icon d={[...d]} /><span>{label}</span>{k === "friends" && asked > 0 && <em aria-label={`${asked} asking`}>{asked}</em>}</a>)}
          </nav>
        </div>

        <div className="body">
        {tab === "library" && <Library apps={apps} mine={mine} unlocks={unlocks} hub={hub} side={side ?? null} />}

        {tab === "achievements" && <><h2>Achievements</h2><Achievements apps={apps} unlocks={unlocks} /></>}

        {tab === "friends" && (hub ? <Friends hub={hub} counts={counts} invite={invite} origin={origin} /> : <p className="card mut">{MESSAGES.nohub}</p>)}

        {tab === "studio" && studios && <Studios studios={studios} unlocks={unlocks} />}

        {tab === "people" && everyone && (
          <>
            <h2>Roster</h2>
            <div className="roster">
              {APPS.map((a) => (
                <div key={a.id}><b>{a.name}</b><span className="mut">{a.kind}</span><em>{everyone.filter((m) => m.apps.some((x) => x.app === a.id)).length}</em></div>
              ))}
            </div>
            <h2>Everyone ({everyone.length})</h2>
            <form className="row card" method="post" action="/do/grant">
              <input name="email" type="email" placeholder="their email" required />
              <select name="for_app">{APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <input name="role" placeholder="role, e.g. beta" required />
              <button className={btn(true)} type="submit">Grant</button>
              <button className={btn()} type="submit" formAction="/do/revoke">Take away</button>
            </form>
            <div className="card" style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Who</th><th>Came from</th><th>Apps and access</th></tr></thead>
                <tbody>
                  {everyone.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}<div className="mut">{m.email}</div></td>
                      <td>{nameOf(m.source)}<div className="mut">{day(m.created_at)}</div></td>
                      <td><AppsTable m={m} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "visitors" && everyone && visitors && <Visitors v={visitors} />}

        {tab === "scale" && everyone && scale && <Scale l={scale} />}

        {tab === "account" && (
          <>
            <h2>Account</h2>
            <div className="card me"><i>{(me.name || me.email).slice(0, 1)}</i><div><b>{me.name || me.email}</b><span>{me.email} · came in through {nameOf(mine?.source ?? "eqosys")}</span></div></div>
            {ways && <Ways ways={ways} social={social} />}
            <form method="post" action="/do/logout"><button className={btn()} type="submit">Sign out</button></form>
            <p><a href="/api/privacy/export" download>Download my data</a> <span className="mut">· everything eqosys keeps about you, as one file (<a href="/privacy">what and why</a>)</span></p>
            <p className="mut">{NAME} v{VERSION}</p>
            <details className="card danger">
              <summary>More options</summary>
              <p className="mut">Removing your account takes you out of every Q app. It asks twice more before anything happens.</p>
              <a href="/delete">Remove my account…</a>
            </details>
          </>
        )}
        </div>
      </div>
    </Glass>
  );
}

/** Delete my account, the page an app opens (/delete?app=<id>). Typing the email is the confirmation. */
export function DeletePage({ me, app, error, step }: { me: Me; app?: string; error?: string; step?: string }) {
  const keep = <p><a href="/?tab=account">Keep it</a></p>;
  if (step !== "2" && !error) return (
    <>
      <h1>Remove my account?</h1>
      <p>This removes <b>{me.email}</b> from every Q app: your sign-in, your access, your friends and your notifications. It can't be undone.</p>
      <form method="get" action="/delete"><input type="hidden" name="step" value="2" />{app && <input type="hidden" name="app" value={app} />}<button className={btn(true)} type="submit">Yes, keep going</button></form>
      {keep}
    </>
  );
  return (
    <>
      <h1>Type your email to confirm</h1>
      {messageOf(error) && <p className="bad">{messageOf(error)}</p>}
      <form className="card" method="post" action="/do/delete">
        {app && <input type="hidden" name="app" value={app} />}
        <p><input name="confirm" type="email" placeholder={me.email} autoComplete="off" required /></p>
        <button className={btn(true)} type="submit">Delete my account for good</button>
      </form>
      {keep}
    </>
  );
}

export function Deleted({ app }: { app?: string }) {
  const a = ourApp(app ?? ""), url = a && playOf(a);
  return <><h1>Account deleted</h1><p className="mut">Everything eqosys holds about you is gone.</p>{a && url && <p><a href={url}>Back to {a.name}</a></p>}</>;
}

/** The privacy policy every Q app links to (App Store Connect asks for one, and so does guideline 5.1.1(i)). Plain words, and true
 * to what eqosys keeps: "What we keep" is HOLDERS (privacy.ts), the same list the download is made from, so a new table goes there. */
export const Privacy = () => (
  <>
    <h1>Privacy</h1>
    <p className="mut">One account for every Q app, and only what that needs. Updated November 2026.</p>
    <h2>What we keep</h2>
    <ul>
      {HOLDERS.map((h) => <li key={h.id}><b>{h.what}.</b> {h.why}. <span className="mut">Kept {h.keep}; basis: {h.basis}.</span></li>)}
    </ul>
    <p className="mut">With Sign in with Apple you can hide your email; we only ever see Apple's relay address. Party chat lasts as long as the party.</p>
    <h2>A copy of it</h2>
    <p>Signed in, <a href="/api/privacy/export" download>download everything above</a> as one JSON file, any time. An app can fetch the same with your
      sign-in (<code>GET /api/privacy/export</code>).</p>
    <h2>What we don't do</h2>
    <ul>
      <li>No ads, no tracking across other companies' apps or sites, and nothing sold or shared for marketing.</li>
      <li>No email from us. The sign-in page loads its fonts from Google Fonts; nothing else leaves eqosys.</li>
      <li>Visits to eqosys and the Q sites are counted by a code made from the address and browser that changes every day, so nobody is
        followed from one day to the next and no address is kept. The counts go after 30 days.</li>
    </ul>
    <h2>Where it lives</h2>
    <p>On Cloudflare (Workers, D1 and Durable Objects), which runs eqosys for us. Each person also has a vault: the key their cloud saves are
      locked with, and a record of what they agreed to and asked for. If you first signed in from the EU, the EEA, the UK or Switzerland,
      your vault is kept in the EU, so your saves can only be opened there. Sign-in tokens from Apple, GitHub and Google are kept encrypted too.</p>
    <h2>Deleting it</h2>
    <p>Delete your account from any Q app's settings or at <a href="/delete">eqosys.qntbr.com/delete</a>. Everything above goes at once, every
      Q app that keeps data of its own is told to erase it, and a Sign in with Apple link is revoked at Apple. Your vault goes first, so any
      copy of your saves left in a backup can never be opened again.</p>
    <h2>If you're in the EU, the EEA, the UK or Switzerland</h2>
    <p>What is in place today: your vault (the key to your saves, and the record of what you agreed to and asked for) is kept in the EU; you can
      download everything we keep and delete it all yourself, any time, without asking anyone; and each thing you agree to is written down
      with the time, so you can see it in the download.</p>
    <p>What we are still working on: your account itself (email, name and sign-in links) sits in one database that is not kept in the EU. It
      is still only on Cloudflare and still goes when you delete your account. We will also name who is responsible for your data and a
      private contact for privacy requests here; until then, the ways below are the ones there are.</p>
    <h2>Questions</h2>
    <p>For your data, download and delete above need no one's help. For anything else, use Report in any Q app while signed in: it reaches us
      tied to your account, so we can find what is yours without you giving any details. Reports become issues on a public GitHub page (or, from a game
      another studio made, notes that studio reads) that name
      you only by a short id, so write the question, not your email or anything personal. Please don't open GitHub issues about your own data.</p>
  </>
);

const TITLES: Record<number, string> = { 404: "Nothing here.", 500: "Something broke on our side.", 503: "Sign-in is off right now." };
export const ErrorPage = ({ status }: { status: number }) => (
  <><h1>{status}</h1><p className="mut">{TITLES[status] ?? "That didn't work."}</p><p><a href="/">{NAME}</a></p></>
);

