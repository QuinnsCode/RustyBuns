// An event's public page and its door (QOLLAB.md "Events"). Plain forms and links, so they work on any phone with no script;
// the one script (commands.client.ts) shows times in the reader's own zone and runs the door's camera (door.client.ts).
import type { DoorView, EventView } from "../event-pages.ts";
import { DOOR_SAYS } from "../qollab/rsvp.ts";
import { btn } from "./Glass.tsx";

/** What a form's post came back with, in words. */
const SAID: Record<string, string> = {
  coming: "You're on the list.", cancelled: "Sorry you can't make it. Your RSVP is gone.", joined: "You're on the crew.", invited: "Invite link made: it's below.",
  full: "Sorry, this event is full: the cap is reached.", noplus: "There's no room left for a plus-one.", invite: "This event is invite only. Ask the host for an invite link.",
  blocked: "The host isn't taking an RSVP from this account.", list: "The guest list is full.", busy: "Lots of people at once. Try again.", cantinvite: "You can't make that invite.", gone: "This event is gone.",
};
const GOOD = new Set(["coming", "cancelled", "joined", "invited"]);

/** In UTC from here; the page's script turns each into the reader's own time. */
const Time = ({ at }: { at: number }) => (
  <time dateTime={new Date(at).toISOString()} data-local>
    {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(at)} UTC
  </time>
);
const Qr = ({ svg, label }: { svg: string; label: string }) => (
  <div role="img" aria-label={label} style={{ width: "14rem", maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
);

function Rsvp({ v }: { v: EventView }) {
  const { event: e, answers: a } = v, path = `/e/${e.id}`;
  const full = e.who.cap !== undefined && v.taken >= e.who.cap;
  if (!v.me) return (
    <p><a className={btn(true)} href={`${path}/signin${v.code ? `?invite=${v.code}` : ""}`}>Sign in to RSVP</a> <span className="mut">with an eqosys account</span></p>
  );
  if (v.crewRole) return (
    <form method="post" action={`${path}/join`}><input type="hidden" name="invite" value={v.code} /><button className={btn(true)} type="submit">Join the crew as {v.crewRole}</button></form>
  );
  if (!v.mayRsvp) return <p>{SAID.invite}</p>;
  if (full && !a) return <p>{SAID.full}</p>;
  return (
    <>
      <form method="post" action={`${path}/rsvp`}>
        {v.code && <input type="hidden" name="invite" value={v.code} />}
        {e.there.asks.includes("plus-one") && <p><label><input type="checkbox" name="plus" value="yes" defaultChecked={a?.plus} style={{ width: "auto" }} /> I'm bringing a plus-one</label></p>}
        {e.there.asks.includes("food-needs") && <p><label>Food needs<br /><input name="food" maxLength={200} defaultValue={a?.food} /></label></p>}
        {e.there.asks.includes("song") && <p><label>A song you want to hear<br /><input name="song" maxLength={120} defaultValue={a?.song} /></label></p>}
        <button className={btn(true)} type="submit">{a ? "Save my answers" : `I'm coming, ${v.me.name}`}</button>
      </form>
      {a && <form method="post" action={`${path}/cancel`}><p><button className={btn()} type="submit">I can't make it</button></p></form>}
    </>
  );
}

export function EventPage({ v }: { v: EventView }) {
  const { event: e, host } = v, path = `/e/${e.id}`, w = e.when;
  return (
    <>
      <figure className="card mut" style={{ margin: "0 0 1rem", minHeight: "9rem", display: "grid", placeItems: "center" }}>A picture goes here</figure>
      <h1>{e.name}</h1>
      <p className="mut">{[e.line, `Hosted by ${e.host}`].filter(Boolean).join(" · ")}</p>
      {v.said && SAID[v.said] && <p role="status" className={GOOD.has(v.said) ? undefined : "bad"}>{SAID[v.said]}</p>}
      <div className="two">
        <section className="card">
          <h2>When</h2>
          {w.doors !== undefined && <p>Doors <Time at={w.doors} /></p>}
          {w.start !== undefined && <p>Starts <Time at={w.start} /></p>}
          {w.curfew !== undefined && <p>Ends <Time at={w.curfew} /></p>}
          {!v.dated && <p className="mut">No date yet.</p>}
          {w.sets.map((s, i) => <p key={i}>{s.who}: <Time at={s.at} /></p>)}
          {v.dated && <p><a href={`${path}/event.ics`}>Add to my calendar</a></p>}
        </section>
        <section className="card">
          <h2>Where</h2>
          <p>{e.where.address || <span className="mut">Not said yet.</span>}</p>
          {e.where.pin && <p><a rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${e.where.pin.lat}&mlon=${e.where.pin.lng}#map=17/${e.where.pin.lat}/${e.where.pin.lng}`}>Map</a></p>}
          <p className="mut">{[{ anyone: "Anyone can turn up", rsvp: "RSVP to come", invite: "Invite only" }[e.who.access], e.who.ages, e.who.cap !== undefined && `${Math.max(0, e.who.cap - v.taken)} of ${e.who.cap} places left`, ...e.there.offers].filter(Boolean).join(" · ")}</p>
          {e.there.lineup.length > 0 && <p>Line-up: {e.there.lineup.join(", ")}</p>}
        </section>
      </div>
      <h2>RSVP</h2>
      <section className="card"><Rsvp v={v} /></section>
      {v.tickets.length > 0 && (
        <>
          <h2>Your {v.tickets.length > 1 ? "tickets" : "ticket"}</h2>
          <p className="mut">Show this at the door. Each ticket lets one person in, once.</p>
          <div className="row">{v.tickets.map((svg, i) => <figure className="card" style={{ margin: 0 }} key={i}><Qr svg={svg} label={`Ticket ${i + 1}`} /><figcaption>{i ? "Your plus-one" : v.me?.name}</figcaption></figure>)}</div>
        </>
      )}
      <h2>Share</h2>
      <section className="card"><Qr svg={v.qr} label="QR code for this page" /><p><a href={v.url}>{v.url}</a></p></section>
      {(host.owner || host.door || host.roles.length > 0) && (
        <>
          <h2 id="host">Hosting</h2>
          <section className="card">
            <p className="row">
              {host.door && <a className={btn(true)} href={`${path}/door`}>Door mode</a>}
              {host.owner && <a className={btn()} href={`${path}/list.csv`}>Download the guest list (CSV)</a>}
            </p>
            {host.roles.length > 0 && (
              <form className="row" method="post" action={`${path}/invite`}>
                <select name="role" aria-label="Role" defaultValue="guest">{host.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                <button className={btn()} type="submit">Make an invite link</button>
              </form>
            )}
            <div className="list">{host.links.map((l) => <div key={l.url}><b>{l.role}</b><a href={l.url} style={{ overflowWrap: "anywhere" }}>{l.url}</a></div>)}</div>
            {host.owner && <p className="row">{["Invite emails", "Reminder emails", "Thank-you emails"].map((n) => <button key={n} className={btn()} type="button" disabled>{n}: coming soon</button>)}</p>}
          </section>
        </>
      )}
    </>
  );
}

export function DoorPage({ v }: { v: DoorView }) {
  const path = `/e/${v.id}`;
  if (!v.allowed) return (
    <>
      <h1>{v.name}</h1>
      <p>{v.signedIn ? "Your role on this event doesn't work the door." : "Sign in to work the door, then scan again."}</p>
      <p><a href={v.signedIn ? path : `${path}/signin`}>{v.signedIn ? "The event's page" : "Sign in"}</a></p>
    </>
  );
  const said = v.said in DOOR_SAYS ? v.said as keyof typeof DOOR_SAYS : null;
  return (
    <>
      <h1>Door: {v.name}</h1>
      <p style={{ fontSize: "2rem", margin: ".5rem 0" }}><b id="door-in">{v.in}</b>{v.cap !== undefined && <> of {v.cap}</>} in</p>
      <p id="door-said" role="status" className={said && said !== "in" ? "bad" : undefined} style={{ fontSize: "1.3rem" }}>{said ? DOOR_SAYS[said] : ""}</p>
      {v.seen && !said && (
        <section className="card">
          {v.seen.state === "ok" ? (
            <form method="post" action={`${path}/scan`}>
              <input type="hidden" name="ticket" value={v.ticket} />
              <p><b>{v.seen.who}</b></p>
              <button className={btn(true)} type="submit">Let them in</button>
            </form>
          ) : <p className="bad">{DOOR_SAYS[v.seen.state]} {v.seen.who}</p>}
        </section>
      )}
      <div id="door-camera" data-scan={`${path}/scan`}>
        <p className="mut">Point this phone's camera app at a ticket and open the link, or paste a ticket here.</p>
      </div>
      <form className="row" method="post" action={`${path}/scan`}>
        <input className="grow" name="ticket" aria-label="Ticket" placeholder="Ticket" required autoComplete="off" />
        <button className={btn()} type="submit">Check it</button>
      </form>
      <p><a href={path}>The event's page</a></p>
    </>
  );
}
