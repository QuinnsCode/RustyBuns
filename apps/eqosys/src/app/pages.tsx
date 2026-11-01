import { APPS, appOf, type QApp } from "../apps.ts";
import type { Me } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Friend, HubState, Note } from "../hub.ts";
import type { Member } from "../members.ts";
import { Glass, greeting } from "./Glass.tsx";
import { Art } from "./Art.tsx";

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

const nameOf = (id: string) => appOf(id)?.name ?? id;

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

// The home page: the same sky and glass as sign-in (Glass.tsx), a wider column, and every Q app as a poster.
const HOME_CSS = `
.home{width:min(100%,46rem);margin:0 auto;display:grid;gap:1rem}
.home .top{display:grid;gap:1.1rem}
.home .top .brand{margin:0;justify-content:space-between}
.home .top .brand span{display:flex;align-items:center;gap:.5rem}
.home .top h1{font-size:2.3rem}
.home h2{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:1.25rem;letter-spacing:-.02em;margin:1rem .3rem 0;color:var(--ink);
 text-shadow:0 1px 12px color-mix(in oklab,var(--paper) 90%,transparent)}
.home .mut{color:var(--mut)}
.home .bars{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.9rem}
.home .poster{--cloud:color-mix(in oklab,#f8fafc var(--flipp),#1a2131);position:relative;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;color:var(--ink);text-decoration:none;background:var(--cloud);border:1px solid var(--rim);
 box-shadow:0 14px 30px -22px rgba(0,0,0,.5),inset 0 1px 0 var(--edge);transition:transform .25s,box-shadow .25s,border-color .25s}
.home .poster .shot{position:relative;aspect-ratio:16/11;overflow:hidden}
.home .poster .shot img,.home .poster .shot .art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .5s;
 -webkit-mask-image:linear-gradient(to bottom,transparent,#000 14%,#000 52%,transparent 98%),linear-gradient(to right,transparent,#000 16%,#000 84%,transparent);-webkit-mask-composite:source-in;
 mask-image:linear-gradient(to bottom,transparent,#000 14%,#000 52%,transparent 98%),linear-gradient(to right,transparent,#000 16%,#000 84%,transparent);mask-composite:intersect}
.home .poster .shot:after{content:"";position:absolute;inset:0;pointer-events:none;
 background:radial-gradient(60% 40% at 12% 100%,var(--cloud),transparent),radial-gradient(55% 38% at 88% 100%,var(--cloud),transparent),radial-gradient(70% 30% at 50% 104%,var(--cloud),transparent)}
.home .poster .cap{position:relative;display:grid;gap:.25rem;padding:0 .9rem .85rem;margin-top:-1.1rem}
.home .poster:hover,.home .poster:focus-visible{transform:translateY(-4px);border-color:color-mix(in oklab,var(--acc) 60%,transparent);box-shadow:0 26px 44px -20px rgba(0,0,0,.6),inset 0 1px 0 var(--edge)}
.home .poster:hover .shot img,.home .poster:hover .shot .art{transform:scale(1.06)}
.home .poster:focus-visible{outline:2px solid var(--acc);outline-offset:3px}
.home .poster b{display:block;font-family:Poppins,Lexend,sans-serif;font-weight:200;font-size:1.25rem;line-height:1.15;text-wrap:balance}
.home .poster .blurb{font-size:.82rem;line-height:1.35;color:var(--ink);opacity:.82;text-wrap:pretty}
.home .poster .last{font-size:.72rem;color:var(--mut)}
.home .poster .go{position:absolute;top:.6rem;right:.6rem;display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;backdrop-filter:blur(6px);opacity:0;transform:scale(.8);transition:opacity .15s,transform .15s}
.home .poster:hover .go,.home .poster:focus-visible .go{opacity:1;transform:none}
.home .poster .go svg{width:1rem;height:1rem}
@media(hover:none){.home .poster .go{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.home .poster,.home .poster .shot img,.home .poster .shot .art{transition:none;animation:none}}
.home .tabs{display:flex;gap:.3rem;flex-wrap:wrap}
.home .tabs a{display:inline-flex;align-items:center;gap:.4rem;padding:.45rem .95rem;border-radius:999px;color:var(--mut);text-decoration:none;font-weight:500;border:1px solid transparent}
.home .tabs a:hover{color:var(--ink)}
.home .tabs a[aria-current]{color:var(--ink);background:color-mix(in oklab,var(--acc) 22%,transparent);border-color:color-mix(in oklab,var(--acc) 45%,transparent)}
.home .tabs em{font-style:normal;font-size:.72rem;padding:.05rem .4rem;border-radius:999px;background:var(--acc);color:var(--onacc)}
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
@media(max-width:30rem){.home .bars{grid-template-columns:1fr}}
`;

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>;

