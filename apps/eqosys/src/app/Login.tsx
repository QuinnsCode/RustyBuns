// The sign-in page: one glass panel over the sky (Sky.tsx). Its paper and ink follow the same clock as the sky, so
// it is white paper at noon and smoked glass at midnight, and its greeting matches the hour the sky shows. No script:
// the sign-in / new-here switch is two radios and :has(). Type is Fraunces (a soft serif, for the greeting and the
// word mark) and DM Sans (everything else), from Google Fonts; the Worker's CSP lets those two hosts in.
import type { Me } from "../auth.ts";
import { NAME } from "../env.ts";
import type { Ask } from "../handle.ts";
import { MESSAGES } from "./pages.tsx";
import { CYCLE, Sky, skyCss } from "./Sky.tsx";

const FONTS = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..600,50;1,9..144,300..600,50&family=DM+Sans:opsz,wght@9..40,400..600&display=swap";

/** What the page says hello with, for the hour the sky shows (t0 is seconds into the cycle: 0 sunrise, half sunset). */
export const greeting = (t0: number) => {
  const f = ((t0 / CYCLE) % 1 + 1) % 1;
  return f < 0.1 ? "Good morning." : f < 0.4 ? "Welcome back." : f < 0.58 ? "Good evening." : "Welcome back, night owl.";
};

