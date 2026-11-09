// The Studio tab (studios.ts, VISION.md): each studio the person is in, their role, who else is in, and the shelf, where every app
// shows its four doors: Play (its site), Keep (the person's own unlocks in it, on its eqosys page), Make (its codeSplitter repo,
// once linked) and Ship (live, with the stage, version and time its last deploy reported). An owner or admin adds people by email here; with no studio yet, the person can make one.
import { KINDS, ROLES, type Role, type Studio as Shelf } from "../studios.ts";
import type { State } from "../listings.ts";
import { btn } from "./Glass.tsx";

type Unlocks = Map<string, Map<string, number>>;

export const STUDIO_CSS = `
.home .studio header{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem .8rem;margin-bottom:.8rem}
.home .studio header b{font-family:Lexend,system-ui,sans-serif;font-weight:600;font-size:1.4rem;flex:1 1 auto;min-width:min(100%,min-content);overflow-wrap:break-word}
.home .pill{display:inline-flex;align-items:center;gap:.3rem;flex:none;white-space:nowrap;font-size:.74rem;padding:.12rem .55rem;border-radius:999px;border:1px solid var(--rim);color:var(--mut);text-decoration:none}
.home a.pill{color:var(--ink)}.home a.pill:hover{border-color:color-mix(in oklab,var(--acc) 60%,transparent)}
.home .pill.on{color:var(--onacc);background:var(--acc);border-color:transparent}
.home .people{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 .8rem}
.home .people>span{display:inline-flex;align-items:baseline;gap:.4rem;max-width:100%;padding:.3rem .65rem;border-radius:12px;border:1px solid var(--rim)}
.home .people b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home .people span span{font-size:.72rem;color:var(--mut)}
.home .shelf{display:grid;gap:.35rem}
.home .shelf>div{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem;padding:.5rem 0;border-top:1px solid var(--rim)}
.home .shelf>div>b{flex:1 1 10rem;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home .doors{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem}
.home .shelf .note{flex:1 1 100%;font-size:.78rem;color:var(--mut)}
.home .shipped{font-size:.72rem;color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}
.home .studio form{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}.home .studio form input{flex:1 1 12rem;min-width:0}
`;

/** When a deploy went out, in UTC: "2026-11-06 14:02". */
const shippedAt = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

const ROLE_WORD: Record<Role, string> = { owner: "owner", admin: "admin", maker: "maker" };

/** Where a studio's own game stands in its review (listings.ts). */
const STATE_TIP: Record<State, string> = {
  draft: "Only your studio can sign in to it: send it to review when it's ready",
  "in review": "Waiting for a review: only your studio can sign in to it yet",
  listed: "On everyone's shelf",
  refused: "Sent back: fix it and send it again",
  pulled: "Out of the Library: players' saves go in 30 days",
};

/** One app's four doors. */
function Doors({ a, unlocks }: { a: Shelf["apps"][number]; unlocks: Unlocks }) {
  const kept = unlocks.get(a.id)?.size ?? 0;
  return (
    <span className="doors">
      {a.play ? <a className="pill" href={a.play} title={`Play ${a.name}`}>Play</a> : <span className="pill" title="No site yet">Play</span>}
      <a className="pill" href={`/app/${a.id}`} title="Your unlocks and saves in it">Keep{kept ? ` ${kept}` : ""}</a>
      {a.make ? <span className="pill" title={`Its code: ${a.make}`}>Make</span> : <span className="pill" title="No codeSplitter repo linked yet">Make</span>}
      <span className={a.ship === "live" ? "pill on" : "pill"} title={a.shipped ? `${a.shipped.stage} ${a.shipped.version}, ${shippedAt(a.shipped.at)}` : a.ship === "live" ? "Live (no deploy reported yet)" : "Not deployed yet"}>{a.ship === "live" ? "Live" : "Not shipped"}</span>
      {a.shipped && <span className="shipped">{a.shipped.stage} {a.shipped.version} · {shippedAt(a.shipped.at)}</span>}
    </span>
  );
}

export function Studios({ studios, unlocks }: { studios: Shelf[]; unlocks: Unlocks }) {
  return (
    <>
      <h2>Studios</h2>
      {studios.length === 0 && <p className="card mut">You aren't in a studio yet. A studio is the account that makes apps: just you, a team or a business.</p>}
      {studios.map((s) => (
        <section key={s.id} className="card studio" aria-label={s.name}>
          <header><b>{s.name}</b><span className="pill">{s.kind}</span><span className="pill on">you: {ROLE_WORD[s.role]}</span></header>
          <div className="people" aria-label="Members">
            {s.people.map((p) => <span key={p.email} title={p.email}><b>{p.name || p.email}</b><span>{ROLE_WORD[p.role]}</span></span>)}
          </div>
          <div className="shelf" aria-label="Shelf">
            {s.apps.length === 0 ? <span className="mut">No apps on the shelf yet.</span> : s.apps.map((a) => (
              <div key={a.id}><b>{a.name}</b>{a.state && <span className={a.state === "listed" ? "pill on" : "pill"} title={a.note ?? STATE_TIP[a.state]}>{a.state}</span>}<Doors a={a} unlocks={unlocks} />
                {a.note && a.state === "refused" && <span className="note">{a.note}</span>}</div>
            ))}
          </div>
          {(s.role === "owner" || s.role === "admin") && (
            <form method="post" action="/do/studio-add" aria-label={`Add someone to ${s.name}`}>
              <input type="hidden" name="studio" value={s.id} />
              <input name="email" type="email" placeholder="their email" required />
              <select name="role" defaultValue="maker">{ROLES.filter((r) => r !== "owner" || s.role === "owner").map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}</select>
              <button className={btn(true)} type="submit">Add</button>
            </form>
          )}
        </section>
      ))}
      <form className="card row" method="post" action="/do/studio-make" aria-label="Make a studio">
        <input name="name" placeholder="a new studio's name" maxLength={60} required />
        <select name="kind" defaultValue="solo">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <button className={btn()} type="submit">Make a studio</button>
      </form>
    </>
  );
}
