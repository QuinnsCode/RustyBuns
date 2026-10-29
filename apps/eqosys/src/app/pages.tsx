import { APPS, appOf } from "../apps.ts";
import type { Me } from "../auth.ts";
import { NAME, VERSION } from "../env.ts";
import type { Ask } from "../handle.ts";
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
};

const nameOf = (id: string) => appOf(id)?.name ?? id;

/** The ask passed along by every form on the page. */
const Carry = ({ ask }: { ask: Ask | null }) => ask && (
  <>
    <input type="hidden" name="app" value={ask.app.id} />
    <input type="hidden" name="return" value={ask.back.href} />
    <input type="hidden" name="challenge" value={ask.challenge} />
    {ask.state && <input type="hidden" name="state" value={ask.state} />}
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
              <button className="ghost" type="submit">Continue with {p === "github" ? "GitHub" : "Google"}</button></form>
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

export function Home({ me, mine, everyone, error }: { me: Me; mine: Member | undefined; everyone: Member[] | null; error?: string }) {
  return (
    <>
      <header>
        <h1>{NAME} <span className="mut">v{VERSION}</span></h1>
        <form method="post" action="/do/logout"><span className="mut">{me.email} </span><button className="ghost" type="submit">Sign out</button></form>
      </header>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}

      <h2>Your apps</h2>
      <p className="mut">You came in through {nameOf(mine?.source ?? "eqosys")}.</p>
      <div className="card">{mine ? <AppsTable m={mine} /> : <span className="mut">none yet</span>}</div>

      <h2>Every Q app</h2>
      <div className="card">
        {APPS.map((a) => <div key={a.id}><a href={a.origins[0]}>{a.name}</a> <span className="mut">{a.kind}</span></div>)}
      </div>

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

const TITLES: Record<number, string> = { 404: "Nothing here.", 500: "Something broke on our side.", 503: "Sign-in is off right now." };
export const ErrorPage = ({ status }: { status: number }) => (
  <><h1>{status}</h1><p className="mut">{TITLES[status] ?? "That didn't work."}</p><p><a href="/">{NAME}</a></p></>
);