const CSS = `
body:has(.sky){background:transparent}
body:has(.sky) main{max-width:none;margin:0;min-height:100dvh;display:grid;place-items:center;padding:1.5rem 1rem;
 font-family:"DM Sans",system-ui,sans-serif;font-optical-sizing:auto;
 --ink:color-mix(in oklab,#171a24 var(--flipp),#f1f3f8);--mut:color-mix(in oklab,#646b7a var(--flipp),#9ea6b8);
 --paper:color-mix(in oklab,rgba(255,255,255,.76) var(--flipp),rgba(12,16,28,.62));
 --field:color-mix(in oklab,rgba(255,255,255,.55) var(--flipp),rgba(255,255,255,.05));
 --edge:color-mix(in oklab,rgba(255,255,255,.85) var(--flipp),rgba(255,255,255,.12));
 --rim:color-mix(in oklab,rgba(20,24,36,.12) var(--flipp),rgba(255,255,255,.09));
 --acc:color-mix(in oklab,#1d6f68 var(--flipp),#8ee8d8);--onacc:color-mix(in oklab,#fff var(--flipp),#06201d);
 --bad:color-mix(in oklab,#b3261e var(--flipp),#ff9d94);
 --sunmark:color-mix(in oklab,#f2b24a var(--flipp),#dfe6f5);color:var(--ink)}
.pane{width:min(100%,25rem);padding:2.1rem 2.1rem 1.6rem;border-radius:26px;background:var(--paper);color:var(--ink);border:1px solid var(--rim);
 backdrop-filter:blur(26px) saturate(1.5);-webkit-backdrop-filter:blur(26px) saturate(1.5);
 box-shadow:0 40px 90px -36px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.08),inset 0 1px 0 var(--edge);animation:arrive .8s cubic-bezier(.2,.7,.2,1) both}
@keyframes arrive{from{opacity:0;transform:translateY(12px) scale(.98)}}
.brand{display:flex;align-items:center;gap:.5rem;font-family:Fraunces,Georgia,serif;font-size:1.05rem;font-weight:500;letter-spacing:.01em;color:var(--mut);margin-bottom:1.6rem}
.brand i{width:.7rem;height:.7rem;border-radius:50%;background:var(--sunmark);box-shadow:0 0 .6rem color-mix(in oklab,var(--sunmark) 70%,transparent)}
.brand b{font-weight:500;color:var(--ink)}
.pane h1{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:2rem;text-wrap:balance;line-height:1.05;letter-spacing:-.015em;margin:0;font-variation-settings:"SOFT" 50,"opsz" 60}
.pane .lead{margin:.6rem 0 1.5rem;color:var(--mut);font-size:.95rem;line-height:1.45}
.pane .lead b{color:var(--ink);font-weight:500}
.pane .bad{margin:0 0 1rem;padding:.6rem .8rem;border-radius:12px;font-size:.88rem;color:var(--bad);
 background:color-mix(in oklab,var(--bad) 9%,transparent);border:1px solid color-mix(in oklab,var(--bad) 22%,transparent)}
.pane .sw input{position:absolute;opacity:0;pointer-events:none}
.pane:has(#t-in:checked) .f-new,.pane:has(#t-new:checked) .f-in{display:none}
.pane form{display:grid;gap:.8rem}
.pane .in{display:block}
.pane .in span{display:block;font-size:.74rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 0 .35rem .1rem}
.pane .in input{display:block;width:100%;font:inherit;font-size:1rem;padding:.68rem .85rem;border-radius:12px;background:var(--field);border:1px solid var(--rim);color:var(--ink);
 color-scheme:light;transition:border-color .2s,box-shadow .2s,background .2s}
.pane .in input::placeholder{color:color-mix(in oklab,var(--mut) 60%,transparent)}
.pane .in input:focus{outline:none;border-color:color-mix(in oklab,var(--acc) 70%,transparent);box-shadow:0 0 0 4px color-mix(in oklab,var(--acc) 18%,transparent)}
.pane button{width:100%;padding:.78rem 1rem;border-radius:12px;font:inherit;font-size:1rem;font-weight:500;letter-spacing:.005em;background:var(--acc);color:var(--onacc);
 border:1px solid transparent;cursor:pointer;transition:transform .12s,filter .2s;margin-top:.3rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 8px 20px -12px var(--acc)}
.pane button:hover{filter:brightness(1.05)}.pane button:active{transform:translateY(1px)}
.pane button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.pane button.ghost{background:var(--field);color:var(--ink);border-color:var(--rim);box-shadow:none;margin:0}
.pane button.ghost:hover{filter:none;background:color-mix(in oklab,var(--ink) 8%,transparent)}
.pane .flip{text-align:center;font-size:.88rem;color:var(--mut);margin:1.2rem 0 0}
.pane .flip label{color:var(--ink);cursor:pointer;text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--ink) 35%,transparent);text-underline-offset:3px}
.pane .flip label:hover{text-decoration-color:var(--ink)}
.pane:has(#t-in:checked) .flip .to-in,.pane:has(#t-new:checked) .flip .to-new{display:none}
.pane .or{display:flex;align-items:center;gap:.75rem;color:var(--mut);font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;margin:1.2rem 0 .8rem}
.pane .or::before,.pane .or::after{content:"";flex:1;height:1px;background:var(--rim)}
.pane .social{display:grid;gap:.5rem}
.pane .social form{display:block}
.pane .social button{display:flex;align-items:center;justify-content:center;gap:.55rem}
.pane .social svg{width:1.05em;height:1.05em;fill:currentColor}
.pane .me{display:flex;align-items:center;gap:.85rem;margin-bottom:1.3rem}
.pane .me i{display:grid;place-items:center;width:2.75rem;height:2.75rem;border-radius:50%;background:var(--acc);color:var(--onacc);font-family:Fraunces,Georgia,serif;font-style:normal;font-weight:500;font-size:1.2rem;text-transform:uppercase}
.pane .me div{min-width:0}.pane .me b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pane .me span{color:var(--mut);font-size:.86rem}
.pane .again{text-align:center;margin-top:1rem}
.pane .again button{width:auto;background:none;border:0;box-shadow:none;color:var(--mut);font-weight:400;font-size:.86rem;padding:.2rem .4rem;text-decoration:underline;text-underline-offset:3px}
.pane .again button:hover{filter:none;color:var(--ink)}
.foot{margin-top:1.1rem;font-size:.8rem;color:var(--mut);text-align:center;animation:arrive 1s .15s cubic-bezier(.2,.7,.2,1) both}
@media(prefers-reduced-motion:reduce){.pane,.foot{animation:none}}
@media(max-width:28rem){.pane{padding:1.7rem 1.35rem 1.3rem}.pane h1{font-size:1.85rem}}
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

export function Login({ ask, me, social, error, t0 }: { ask: Ask | null; me: Me | null; social: string[]; error?: string; t0: number }) {
  const app = ask?.app.name;
  const hello = greeting(t0);
  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <style dangerouslySetInnerHTML={{ __html: skyCss(t0) + CSS }} />
      <Sky />
      <div>
        <section className="pane">
          <div className="brand"><i /><b>{NAME}</b></div>
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
              {social.length > 0 && (
                <>
                  <div className="or">or</div>
                  <div className="social">
                    {social.map((p) => (
                      <form key={p} method="post" action="/do/social"><Carry ask={ask} /><input type="hidden" name="provider" value={p} />
                        <button className="ghost" type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={MARKS[p]?.d} /></svg>Continue with {MARKS[p]?.name ?? p}</button></form>
                    ))}
                  </div>
                </>
              )}
              <p className="flip">
                <span className="to-new">New here? <label htmlFor="t-new">Make an account</label></span>
                <span className="to-in">Already have one? <label htmlFor="t-in">Sign in</label></span>
              </p>
            </>
          )}
        </section>
        <p className="foot">{app ? <>After that you go straight back to {app}.</> : "Your games, your friends, one account."}</p>
      </div>
    </>
  );
}
