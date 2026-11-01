import { APPS, appOf, type QApp } from "../apps.ts";
import type { Me } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Friend, HubState, Note } from "../hub.ts";
import type { Member } from "../members.ts";
import { Glass, greeting } from "./Glass.tsx";

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

// The home page: the same sky and glass as sign-in (Glass.tsx), a wider column, and every Q app as a bar of its own.
const HOME_CSS = `
.home{width:min(100%,46rem);margin:0 auto;display:grid;gap:1rem}
.home .top{display:grid;gap:1.1rem}
.home .top .brand{margin:0;justify-content:space-between}
.home .top .brand span{display:flex;align-items:center;gap:.5rem}
.home .top h1{font-size:2.3rem}
.home h2{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:1.25rem;letter-spacing:-.005em;margin:1rem .3rem 0;color:var(--ink);
 text-shadow:0 1px 12px color-mix(in oklab,var(--paper) 90%,transparent)}
.home .mut{color:var(--mut)}
.home .bars{display:grid;gap:.6rem}
.home .bar{display:flex;align-items:center;gap:1rem;padding:.9rem 1.1rem;border-radius:20px;background:var(--paper);border:1px solid var(--rim);color:var(--ink);text-decoration:none;
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge);
 transition:transform .15s,box-shadow .2s,border-color .2s;animation:arrive .7s cubic-bezier(.2,.7,.2,1) both}
.home .bar:hover{transform:translateY(-2px);border-color:color-mix(in oklab,var(--acc) 45%,transparent);box-shadow:0 24px 46px -24px rgba(0,0,0,.5),inset 0 1px 0 var(--edge)}
.home .bar:focus-visible{outline:2px solid var(--acc);outline-offset:3px}
.home .bar>i{display:grid;place-items:center;flex:none;width:3rem;height:3rem;border-radius:14px;font-family:Fraunces,Georgia,serif;font-style:normal;font-size:1.35rem;font-weight:500;
 color:#fff;background:linear-gradient(140deg,oklch(.72 .13 var(--hue)),oklch(.5 .14 calc(var(--hue) + 40)));box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
.home .bar div{flex:1;min-width:0}
.home .bar b{display:block;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:1.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .bar div span{display:block;color:var(--mut);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .bar>svg{flex:none;width:1.25rem;height:1.25rem;color:var(--mut);transition:transform .15s,color .2s}
.home .bar:hover>svg{transform:translateX(3px);color:var(--acc)}
.home .card{padding:1.1rem 1.25rem;border-radius:20px;background:var(--paper);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 18px 40px -26px rgba(0,0,0,.45),inset 0 1px 0 var(--edge)}
.home .card+.card{margin-top:.6rem}
.home .row input{flex:1;min-width:10rem}
.home .list>div{padding:.55rem 0}.home .list>div+div{border-top-color:var(--rim)}
.home .list button{padding:.45rem .8rem;font-size:.9rem}
.home table td,.home table th{border-bottom-color:var(--rim)}.home table th{color:var(--mut)}
.home a{color:var(--acc)}
@media(max-width:28rem){.home .bar{padding:.8rem .9rem;gap:.8rem}.home .bar>i{width:2.6rem;height:2.6rem}}
`;

/** A steady hue for an app's tile, from its id. */
const hueOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>;

/** One app as a full-width bar: its tile, its name, what the person may do there and when they were last in, and a way in. */
function Bar({ app, mine, i }: { app: QApp; mine: Member["apps"][number] | undefined; i: number }) {
  const what = mine ? `${mine.access.join(", ") || "no access"} · last in ${day(mine.last_at)}` : app.kind === "game" ? "not played yet" : "not opened yet";
  return (
    <a className="bar" href={app.origins[0]} style={{ "--hue": hueOf(app.id), animationDelay: `${0.05 * i}s` } as React.CSSProperties}>
      <i>{app.name.slice(0, 1)}</i>
      <div><b>{app.name}</b><span>{what}</span></div>
      <Arrow />
    </a>
  );
}

/** The apps of one kind as bars, the ones this person uses first, most recent on top. */
function Bars({ kind, mine }: { kind: QApp["kind"]; mine: Member | undefined }) {
  const used = new Map(mine?.apps.map((a) => [a.app, a]));
  const list = APPS.filter((a) => a.kind === kind).sort((a, b) => (used.get(b.id)?.last_at ?? -1) - (used.get(a.id)?.last_at ?? -1));
  return <div className="bars">{list.map((a, i) => <Bar key={a.id} app={a} mine={used.get(a.id)} i={i} />)}</div>;
}

export function Home({ me, mine, hub, everyone, error, t0 }: { me: Me; mine: Member | undefined; hub: HubState | null; everyone: Member[] | null; error?: string; t0: number }) {
  return (
    <Glass t0={t0} css={HOME_CSS}>
      <div className="home">
        <section className="pane top">
          <div className="brand"><span><i /><b>{NAME}</b></span><span className="mut">v{VERSION}</span></div>
          <h1>{greeting(t0)}</h1>
          {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
          <div className="me"><i>{(me.name || me.email).slice(0, 1)}</i><div><b>{me.name || me.email}</b><span>{me.email} · came in through {nameOf(mine?.source ?? "eqosys")}</span></div></div>
          <form method="post" action="/do/logout"><button className="ghost" type="submit">Sign out</button></form>
        </section>

        <h2>Games</h2>
        <Bars kind="game" mine={mine} />
        <h2>Suites</h2>
        <Bars kind="suite" mine={mine} />

        {hub ? <Friends hub={hub} /> : <><h2>Friends</h2><p className="card mut">{MESSAGES.nohub}</p></>}

        {everyone && (
          <>
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
        <p className="foot"><a href="/delete">Delete my account</a></p>
      </div>
    </Glass>
  );
}

/** Delete my account, the page an app opens (/delete?app=<id>). Typing the email is the confirmation. */
export function DeletePage({ me, app, error }: { me: Me; app?: string; error?: string }) {
  return (
    <>
      <h1>Delete my account</h1>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}
      <p>This removes <b>{me.email}</b> from every Q app: your sign-in, your access, your friends and your notifications. It can't be undone.</p>
      <form className="card" method="post" action="/do/delete">
        {app && <input type="hidden" name="app" value={app} />}
        <p>Type your email to confirm.</p>
        <p><input name="confirm" type="email" placeholder={me.email} autoComplete="off" required /></p>
        <button type="submit">Delete my account for good</button>
      </form>
      <p><a href="/">Keep it</a></p>
    </>
  );
}

export function Deleted({ app }: { app?: string }) {
  const a = appOf(app ?? "");
  return <><h1>Account deleted</h1><p className="mut">Everything eqosys holds about you is gone.</p>{a && <p><a href={a.origins[0]}>Back to {a.name}</a></p>}</>;
}

const TITLES: Record<number, string> = { 404: "Nothing here.", 500: "Something broke on our side.", 503: "Sign-in is off right now." };
export const ErrorPage = ({ status }: { status: number }) => (
  <><h1>{status}</h1><p className="mut">{TITLES[status] ?? "That didn't work."}</p><p><a href="/">{NAME}</a></p></>
);