/** One app as a poster card: its key art, its name, and when the person was last in. */
function Poster({ app, mine, i }: { app: QApp; mine: Member["apps"][number] | undefined; i: number }) {
  const what = mine ? `${mine.access.join(", ") || "no access"} · ${day(mine.last_at)}` : app.kind === "game" ? "not played yet" : "not opened yet";
  return (
    <a className="poster" href={app.origins[0]} title={`${app.name}: ${what}`} style={{ animationDelay: `${0.04 * i}s` }}>
      <span className="shot">{app.shot ? <img src={`/cards/${app.id}.jpg`} alt="" loading="lazy" /> : <Art id={app.id} />}</span>
      <span className="go"><Arrow /></span>
      <span className="cap"><b>{app.name}</b><span className="blurb">{app.blurb}</span><span className="last">{what}</span></span>
    </a>
  );
}

/** The apps of one kind as bars, the ones this person uses first, most recent on top. */
function Bars({ kind, mine }: { kind: QApp["kind"]; mine: Member | undefined }) {
  const used = new Map(mine?.apps.map((a) => [a.app, a]));
  const list = APPS.filter((a) => a.kind === kind).sort((a, b) => (used.get(b.id)?.last_at ?? -1) - (used.get(a.id)?.last_at ?? -1));
  return <div className="bars">{list.map((a, i) => <Poster key={a.id} app={a} mine={used.get(a.id)} i={i} />)}</div>;
}

const TABS = [["library", "Library"], ["friends", "Friends"], ["people", "People"], ["account", "Account"]] as const;
export type Tab = (typeof TABS)[number][0];
export const tabOf = (v: unknown): Tab => TABS.find(([k]) => k === v)?.[0] ?? "library";

export function Home({ me, mine, hub, everyone, error, t0, tab }: { me: Me; mine: Member | undefined; hub: HubState | null; everyone: Member[] | null; error?: string; t0: number; tab: Tab }) {
  const used = new Map(mine?.apps.map((a) => [a.app, a]));
  const recent = APPS.filter((a) => used.has(a.id)).sort((a, b) => (used.get(b.id)?.last_at ?? 0) - (used.get(a.id)?.last_at ?? 0));
  const tabs = TABS.filter(([k]) => k !== "people" || everyone);
  const asked = hub?.incoming.length ?? 0;
  return (
    <Glass t0={t0} css={HOME_CSS}>
      <div className="home">
        <section className="pane top">
          <div className="brand"><span><i /><b>{NAME}</b></span><span className="mut">v{VERSION}</span></div>
          <h1>{greeting(t0)}</h1>
          {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
          <nav className="tabs" aria-label="eqosys">
            {tabs.map(([k, label]) => <a key={k} href={k === "library" ? "/" : `/?tab=${k}`} aria-current={k === tab ? "page" : undefined}>{label}{k === "friends" && asked > 0 && <em>{asked}</em>}</a>)}
          </nav>
        </section>

        {tab === "library" && (
          <>
            {recent.length > 0 && <><h2>Continue</h2><div className="bars">{recent.slice(0, 4).map((a, i) => <Poster key={a.id} app={a} mine={used.get(a.id)} i={i} />)}</div></>}
            <h2>Games</h2>
            <Bars kind="game" mine={mine} />
            <h2>Suites</h2>
            <Bars kind="suite" mine={mine} />
          </>
        )}

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

