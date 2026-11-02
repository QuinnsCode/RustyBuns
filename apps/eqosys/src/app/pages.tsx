import { APPS, appOf, type QApp } from "../apps.ts";
import type { Me } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Friend, HubState, Note } from "../hub.ts";
import type { Member } from "../members.ts";
import { Glass, greeting } from "./Glass.tsx";
import { Art } from "./Art.tsx";
import { ACHIEVEMENTS, shownFor } from "../achievements.ts";
import { cardOf } from "../cards.ts";

type Unlocks = Map<string, Map<string, number>>;

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
};

const nameOf = (id: string) => cardOf(id, appOf(id)?.name ?? id).name;

const day = (t: number) => (t ? new Date(t).toISOString().slice(0, 10) : "not yet");

function AppsTable({ m }: { m: Member }) {
  return m.apps.length === 0 ? <span className="mut">none yet</span> : (
    <>{m.apps.map((a) => <div key={a.app}>{nameOf(a.app)} <span className="mut">{a.access.join(", ") || "no access"} · {day(a.last_at)}</span></div>)}</>
  );
}

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** One button that posts an op on the person's own hub (handle.ts). */
const Act = ({ to, id, label, ghost }: { to: "accept" | "drop" | "clear"; id?: string; label: string; ghost?: boolean }) => (
  <form method="post" action={`/do/${to}`}>
    {id && <input type="hidden" name="id" value={id} />}
    <button className={ghost ? "ghost" : undefined} type="submit">{label}</button>
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

/** Friends, who is asking whom, and what friends' apps said: the person's hub (hub.ts), read on the way in. */
function Friends({ hub }: { hub: HubState }) {
  const nobody = hub.friends.length + hub.incoming.length + hub.outgoing.length === 0;
  return (
    <>
      <h2>Friends</h2>
      <form className="row card" method="post" action="/do/befriend">
        <input name="email" type="email" placeholder="a friend's email" required />
        <button type="submit">Ask to be friends</button>
      </form>
      <div className="card list">
        {nobody && <div><span className="mut">Nobody yet. Ask someone by their email.</span></div>}
        {hub.incoming.map((p) => (
          <div key={p.id}><b>{p.name}</b><span className="grow mut">wants to be friends</span><Act to="accept" id={p.id} label="Accept" /><Act to="drop" id={p.id} label="No thanks" ghost /></div>
        ))}
        {hub.friends.map((f) => (
          <div key={f.id}><b>{f.name}</b><span className="grow mut">{where(f)}</span><Act to="drop" id={f.id} label="Drop" ghost /></div>
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

// The home page: the same sky and glass as sign-in (Glass.tsx), a wider column, and every Q app as a card.
// One card component for games and suites (Card below); its words come from cards.json (cards.ts).
const HOME_CSS = `
.home{width:min(100%,64rem);margin:0 auto;display:grid;gap:1rem}
.home .top{display:grid;gap:1rem;padding:1.5rem 1.8rem 1.1rem}
.home .top .brand{margin:0;justify-content:space-between}
.home .top .brand span{display:flex;align-items:center;gap:.5rem}
.home .top h1{font-size:2.4rem}
.home .top .sub{margin:-.4rem 0 0;color:var(--mut);font-size:.95rem}
.home h2{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;margin:1rem .4rem 0;color:var(--ink);opacity:.8;
 text-shadow:0 1px 12px color-mix(in oklab,var(--paper) 90%,transparent)}
.home h2 em{font-style:normal;font-weight:400;opacity:.7;margin-left:.4rem;font-variant-numeric:tabular-nums}
.home .mut{color:var(--mut)}
.home .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(19rem,1fr));gap:.9rem}
.home .card-app{position:relative;display:flex;flex-direction:column;min-width:0;border-radius:22px;overflow:hidden;color:var(--ink);text-decoration:none;
 background:var(--paper);border:1px solid var(--rim);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);
 box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge);transition:transform .25s,box-shadow .25s,border-color .25s}
.home .card-app .shot{position:relative;aspect-ratio:16/9;overflow:hidden;margin:.45rem .45rem 0;border-radius:16px;background:color-mix(in oklab,var(--ink) 6%,transparent)}
.home .card-app .shot img,.home .card-app .shot .art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .5s}
.home .card-app .shot:after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--ink) 8%,transparent);border-radius:16px}
.home .card-app .cap{display:grid;gap:.3rem;padding:.9rem 1rem .4rem;min-width:0}
.home .card-app .kick{font-size:.68rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);min-height:1em}
.home .card-app b{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:1.3rem;line-height:1.1;letter-spacing:-.025em;text-wrap:balance}
.home .card-app .blurb{font-size:.9rem;line-height:1.4;opacity:.82;text-wrap:pretty}
.home .card-app .foot{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem 1rem .9rem;margin-top:auto}
.home .card-app .last{display:flex;align-items:center;gap:.5rem;font-size:.74rem;color:var(--mut);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .card-app .tally{display:inline-flex;align-items:center;gap:.25rem;padding:.1rem .45rem;border-radius:999px;border:1px solid var(--rim);color:var(--ink);opacity:.8}
.home .card-app .tally svg{width:.75rem;height:.75rem}
.home .card-app .play{display:inline-flex;align-items:center;gap:.35rem;flex:none;white-space:nowrap;font-size:.86rem;font-weight:500;color:var(--ink);padding:.42rem .85rem;border-radius:999px;border:1px solid var(--rim);background:var(--field);transition:background .2s,color .2s,border-color .2s}
.home .card-app .play svg{width:.9rem;height:.9rem;transition:transform .2s}
.home .card-app:hover,.home .card-app:focus-visible{transform:translateY(-3px);border-color:color-mix(in oklab,var(--acc) 60%,transparent);box-shadow:0 26px 44px -22px rgba(0,0,0,.55),inset 0 1px 0 var(--edge)}
.home .card-app:hover .shot img,.home .card-app:hover .shot .art{transform:scale(1.04)}
.home .card-app:hover .play,.home .card-app:focus-visible .play{background:var(--acc);color:var(--onacc);border-color:transparent}
.home .card-app:hover .play svg{transform:translate(2px,-2px)}
.home .card-app:focus-visible{outline:2px solid var(--acc);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.home .card-app,.home .card-app .shot img,.home .card-app .shot .art{transition:none}}
.home .tabs{display:flex;gap:.3rem;flex-wrap:wrap}
.home .tabs a{display:inline-flex;align-items:center;gap:.4rem;padding:.45rem .95rem;border-radius:999px;color:var(--mut);text-decoration:none;font-weight:500;border:1px solid transparent}
.home .tabs a:hover{color:var(--ink)}
.home .tabs a[aria-current]{color:var(--ink);background:color-mix(in oklab,var(--acc) 22%,transparent);border-color:color-mix(in oklab,var(--acc) 45%,transparent)}
.home .tabs em{font-style:normal;font-size:.72rem;padding:.05rem .4rem;border-radius:999px;background:var(--acc);color:var(--onacc)}
.home .trophies{display:grid;gap:.6rem}
.home .trophies header{display:flex;align-items:baseline;gap:.6rem;margin-bottom:.7rem}.home .trophies header b{flex:1;font-family:Lexend,system-ui,sans-serif;font-weight:600}
.home .trophies meter{width:100%;height:.4rem;margin:-.3rem 0 .8rem}
.home .badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem}
.home .badge{display:grid;grid-template-columns:2.2rem minmax(0,1fr);gap:.2rem .7rem;align-items:center;padding:.6rem .7rem;border-radius:14px;border:1px solid var(--rim)}
.home .badge svg{grid-row:span 2;width:2.2rem;height:2.2rem;padding:.45rem;border-radius:50%;background:var(--acc);color:var(--onacc)}
.home .badge.locked{opacity:.55}.home .badge.locked svg{background:none;color:var(--mut);border:1px dashed var(--rim)}
.home .badge b{font-weight:500}.home .badge span{font-size:.8rem;color:var(--mut)}
.home .roster{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.5rem}
.home .roster>div{display:flex;align-items:baseline;gap:.5rem;padding:.6rem .8rem;border-radius:14px;background:var(--paper);border:1px solid var(--rim)}
.home .roster b{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home .roster span{font-size:.72rem}.home .roster em{font-style:normal;font-variant-numeric:tabular-nums}
.home .danger{margin-top:2.5rem;opacity:.85}.home .danger summary{cursor:pointer;color:var(--mut)}
.home .card{padding:1.1rem 1.25rem;border-radius:20px;background:var(--paper);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge)}
.home .card+.card{margin-top:.6rem}
.home .row input{flex:1;min-width:10rem}
.home .list>div{padding:.55rem 0}.home .list>div+div{border-top-color:var(--rim)}
.home .list button{padding:.45rem .8rem;font-size:.9rem}
.home table td,.home table th{border-bottom-color:var(--rim)}.home table th{color:var(--mut)}
.home a{color:var(--acc)}
@media(max-width:40rem){.home{padding-top:2.4rem}.home .top{padding:1.3rem 1.2rem 1rem;gap:.8rem}.home .top h1{font-size:1.9rem}.home .top .sub{font-size:.88rem}
 .home .tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -1.2rem;padding:0 1.2rem}.home .tabs::-webkit-scrollbar{display:none}.home .tabs a{flex:none;padding:.4rem .8rem}
 .home .cards{grid-template-columns:1fr}}
`;

const Out = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg>;

const Trophy = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>;
const Lock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;

/** [earned, all] for a game with achievements, or null. */
const tally = (app: string, unlocks: Unlocks): [number, number] | null => {
  const all = ACHIEVEMENTS[app]?.length ?? 0;
  return all ? [[...(unlocks.get(app)?.keys() ?? [])].filter((id) => ACHIEVEMENTS[app]!.some((a) => a.id === id)).length, all] : null;
};

/** Every game's achievements, the ones the person has lit up and the rest locked (a secret one says nothing until then). */
function Achievements({ unlocks }: { unlocks: Unlocks }) {
  return (
    <div className="trophies">
      {Object.keys(ACHIEVEMENTS).map((id) => {
        const list = shownFor(id, unlocks.get(id)), got = list.filter((a) => a.at !== null).length;
        return (
          <section key={id} className="card">
            <header><b>{nameOf(id)}</b><span className="mut">{got} of {list.length}</span></header>
            <meter min={0} max={list.length} value={got} />
            <div className="badges">
              {list.map((a) => (
                <div key={a.id} className={a.at === null ? "badge locked" : "badge"} title={a.at === null ? "Locked" : `Unlocked ${day(a.at)}`}>
                  {a.at === null ? <Lock /> : <Trophy />}<b>{a.name}</b><span>{a.blurb}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One app as a card: its picture, its kicker, name and line (cards.json), when the person was last in, and the button. */
function Card({ app, mine, unlocks }: { app: QApp; mine: Member["apps"][number] | undefined; unlocks: Unlocks }) {
  const c = cardOf(app.id, app.name);
  const what = mine ? `${app.kind === "game" ? "played" : "opened"} ${day(mine.last_at)}` : app.kind === "game" ? "not played yet" : "not opened yet";
  const t = tally(app.id, unlocks);
  return (
    <a className="card-app" href={app.origins[0]} title={`${c.name}: ${what}${t ? `, ${t[0]} of ${t[1]} achievements` : ""}`}>
      <span className="shot">{app.shot ? <img src={`/cards/${app.id}.jpg`} alt="" loading="lazy" /> : <Art id={app.id} />}</span>
      <span className="cap">{c.kicker && <span className="kick">{c.kicker}</span>}<b>{c.name}</b><span className="blurb">{c.blurb}</span></span>
      <span className="foot"><span className="last">{what}{t && <span className="tally"><Trophy />{t[0]}/{t[1]}</span>}</span><span className="play">{c.cta || (app.kind === "game" ? "Play now" : "Open")} <Out /></span></span>
    </a>
  );
}

/** The apps of one kind as cards, the ones this person uses on top, most recent first. */
function Cards({ kind, mine, unlocks }: { kind: QApp["kind"]; mine: Member | undefined; unlocks: Unlocks }) {
  const used = new Map(mine?.apps.map((a) => [a.app, a]));
  const list = APPS.filter((a) => a.kind === kind).sort((a, b) => (used.get(b.id)?.last_at ?? -1) - (used.get(a.id)?.last_at ?? -1));
  return <div className="cards">{list.map((a) => <Card key={a.id} app={a} mine={used.get(a.id)} unlocks={unlocks} />)}</div>;
}

const TABS = [["library", "Library"], ["achievements", "Achievements"], ["friends", "Friends"], ["people", "People"], ["account", "Account"]] as const;
export type Tab = (typeof TABS)[number][0];
export const tabOf = (v: unknown): Tab => TABS.find(([k]) => k === v)?.[0] ?? "library";

export function Home({ me, mine, hub, everyone, unlocks, error, t0, tab }: { me: Me; mine: Member | undefined; hub: HubState | null; everyone: Member[] | null; unlocks: Unlocks; error?: string; t0: number; tab: Tab }) {
  const games = APPS.filter((a) => a.kind === "game").length, suites = APPS.length - games;
  const tabs = TABS.filter(([k]) => k !== "people" || everyone);
  const asked = hub?.incoming.length ?? 0;
  return (
    <Glass t0={t0} css={HOME_CSS}>
      <div className="home">
        <section className="pane top">
          <div className="brand"><span><i /><b>{NAME}</b></span><span className="mut">v{VERSION}</span></div>
          <h1>{greeting(t0)}</h1>
          <p className="sub">{me.name || me.email} · {games} games and {suites} suites, one account.</p>
          {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
          <nav className="tabs" aria-label="eqosys">
            {tabs.map(([k, label]) => <a key={k} href={k === "library" ? "/" : `/?tab=${k}`} aria-current={k === tab ? "page" : undefined}>{label}{k === "friends" && asked > 0 && <em>{asked}</em>}</a>)}
          </nav>
        </section>

        {tab === "library" && (
          <>
            <h2>Games<em>{games}</em></h2>
            <Cards kind="game" mine={mine} unlocks={unlocks} />
            <h2>Suites<em>{suites}</em></h2>
            <Cards kind="suite" mine={mine} unlocks={unlocks} />
          </>
        )}

        {tab === "achievements" && <><h2>Achievements</h2><Achievements unlocks={unlocks} /></>}

        {tab === "friends" && (hub ? <Friends hub={hub} /> : <p className="card mut">{MESSAGES.nohub}</p>)}

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
              <button type="submit">Grant</button>
              <button className="ghost" type="submit" formAction="/do/revoke">Take away</button>
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

        {tab === "account" && (
          <>
            <h2>Account</h2>
            <div className="card me"><i>{(me.name || me.email).slice(0, 1)}</i><div><b>{me.name || me.email}</b><span>{me.email} · came in through {nameOf(mine?.source ?? "eqosys")}</span></div></div>
            <form method="post" action="/do/logout"><button className="ghost" type="submit">Sign out</button></form>
            <details className="card danger">
              <summary>More options</summary>
              <p className="mut">Removing your account takes you out of every Q app. It asks twice more before anything happens.</p>
              <a href="/delete">Remove my account…</a>
            </details>
          </>
        )}
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
      <form method="get" action="/delete"><input type="hidden" name="step" value="2" />{app && <input type="hidden" name="app" value={app} />}<button type="submit">Yes, keep going</button></form>
      {keep}
    </>
  );
  return (
    <>
      <h1>Type your email to confirm</h1>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}
      <form className="card" method="post" action="/do/delete">
        {app && <input type="hidden" name="app" value={app} />}
        <p><input name="confirm" type="email" placeholder={me.email} autoComplete="off" required /></p>
        <button type="submit">Delete my account for good</button>
      </form>
      {keep}
    </>
  );
}

export function Deleted({ app }: { app?: string }) {
  const a = appOf(app ?? "");
  return <><h1>Account deleted</h1><p className="mut">Everything eqosys holds about you is gone.</p>{a && <p><a href={a.origins[0]}>Back to {a.name}</a></p>}</>;
}

/** The privacy policy every Q app links to (App Store Connect asks for one, and so does guideline 5.1.1(i)). Plain words, and true
 * to what eqosys keeps: change this page in the same PR as anything that stores something new. */
export const Privacy = () => (
  <>
    <h1>Privacy</h1>
    <p className="mut">One account for every Q app, and only what that needs. Updated November 2026.</p>
    <h2>What we keep</h2>
    <ul>
      <li><b>Your account:</b> your email, the name you chose, and how you sign in (a scrambled password, or a link to Apple, GitHub or Google).
        With Sign in with Apple you can hide your email; we only ever see Apple's relay address.</li>
      <li><b>Which Q apps you use</b> and when you last opened each, plus what each app lets you do there.</li>
      <li><b>Friends:</b> who you added, requests, and which app a friend is in right now.</li>
      <li><b>Play:</b> party seats and the last messages of a party's chat, and the game saves you choose to keep in the cloud.</li>
      <li><b>Reports</b> you send from a game. They become public GitHub issues that name you only by an id that can't be traced back to you.</li>
      <li><b>Sign-in sessions</b>, with the device's IP address and browser name, so you can stay signed in.</li>
    </ul>
    <h2>What we don't do</h2>
    <ul>
      <li>No ads, no tracking across other companies' apps or sites, and nothing sold or shared for marketing.</li>
      <li>No email from us. The sign-in page loads its fonts from Google Fonts; nothing else leaves eqosys.</li>
    </ul>
    <h2>Where it lives</h2>
    <p>On Cloudflare (Workers, D1 and Durable Objects), which runs eqosys for us.</p>
    <h2>Deleting it</h2>
    <p>Delete your account from any Q app's settings or at <a href="/delete">eqosys.qntbr.com/delete</a>. Everything above goes at once, every
      Q app that keeps data of its own is told to erase it, and a Sign in with Apple link is revoked at Apple.</p>
    <h2>Questions</h2>
    <p>Open an issue at <a href="https://github.com/QuinnsCode/RustyBuns/issues">github.com/QuinnsCode/RustyBuns</a>, or use Report in any Q app.</p>
  </>
);

const TITLES: Record<number, string> = { 404: "Nothing here.", 500: "Something broke on our side.", 503: "Sign-in is off right now." };
export const ErrorPage = ({ status }: { status: number }) => (
  <><h1>{status}</h1><p className="mut">{TITLES[status] ?? "That didn't work."}</p><p><a href="/">{NAME}</a></p></>
);

