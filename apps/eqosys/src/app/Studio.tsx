// The Studio tab (studios.ts, VISION.md): each studio the person is in, their role, who else is in, and the shelf, where every app
// shows its four doors: Play (its site), Keep (the person's own unlocks in it, on its eqosys page), Make (its codeSplitter repo,
// once linked) and Ship (live, with the stage, version and time its last deploy reported). An owner or admin adds people by email here; with no studio yet, the person can make one.
// A studio's own game (listings.ts) also has its form by the Ship door, for its owners and admins: save, send to review, pull. Its
// players' reports (reports.ts) sit under it, for everyone in the studio. A new game starts from the form under the shelf.
import { KINDS, ROLES, type Role, type Studio as Shelf } from "../studios.ts";
import type { Draft, State } from "../listings.ts";
import { GENRES } from "../apps.ts";
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
.home .studio form{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}.home .studio form input,.home .studio form textarea{flex:1 1 12rem;min-width:0}
.home .studio form textarea{font:inherit;min-height:2.6rem;resize:vertical}
.home .shelf>div:has(details[open]){grid-column:1/-1}.home .shelf details{flex:1 1 100%}.home .shelf details>summary{cursor:pointer;font-size:.78rem;color:var(--mut);width:max-content}
.home .shelf details form{margin-top:.5rem}.home .studio details.add{margin-top:.6rem}
.home .inbox{display:grid;gap:.4rem;margin-top:.4rem}.home .inbox>div{display:grid;gap:.15rem;padding:.4rem .6rem;border-radius:10px;border:1px solid var(--rim);min-width:0}
.home .inbox b{font-weight:500;overflow-wrap:anywhere}.home .inbox p{margin:0;font-size:.82rem;white-space:pre-wrap;overflow-wrap:anywhere}
.home .inbox small{font-size:.72rem;color:var(--mut)}
.home .studio .people form{display:inline-flex;margin:0;align-self:center}
.home .people button{display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;padding:0;border:0;border-radius:999px;background:none;color:var(--mut);cursor:pointer}
.home .people button:hover{color:var(--ink);background:color-mix(in oklab,var(--rim) 60%,transparent)}.home .people button svg{width:.9rem;height:.9rem}
`;

// Lucide's user-minus (ISC).
const UserMinus = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 11h-6" /></svg>;

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

const runs = (s: Shelf) => s.role === "owner" || s.role === "admin";

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

/** A studio's game's fields: blank for a new one, its saved ones to change it. Send and Pull post the same form; only its id counts there. */
function GameForm({ studio, draft, state }: { studio: string; draft?: Draft; state?: State }) {
  const lines = (l?: string[]) => (l ?? []).join("\n");
  return (
    <form method="post" action="/do/listing-save" aria-label={draft ? `Change ${draft.name}` : "Add a game"}>
      <input type="hidden" name="studio" value={studio} />
      <input name="id" placeholder="its id, like rocket-golf" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={40} required defaultValue={draft?.id} readOnly={!!draft} title="Lowercase letters, numbers and dashes. Kept once taken." />
      <input name="name" placeholder="its name" maxLength={40} required defaultValue={draft?.name} />
      <select name="genre" defaultValue={draft?.genre ?? GENRES[0]} aria-label="Genre">{GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
      <textarea name="origins" placeholder="its sites, one a line: https://rocket-golf.example" required defaultValue={lines(draft?.origins)} title="Where its pages call eqosys from. Changing these sends it back to review." />
      <textarea name="returns" placeholder="sign-in returns, one a line (each site's / if empty)" defaultValue={lines(draft?.returns)} title="The exact URLs a sign-in comes back to. Changing these sends it back to review." />
      <input name="erase" type="url" placeholder="erase URL, if it keeps data per account" defaultValue={draft?.erase} />
      <input name="blurb" placeholder="its card's line" maxLength={120} defaultValue={draft?.blurb} />
      <button className={btn(true)} type="submit">Save</button>
      {(state === "draft" || state === "refused") && <button className={btn()} type="submit" formAction="/do/listing-send" formNoValidate title="Send what was last saved to review">Send to review</button>}
      {draft && state !== "pulled" && <button className={btn()} type="submit" formAction="/do/listing-pull" formNoValidate title="Out of the Library: players' saves go in 30 days">Pull</button>}
    </form>
  );
}

/** A studio's game's newest reports from its players, by the same opaque id GitHub issues use. */
function Inbox({ reports }: { reports: NonNullable<Shelf["apps"][number]["reports"]> }) {
  return (
    <details>
      <summary>Reports {reports.length}</summary>
      <div className="inbox">
        {reports.map((r) => (
          <div key={`${r.from} ${r.at}`}>
            <span><span className="pill">{r.kind}</span> <b>{r.title}</b></span>
            <p>{r.text}</p>
            {r.detail && <p className="mut">{r.detail}</p>}
            <small>{r.from} · {shippedAt(r.at)}{r.page ? ` · ${r.page}` : ""}{r.build ? ` · ${r.build}` : ""}</small>
          </div>
        ))}
      </div>
    </details>
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
            {s.people.map((p) => <span key={p.email} title={p.email}><b>{p.name || p.email}</b><span>{ROLE_WORD[p.role]}</span>
              {runs(s) && (p.role !== "owner" || s.role === "owner") && (
                <form method="post" action="/do/studio-remove"><input type="hidden" name="studio" value={s.id} /><input type="hidden" name="email" value={p.email} />
                  <button type="submit" title={`Take ${p.name || p.email} out`} aria-label={`Take ${p.name || p.email} out of ${s.name}`}><UserMinus /></button></form>
              )}</span>)}
          </div>
          <div className="shelf" aria-label="Shelf">
            {s.apps.length === 0 ? <span className="mut">No apps on the shelf yet.</span> : s.apps.map((a) => (
              <div key={a.id}><b>{a.name}</b>{a.state && <span className={a.state === "listed" ? "pill on" : "pill"} title={a.note ?? STATE_TIP[a.state]}>{a.state}</span>}<Doors a={a} unlocks={unlocks} />
                {a.note && a.state === "refused" && <span className="note">{a.note}</span>}
                {a.draft && runs(s) && a.state !== "pulled" && <details><summary>Change it</summary><GameForm studio={s.id} draft={a.draft} state={a.state} /></details>}
                {a.reports && a.reports.length > 0 && <Inbox reports={a.reports} />}</div>
            ))}
          </div>
          {runs(s) && <details className="add"><summary className="pill">Add a game</summary><GameForm studio={s.id} /></details>}
          {s.space ? <p><a className="pill" href="/spaces">The studio's space</a></p> : runs(s) && (
            <form method="post" action="/do/studio-space" aria-label={`Make ${s.name}'s space`}>
              <input type="hidden" name="studio" value={s.id} />
              <input name="name" defaultValue={s.name} maxLength={60} required aria-label="The space's name" />
              <button className={btn()} type="submit">Make its space</button>
            </form>
          )}
          {runs(s) && (
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
