import type { License, Metrics } from "../licenses.ts";
import { statusOf } from "../licenses.ts";
import { NAME, VERSION } from "../env.ts";

const MESSAGES: Record<string, string> = {
  bad: "That email and password don't match.",
  setup: "Setup only works once, with the admin email.",
  who: "Who paid? Put a name on it.",
};

export function Login({ setup, error }: { setup: boolean; error?: string }) {
  return (
    <>
      <h1>{NAME}</h1>
      <p className="mut">{setup ? "No account yet. Make the admin's." : "Have you paid? Admins only."}</p>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}
      <form className="card" method="post" action={setup ? "/do/setup" : "/do/login"}>
        <p><input name="email" type="email" placeholder="email" autoComplete="username" required /></p>
        <p><input name="password" type="password" placeholder={setup ? "password, 12+ characters" : "password"} autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 12 : undefined} required /></p>
        <button type="submit">{setup ? "Make the admin account" : "Sign in"}</button>
      </form>
    </>
  );
}

const ago = (t: number | null, now: number) => {
  if (!t) return "never";
  const m = Math.round((now - t) / 60000);
  return m < 1 ? "just now" : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function Admin({ email, licenses, m, error, made, now }: { email: string; licenses: License[]; m: Metrics; error?: string; made?: boolean; now: number }) {
  const peak = Math.max(1, ...m.hours.map((h) => h.ok + h.refused));
  return (
    <>
      <header>
        <h1>{NAME} <span className="mut">v{VERSION}</span></h1>
        <form method="post" action="/do/logout"><span className="mut">{email} </span><button className="ghost" type="submit">Sign out</button></form>
      </header>

      <h2>Last 24 hours</h2>
      <div className="card stats">
        <div><b>{m.paid}</b>paid</div>
        <div><b>{m.lapsed}</b>lapsed</div>
        <div><b>{m.revoked}</b>revoked</div>
        <div><b>{m.ok24}</b>keys given</div>
        <div><b className={m.refused24 ? "bad" : ""}>{m.refused24}</b>refused</div>
        <div><b>{m.accounts}</b>admin account{m.accounts === 1 ? "" : "s"}</div>
      </div>
      <div className="bars" title="leases per hour, red = refused" style={{ marginTop: ".75rem" }}>
        {m.hours.map((h) => <i key={h.hour} className={h.refused > h.ok ? "no" : ""} style={{ height: `${((h.ok + h.refused) / peak) * 100}%` }} />)}
      </div>

      <h2>Add someone who paid</h2>
      {error && MESSAGES[error] && <p className="bad">{MESSAGES[error]}</p>}
      {made && <p>Added. Their license is the top row below: send it to them for <code>QCRM_LICENSE</code>.</p>}
      <form className="row card" method="post" action="/do/grant">
        <input name="who" placeholder="who (name or company)" required />
        <input name="days" type="number" min="1" placeholder="days (blank = until revoked)" />
        <button type="submit">Add</button>
      </form>

      <h2>Licenses</h2>
      {licenses.length === 0 ? <p className="mut">Nobody yet.</p> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Who</th><th>License</th><th>Status</th><th>Last asked</th><th /></tr></thead>
            <tbody>
              {licenses.map((l) => {
                const s = statusOf(l, now);
                return (
                  <tr key={l.license}>
                    <td>{l.who}<div className="mut">since {day(l.created_at)}{l.paid_until ? `, to ${day(l.paid_until)}` : ""}</div></td>
                    <td><code>{l.license}</code></td>
                    <td className={s === "paid" ? "" : "bad"}>{s}</td>
                    <td>{ago(l.last_lease_at, now)}<div className="mut">{l.leases} leases{l.last_host ? `, ${l.last_host}` : ""}{l.last_version ? ` v${l.last_version}` : ""}</div></td>
                    <td>
                      <form method="post" action={l.revoked_at ? "/do/restore" : "/do/revoke"}>
                        <input type="hidden" name="license" value={l.license} />
                        <button className="ghost" type="submit">{l.revoked_at ? "Restore" : "Bye bye"}</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const WORDS: Record<number, [string, string]> = {
  401: ["Sign in first", "That page is for the admin."],
  403: ["Not from here", "That request came from another site, so it was refused."],
  404: ["Nothing here", "This is the pay check. There is one admin page and it isn't yours."],
  500: ["Something broke", "It's logged. Try again in a minute."],
  503: ["Accounts are off", "The sign-in secret is missing on this deploy."],
};

export function ErrorPage({ status }: { status: number }) {
  const [title, line] = WORDS[status] ?? WORDS[500]!;
  return (
    <>
      <h1>{status}: {title}</h1>
      <p className="mut">{line}</p>
      <p><a href="/login">Admin sign-in</a></p>
    </>
  );
}
