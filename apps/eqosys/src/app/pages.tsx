import { APPS, appOf } from "../apps.ts";
import type { Me } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Ask } from "../handle.ts";
import type { Friend, HubState, Note } from "../hub.ts";
import type { Member } from "../members.ts";

const MESSAGES: Record<string, string> = {
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

/** The ask passed along by every form on the page. */
const Carry = ({ ask }: { ask: Ask | null }) => ask && (
  <>
    <input type="hidden" name="app" value={ask.app.id} />
    <input type="hidden" name="return" value={ask.back.href} />
    <input type="hidden" name="challenge" value={ask.challenge} />
    {ask.state && <input type="hidden" name="state" value={ask.state} />}
    {ask.nonce && <input type="hidden" name="nonce" value={ask.nonce} />}
  </>
);

export function Login({ ask, me, social, error }: { ask: Ask | null; me: Me | null; social: string[]; error?: string }) {
  const to = ask ? <b>{ask.app.name}</b> : null;
  return (
    <>
      <h1>{NAME}</h1>
      <p className="mut">{ask ? <>One account for every Q app. Sign in to go on to {to}.</> : "One account for every Q app."}</p>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}
      {me ? (
        <div className="card">
          <p>Signed in as <b>{me.email}</b>.</p>
          <form className="row" method="post" action="/do/continue"><Carry ask={ask} /><button type="submit">{ask ? <>Continue to {ask.app.name}</> : "Go to my apps"}</button></form>
          <form className="row" method="post" action="/do/logout" style={{ marginTop: ".5rem" }}><Carry ask={ask} /><button className="ghost" type="submit">Not you? Sign out</button></form>
        </div>
      ) : (
        <div className="two">
          <form className="card" method="post" action="/do/signin">
            <h2>Sign in</h2>
            <Carry ask={ask} />
            <p><input name="email" type="email" placeholder="email" autoComplete="username" required /></p>
            <p><input name="password" type="password" placeholder="password" autoComplete="current-password" required /></p>
            <button type="submit">Sign in</button>
          </form>
          <form className="card" method="post" action="/do/signup">
            <h2>New here</h2>
            <Carry ask={ask} />
            <p><input name="name" placeholder="name people see" autoComplete="nickname" /></p>
            <p><input name="email" type="email" placeholder="email" autoComplete="username" required /></p>
            <p><input name="password" type="password" placeholder="password, 10+ characters" autoComplete="new-password" minLength={10} required /></p>
            <button type="submit">Make my account</button>
          </form>
        </div>
      )}
      {!me && social.length > 0 && (
        <div className="row" style={{ marginTop: "1rem" }}>
          {social.map((p) => (
            <form key={p} method="post" action="/do/social"><Carry ask={ask} /><input type="hidden" name="provider" value={p} />
              <button className="ghost" type="submit">Continue with {p === "github" ? "GitHub" : p === "apple" ? "Apple" : "Google"}</button></form>
          ))}
        </div>
      )}
    </>
  );
}

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
      <div className="card list" style={{ marginTop: ".75rem" }}>
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

export function Home({ me, mine, hub, everyone, error }: { me: Me; mine: Member | undefined; hub: HubState | null; everyone: Member[] | null; error?: string }) {
  return (
    <>
      <header>
        <h1>{NAME} <span className="mut">v{VERSION}</span></h1>
        <form method="post" action="/do/logout"><span className="mut">{me.email} </span><button className="ghost" type="submit">Sign out</button> <a href="/delete">Delete account</a></form>
      </header>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}

      <h2>Your apps</h2>
      <p className="mut">You came in through {nameOf(mine?.source ?? "eqosys")}.</p>
      <div className="card">{mine ? <AppsTable m={mine} /> : <span className="mut">none yet</span>}</div>

      <h2>Every Q app</h2>
      <div className="card">
        {APPS.map((a) => <div key={a.id}><a href={a.origins[0]}>{a.name}</a> <span className="mut">{a.kind}</span></div>)}
      </div>

      {hub ? <Friends hub={hub} /> : <><h2>Friends</h2><p className="mut">{MESSAGES.nohub}</p></>}

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
          <div className="card" style={{ overflowX: "auto", marginTop: ".75rem" }}>
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
    </>
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

