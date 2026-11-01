// The sign-in page: one glass panel over the sky (Glass.tsx). No script: the sign-in / new-here switch is two radios
// and :has().
import type { Me } from "../auth.ts";
import type { Ask } from "../handle.ts";
import { Brand, Glass, greeting } from "./Glass.tsx";
import { MESSAGES } from "./pages.tsx";

const CSS = `
body:has(.sky) main{display:grid;align-content:center}
.pane{width:min(100%,25rem);margin-inline:auto}
@media(min-width:40rem){.pane{width:clamp(28rem,34vw,32rem);padding:2.4rem 2.6rem 1.8rem}}
.pane .sw input{position:absolute;opacity:0;pointer-events:none}
.pane:has(#t-in:checked) .f-new,.pane:has(#t-new:checked) .f-in{display:none}
.pane form{display:grid;gap:.8rem}
.pane .in{display:block}
.pane .in span{display:block;font-size:.74rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 0 .35rem .1rem}
.pane .in input{display:block;width:100%}
.pane button{width:100%;margin-top:.3rem}
.pane button.ghost{margin:0}
.pane .flip{text-align:center;font-size:.88rem;color:var(--mut);margin:1.2rem 0 0}
.pane .flip label{color:var(--ink);cursor:pointer;text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--ink) 35%,transparent);text-underline-offset:3px}
.pane .flip label:hover{text-decoration-color:var(--ink)}
.pane:has(#t-in:checked) .flip .to-in,.pane:has(#t-new:checked) .flip .to-new{display:none}
.pane .or{display:flex;align-items:center;gap:.75rem;color:var(--mut);font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;margin:1.2rem 0 .8rem}
.pane .or::before,.pane .or::after{content:"";flex:1;height:1px;background:var(--rim)}
.pane .social{display:grid;gap:.5rem}
.pane .social form{display:block}
.pane .social button{display:flex;align-items:center;justify-content:center;gap:.55rem}
.pane .social button.apple{background:#000;color:#fff;border-color:transparent;background:var(--ink);color:rgb(from var(--ink) calc(255 - r) calc(255 - g) calc(255 - b))}
.pane .social svg{width:1.05em;height:1.05em;fill:currentColor}
.pane .me{margin-bottom:1.3rem}
.pane .again{text-align:center;margin-top:1rem}
.pane .again button{width:auto;background:none;border:0;box-shadow:none;color:var(--mut);font-weight:400;font-size:.86rem;padding:.2rem .4rem;text-decoration:underline;text-underline-offset:3px}
.pane .again button:hover{filter:none;color:var(--ink)}
`;

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

const Field = ({ label, ...input }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="in"><span>{label}</span><input {...input} /></label>
);

// Simple Icons' marks (CC0), inline so the page fetches nothing for them.
const MARKS: Record<string, { name: string; d: string }> = {
  github: { name: "GitHub", d: "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" },
  google: { name: "Google", d: "M12.5 10.2v3.9h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C17.3 3.3 15.1 2.3 12.5 2.3 7.1 2.3 2.7 6.7 2.7 12s4.4 9.7 9.8 9.7c5.6 0 9.4-4 9.4-9.5 0-.6-.1-1.1-.2-1.6h-9.2z" },
  apple: { name: "Apple", d: "M17.1 12.7c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 2 .8 3.3.8 1.4 0 2.2-1.2 3.1-2.5 1-1.4 1.3-2.8 1.4-2.8 0 0-2.7-1-2.8-4.1M14.6 5.3c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4" },
};

/** One button per provider. Apple's is solid in the page's ink (black by day, white at night, as its guidelines ask), the rest are glass. */
const Social = ({ ask, social }: { ask: Ask | null; social: string[] }) => (
  <div className="social">
    {social.map((p) => (
      <form key={p} method="post" action="/do/social"><Carry ask={ask} /><input type="hidden" name="provider" value={p} />
        <button className={p === "apple" ? "apple" : "ghost"} type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={MARKS[p]?.d} /></svg>Continue with {MARKS[p]?.name ?? p}</button></form>
    ))}
  </div>
);

/** `appleTop`: on an iPhone, iPad or Mac the buttons (Apple's first) sit above the email form, since Face ID is one tap. */
export function Login({ ask, me, social, appleTop, error, t0 }: { ask: Ask | null; me: Me | null; social: string[]; appleTop?: boolean; error?: string; t0: number }) {
  const app = ask?.app.name;
  const top = !!appleTop && social[0] === "apple";
  const hello = greeting(t0);
  return (
    <Glass t0={t0} css={CSS}>
      <div>
        <section className="pane">
          <Brand />
          {me ? (
            <>
              <h1>{hello}</h1>
              <p className="lead">{app ? <>You're signed in. Go on to <b>{app}</b>.</> : "You're signed in."}</p>
              {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
              <div className="me"><i>{(me.name || me.email).slice(0, 1)}</i><div><b>{me.name || me.email}</b><span>{me.email}</span></div></div>
              <form method="post" action="/do/continue"><Carry ask={ask} /><button type="submit">{app ? `Continue to ${app}` : "Go to my apps"}</button></form>
              <form className="again" method="post" action="/do/logout"><Carry ask={ask} /><button type="submit">Not you? Sign out</button></form>
            </>
          ) : (
            <>
              <div className="sw"><input type="radio" name="tab" id="t-in" defaultChecked /><input type="radio" name="tab" id="t-new" /></div>
              <div className="f-in">
                <h1>{hello}</h1>
                <p className="lead">{app ? <>Sign in to go on to <b>{app}</b>.</> : "One account for every Q app."}</p>
              </div>
              <div className="f-new">
                <h1>Make your account.</h1>
                <p className="lead">{app ? <>One account for every Q app, starting with <b>{app}</b>.</> : "One account for every Q app."}</p>
              </div>
              {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
              {top && <><Social ask={ask} social={social} /><div className="or">or with email</div></>}
              <form className="f-in" method="post" action="/do/signin">
                <Carry ask={ask} />
                <Field label="Email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required />
                <Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••••" required />
                <button type="submit">Sign in</button>
              </form>
              <form className="f-new" method="post" action="/do/signup">
                <Carry ask={ask} />
                <Field label="Name people see" name="name" autoComplete="nickname" placeholder="what friends call you" />
                <Field label="Email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required />
                <Field label="Password, 10+ characters" name="password" type="password" autoComplete="new-password" placeholder="••••••••••" minLength={10} required />
                <button type="submit">Make my account</button>
              </form>
              {!top && social.length > 0 && <><div className="or">or</div><Social ask={ask} social={social} /></>}
              <p className="flip">
                <span className="to-new">New here? <label htmlFor="t-new">Make an account</label></span>
                <span className="to-in">Already have one? <label htmlFor="t-in">Sign in</label></span>
              </p>
            </>
          )}
        </section>
        <p className="foot">{app ? <>After that you go straight back to {app}.</> : "Your games, your friends, one account."} <a href="/privacy">Privacy</a></p>
      </div>
    </Glass>
  );
}
