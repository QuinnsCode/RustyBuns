// A host's pages (QOLLAB.md "Events"): /events, your events and a new one, and /e/<id>/host, change one and manage its guests.
// Plain forms like the public page's; the script (event-forms.client.ts) only shows times in the host's own zone and shrinks a
// photo before it is sent.
import { ACCESS, ASKS, CAP_MAX, KINDS, OFFERS } from "@rustybuns/util/events";
import type { HostView, MineView } from "../event-host.ts";
import { btn } from "./Glass.tsx";
import { Time } from "./events.tsx";

const SAID: Record<string, string> = {
  made: "Your event is made. Fill in the rest, then share its page.", saved: "Saved.", pictured: "Picture saved.", unpictured: "Picture taken off.",
  removed: "Taken off the event.", blockedthem: "Blocked: they can't RSVP again.", unblocked: "Unblocked.",
  badform: "That didn't save: check the name, the times (a set needs who and when), the pin (both numbers) and the plan's link.",
  badpicture: "That isn't a JPEG, PNG or WebP picture.", bigpicture: "That picture is too big: 500 KB at most.", cant: "Your role can't do that to them.", many: "That's 50 events on your account: delete an old one first.",
};
const GOOD = new Set(["made", "saved", "pictured", "unpictured", "removed", "blockedthem", "unblocked"]);
const Said = ({ said }: { said: string }) => SAID[said] ? <p role="status" className={GOOD.has(said) ? undefined : "bad"}>{SAID[said]}</p> : null;

const WORDS: Record<string, string> = {
  club: "Club night", gig: "Gig", wedding: "Wedding", party: "Party", festival: "Festival", other: "Something else",
  anyone: "Anyone can turn up", rsvp: "RSVP to come", invite: "Invite only", bar: "Bar", food: "Food", merch: "Merch", "step-free": "Step-free",
  "plus-one": "A plus-one", "food-needs": "Food needs", song: "A song",
};
const Options = ({ of }: { of: readonly string[] }) => <>{of.map((v) => <option key={v} value={v}>{WORDS[v]}</option>)}</>;

/** A date and time, filled in as UTC from here; the page's script swaps in the reader's own clock and sends the instant. */
function At({ name, label, at }: { name: string; label: string; at?: number | undefined }) {
  return (
    <p>
      <label>{label} <span className="mut" data-zone>(UTC)</span><br />
        <input type="datetime-local" name={name} data-at={at ?? ""} defaultValue={at === undefined ? "" : new Date(at).toISOString().slice(0, 16)} />
      </label>
      <input type="hidden" name={`${name}_at`} />
    </p>
  );
}
const Text = ({ name, label, value, ...rest }: { name: string; label: string; value?: string | number | undefined } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <p><label>{label}<br /><input name={name} defaultValue={value} {...rest} /></label></p>
);
const Ticks = ({ name, of, on }: { name: string; of: readonly string[]; on: readonly string[] }) => (
  <p className="row">{of.map((v) => <label key={v}><input type="checkbox" name={name} value={v} defaultChecked={on.includes(v)} style={{ width: "auto" }} /> {WORDS[v]}</label>)}</p>
);

export function MyEvents({ v }: { v: MineView }) {
  return (
    <>
      <p><a href="/">eqosys</a></p>
      <h1>Your events</h1>
      <Said said={v.said} />
      <section className="card list">
        {v.events.length === 0 && <p className="mut">None yet.</p>}
        {v.events.map((e) => <div key={e.id}><b className="grow"><a href={`/e/${e.id}`}>{e.name}</a></b><span className="mut">{WORDS[e.kind]}{e.at !== undefined && <> · <Time at={e.at} /></>}</span><a href={`/e/${e.id}/host`}>Manage</a></div>)}
      </section>
      <h2>New event</h2>
      <section className="card">
        <form method="post" action="/events">
          <p><label>What is it?<br /><select name="kind" defaultValue="party"><Options of={KINDS} /></select></label></p>
          <Text name="name" label="Name" required maxLength={80} />
          <At name="start" label="Starts" />
          <button className={btn(true)} type="submit">Make the event</button>
        </form>
      </section>
    </>
  );
}

