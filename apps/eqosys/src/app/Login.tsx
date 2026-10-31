// The sign-in page: one glass panel over the sky (Sky.tsx). Its paper and ink follow the same clock as the sky, so
// it is white paper at noon and smoked glass at midnight, with every shade between. No script: the sign-in / new-here
// switch is two radios and :has().
import type { Me } from "../auth.ts";
import { NAME } from "../env.ts";
import type { Ask } from "../handle.ts";
import { MESSAGES } from "./pages.tsx";
import { Sky, skyCss } from "./Sky.tsx";

const CSS = `
body:has(.sky){background:transparent}
body:has(.sky) main{max-width:none;margin:0;min-height:100dvh;display:grid;place-items:center;padding:1.5rem 1rem;
 --ink:color-mix(in oklab,#141824 var(--flipp),#eef1f8);--mut:color-mix(in oklab,#5a6170 var(--flipp),#a6aebf);
 --paper:color-mix(in oklab,rgba(255,255,255,.74) var(--flipp),rgba(13,17,30,.6));
 --field:color-mix(in oklab,rgba(255,255,255,.6) var(--flipp),rgba(255,255,255,.06));
 --edge:color-mix(in oklab,rgba(255,255,255,.75) var(--flipp),rgba(255,255,255,.13));
 --rim:color-mix(in oklab,rgba(20,24,36,.14) var(--flipp),rgba(255,255,255,.1));
 --acc:color-mix(in oklab,#0f766e var(--flipp),#7de3d3);--onacc:color-mix(in oklab,#fff var(--flipp),#06201d);
 --bad:color-mix(in oklab,#b3261e var(--flipp),#ff9d94);color:var(--ink)}
.pane{width:min(100%,24rem);padding:2rem 1.75rem 1.5rem;border-radius:22px;background:var(--paper);color:var(--ink);border:1px solid var(--rim);
 backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);
 box-shadow:0 30px 80px -30px rgba(0,0,0,.45),0 2px 6px -2px rgba(0,0,0,.15),inset 0 1px 0 var(--edge)}
.pane h1{font-size:1.75rem;letter-spacing:-.02em;font-weight:650;margin:0;line-height:1.1}
.pane .lead{margin:.35rem 0 1.4rem;color:var(--mut);font-size:.95rem}
.pane .lead b{color:var(--ink);font-weight:600}
.pane .bad{margin:0 0 1rem;padding:.6rem .8rem;border-radius:10px;font-size:.9rem;color:var(--bad);
 background:color-mix(in oklab,var(--bad) 10%,transparent);border:1px solid color-mix(in oklab,var(--bad) 25%,transparent)}
.pane .tabs{display:grid;grid-template-columns:1fr 1fr;padding:3px;border-radius:12px;background:color-mix(in oklab,var(--ink) 7%,transparent);margin-bottom:1.1rem}
.pane .tabs label{text-align:center;padding:.4rem;border-radius:9px;cursor:pointer;color:var(--mut);font-size:.92rem;transition:background .25s,color .25s}
.pane .tabs input{position:absolute;opacity:0;pointer-events:none}
.pane:has(#t-in:checked) .tabs label[for=t-in],.pane:has(#t-new:checked) .tabs label[for=t-new]{background:var(--paper);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.pane:has(#t-in:checked) .f-new,.pane:has(#t-new:checked) .f-in{display:none}
.pane form{display:grid;gap:.6rem}
.pane .in{display:block;font-size:.8rem;color:var(--mut)}
.pane .in input{display:block;width:100%;margin-top:.25rem;font-size:1rem;padding:.6rem .75rem;border-radius:11px;background:var(--field);border:1px solid var(--rim);color:var(--ink);
 color-scheme:light;transition:border-color .2s,box-shadow .2s}
.pane .in input::placeholder{color:color-mix(in oklab,var(--mut) 70%,transparent)}
.pane .in input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px color-mix(in oklab,var(--acc) 25%,transparent)}
.pane button{width:100%;padding:.7rem .9rem;border-radius:11px;font-size:1rem;font-weight:600;background:var(--acc);color:var(--onacc);border:1px solid transparent;cursor:pointer;
 transition:transform .12s,filter .2s;margin-top:.2rem}
.pane button:hover{filter:brightness(1.06)}.pane button:active{transform:translateY(1px)}
.pane button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.pane button.ghost{background:var(--field);color:var(--ink);border-color:var(--rim);font-weight:500}
.pane button.ghost:hover{filter:none;background:color-mix(in oklab,var(--ink) 9%,transparent)}
.pane .or{display:flex;align-items:center;gap:.75rem;color:var(--mut);font-size:.8rem;margin:1.1rem 0 .8rem}
.pane .or::before,.pane .or::after{content:"";flex:1;height:1px;background:var(--rim)}
.pane .social{display:grid;gap:.5rem}
.pane .social form{display:block}
.pane .social button{display:flex;align-items:center;justify-content:center;gap:.5rem}
.pane .social svg{width:1.1em;height:1.1em;fill:currentColor}
.pane .me{display:flex;align-items:center;gap:.8rem;margin-bottom:1.2rem}
.pane .me i{display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:50%;background:var(--acc);color:var(--onacc);font-style:normal;font-weight:650;font-size:1.1rem;text-transform:uppercase}
.pane .me div{min-width:0}.pane .me b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pane .me span{color:var(--mut);font-size:.85rem}
.pane .again{text-align:center;margin-top:.9rem}
.pane .again button{width:auto;background:none;border:0;color:var(--mut);font-weight:500;font-size:.85rem;padding:.2rem .4rem;text-decoration:underline;text-underline-offset:3px}
.pane .again button:hover{filter:none;color:var(--ink)}
.foot{margin-top:1rem;font-size:.78rem;color:var(--mut);text-align:center}
.foot a{color:inherit}
@media(max-width:28rem){.pane{padding:1.6rem 1.25rem 1.25rem}}
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
  <label className="in">{label}<input {...input} /></label>
);

// Simple Icons' marks (CC0), inline so the page fetches nothing.
const MARKS: Record<string, { name: string; d: string }> = {
  github: { name: "GitHub", d: "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" },
  google: { name: "Google", d: "M12.5 10.2v3.9h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C17.3 3.3 15.1 2.3 12.5 2.3 7.1 2.3 2.7 6.7 2.7 12s4.4 9.7 9.8 9.7c5.6 0 9.4-4 9.4-9.5 0-.6-.1-1.1-.2-1.6h-9.2z" },
  apple: { name: "Apple", d: "M17.1 12.7c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 2 .8 3.3.8 1.4 0 2.2-1.2 3.1-2.5 1-1.4 1.3-2.8 1.4-2.8 0 0-2.7-1-2.8-4.1M14.6 5.3c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4" },
};

export function Login({ ask, me, social, error, t0 }: { ask: Ask | null; me: Me | null; social: string[]; error?: string; t0: number }) {
  const app = ask?.app.name;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: skyCss(t0) + CSS }} />
      <Sky />
      <div>
        <section className="pane">
          <h1>{NAME}</h1>
          <p className="lead">{me ? (app ? <>You're signed in. Go on to <b>{app}</b>.</> : "You're signed in.") : app ? <>One account for every Q app. Sign in to go on to <b>{app}</b>.</> : "One account for every Q app."}</p>
          {error && MESSAGES[error] && <p className="bad" role="alert">{MESSAGES[error]}</p>}
          {me ? (
            <>
              <div className="me"><i>{(me.name || me.email).slice(0, 1)}</i><div><b>{me.name || me.email}</b><span>{me.email}</span></div></div>
              <form method="post" action="/do/continue"><Carry ask={ask} /><button type="submit">{app ? `Continue to ${app}` : "Go to my apps"}</button></form>
              <form className="again" method="post" action="/do/logout"><Carry ask={ask} /><button type="submit">Not you? Sign out</button></form>
            </>
          ) : (
            <>
              <div className="tabs" role="tablist">
                <input type="radio" name="tab" id="t-in" defaultChecked /><label htmlFor="t-in">Sign in</label>
                <input type="radio" name="tab" id="t-new" /><label htmlFor="t-new">New here</label>
              </div>
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
            </>
          )}
        </section>
        <p className="foot">{app ? <>After that you go straight back to {app}.</> : "Your games, your friends, one account."}</p>
      </div>
    </>
  );
}