function Edit({ id, e, picture }: { id: string; e: NonNullable<Extract<HostView, { allowed: true }>["event"]>; picture: string | null }) {
  const w = e.when, sets = [...w.sets, ...Array.from({ length: Math.min(3, 40 - w.sets.length) }, () => undefined)];
  return (
    <>
      <h2>Picture</h2>
      <section className="card">
        {picture && <img src={picture} alt="The event's picture" style={{ maxWidth: "100%", maxHeight: "12rem" }} />}
        <form className="row" method="post" action={`/e/${id}/picture`} encType="multipart/form-data">
          <input type="file" name="picture" accept="image/jpeg,image/png,image/webp" aria-label="Picture" required data-shrink />
          <button className={btn()} type="submit">Put it on the page</button>
        </form>
        {picture && <form method="post" action={`/e/${id}/picture`} encType="multipart/form-data"><p><button className={btn()} type="submit" name="remove" value="1">Take it off</button></p></form>}
      </section>
      <form method="post" action={`/e/${id}/edit`}>
        <h2>What</h2>
        <section className="card">
          <p><label>Kind<br /><select name="kind" defaultValue={e.kind}><Options of={KINDS} /></select></label></p>
          <Text name="name" label="Name" value={e.name} required maxLength={80} />
          <Text name="line" label="One line about it" value={e.line} maxLength={160} />
        </section>
        <div className="two">
          <section>
            <h2>When</h2>
            <div className="card">
              <At name="doors" label="Doors" at={w.doors} />
              <At name="start" label="Starts" at={w.start} />
              <At name="curfew" label="Ends" at={w.curfew} />
              <p className="mut">The crew's day, not on the public page:</p>
              <At name="loadIn" label="Load-in" at={w.loadIn} />
              <At name="soundcheck" label="Soundcheck" at={w.soundcheck} />
              <At name="loadOut" label="Load-out" at={w.loadOut} />
            </div>
          </section>
          <section>
            <h2>Where</h2>
            <div className="card">
              <Text name="address" label="Address" value={e.where.address} maxLength={200} />
              <Text name="lat" label="Map pin: latitude" value={e.where.pin?.lat} type="number" step="any" min={-90} max={90} />
              <Text name="lng" label="Map pin: longitude" value={e.where.pin?.lng} type="number" step="any" min={-180} max={180} />
              <Text name="plan" label="Stage plan's link (not public)" value={e.where.plan} type="url" pattern="https://\S+" maxLength={300} />
            </div>
            <h2>Who</h2>
            <div className="card">
              <p><label>Who may come<br /><select name="access" defaultValue={e.who.access}><Options of={ACCESS} /></select></label></p>
              <Text name="cap" label="Places (empty for no limit)" value={e.who.cap} type="number" min={1} max={CAP_MAX} />
              <Text name="ages" label="Ages" value={e.who.ages} maxLength={40} />
            </div>
          </section>
        </div>
        <h2>There</h2>
        <section className="card">
          <p><label>Line-up, one a line<br /><textarea name="lineup" rows={4} defaultValue={e.there.lineup.join("\n")} style={{ width: "100%", font: "inherit" }} /></label></p>
          <p>On offer</p>
          <Ticks name="offer" of={OFFERS} on={e.there.offers} />
          <p>The RSVP asks for</p>
          <Ticks name="ask" of={ASKS} on={e.there.asks} />
          <p>Set times</p>
          {sets.map((s, i) => (
            <div className="row" key={i}>
              <Text name="set_who" label="Who" value={s?.who} maxLength={80} />
              <At name="set_clock" label="From" at={s?.at} />
              <input type="hidden" name="set_until" value={s?.until ?? ""} />
            </div>
          ))}
        </section>
        <p><button className={btn(true)} type="submit">Save</button></p>
      </form>
    </>
  );
}

export function HostPage({ v }: { v: HostView }) {
  const path = `/e/${v.id}`;
  if (!v.allowed) return (
    <>
      <h1>{v.name}</h1>
      <p>{v.signedIn ? "Your role on this event doesn't run it." : "Sign in to run this event."}</p>
      <p><a href={v.signedIn ? path : `${path}/signin`}>{v.signedIn ? "The event's page" : "Sign in"}</a></p>
    </>
  );
  const g = v.guests, pageLink = (n: number) => `${path}/host?${new URLSearchParams({ q: v.find, page: String(n) })}#guests`;
  const act = (t: string, who: string, label: string, name: string) => (
    <form method="post" action={`${path}/guest`}><input type="hidden" name="t" value={t} /><input type="hidden" name="who" value={who} /><button className={btn()} type="submit" aria-label={`${label} ${name}`}>{label}</button></form>
  );
  return (
    <>
      <p className="row"><a href="/events">Your events</a> <a href={path}>The event's page</a></p>
      <h1>Hosting: {v.name}</h1>
      <Said said={v.said} />
      {v.event && <Edit id={v.id} e={v.event} picture={v.picture} />}
      {g && (
        <>
          <h2 id="guests">Guests</h2>
          <section className="card">
            <form className="row" method="get" action={`${path}/host`}><input className="grow" name="q" aria-label="Find by name" placeholder="Find by name" defaultValue={v.find} maxLength={60} /><button className={btn()} type="submit">Find</button></form>
            <div className="list">
              {g.people.map((p) => <div key={p.id}><b className="grow">{p.name}</b><span className="mut">{[p.role, p.coming].filter(Boolean).join(" · ")}</span>{p.remove && act("revoke", p.id, "Remove", p.name)}{p.block && act("block", p.id, "Block", p.name)}</div>)}
            </div>
            {g.people.length === 0 && <p className="mut">Nobody{v.find ? " by that name" : " yet"}.</p>}
            {(v.page > 0 || g.more) && <p className="row">{v.page > 0 && <a href={pageLink(v.page - 1)}>Earlier</a>}{g.more && <a href={pageLink(v.page + 1)}>More</a>}</p>}
          </section>
        </>
      )}
      {v.blocked.length > 0 && (
        <>
          <h2>Blocked</h2>
          <section className="card list">{v.blocked.map((b) => <div key={b.id}><b className="grow">{b.name}</b>{act("unblock", b.id, "Unblock", b.name)}</div>)}</section>
        </>
      )}
    </>
  );
}
