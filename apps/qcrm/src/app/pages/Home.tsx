import { TAG } from "../Document.tsx";
import { Icon } from "../icons.tsx";
import { Footer } from "../Footer.tsx";
import { Nav } from "../Nav.tsx";
import { Wave } from "../Wave.tsx";

// What a CRM usually doesn't offer, and this one does. Each card names one thing qCRM has that the usual suspects charge extra for or lack.
const EDGE = [
  { icon: "plug", title: "Your agents, plugged in", body: "An MCP server is built in. Claude (OpenAI and the rest soon) reads, searches and writes contacts and deals through the same scoped API your team uses, with an API key your owner can revoke." },
  { icon: "cpu", title: "A Rust engine, in your browser", body: "Dedupe, forecasts and stale-deal sweeps run in a Rust wasm engine on your machine. Your rows never leave to be analysed, and it stays fast at 100,000 contacts." },
  { icon: "monitor", title: "A desktop app, for free", body: "The same app ships as a desktop build with its own SQLite: works offline, syncs when it's back, and the data dir is yours." },
  { icon: "refresh-cw", title: "Office sync", body: "Every write lands in a change log with a sequence number. Any client, desktop or script asks since=N and gets exactly what changed. Conflicts come back named, not lost." },
  { icon: "webhook", title: "Signed webhooks", body: "Every event posts to your URLs with an HMAC signature, retried with backoff for a day, and each delivery is on record with its status code." },
  { icon: "lock-keyhole", title: "Hashed orgs, real roles", body: "An org's id is a hash of its owner's account and the server secret, so URLs carry nothing a stranger can walk back to a person. Seasonal, employee, manager, owner, admin and a super admin: who can delete, invite or export is one table you can read." },
  { icon: "download", title: "Export and delete, for real", body: "One request gives an owner every row of their org as JSON. One request deletes an account, its orgs and all their rows. Privacy isn't a page here; it's two routes." },
  { icon: "brain-circuit", title: "Private AI, opt-in", body: "Analysis runs locally. When you choose, the engine can hand summaries to a model you run yourself. Nothing leaves without a click." },
  { icon: "phone", title: "Calls and recordings (soon)", body: "Clave, QNTBR's call tool with Whisper transcripts processed mostly on the client, will ship the way the engine does: sealed, and opened by a lease from artstewengine." },
];

export function Home() {
  return (
    <>
      <Nav />
      <main className="wrap">
        <section className="hero" id="hero">
          <Wave />
          <div className="copy">
            <span className="tag">{TAG}</span>
            <h1>The CRM your agents can use.</h1>
            <p>Contacts, companies, deals and activities for a real place of business. MCP in, a Rust engine for the heavy lifting, sync across the office, signed webhooks out, and every row yours to export or delete. Light on the bill, warm on the eyes.</p>
            <div className="cta">
              <a className="btn primary" href="/demo" id="cta-demo"><Icon name="flask-conical" /> Try the demo</a>
              <a className="btn ghost" href="/app"><Icon name="log-out" /> Sign in</a>
              <button className="btn ghost" type="button" data-tour-start><Icon name="waves" /> Take the tour</button>
            </div>
          </div>
        </section>

        <section className="block" id="edge">
          <span className="tag">What you get</span>
          <h2>What the usual suspects charge extra for, or can't do.</h2>
          <p className="lead">qCRM runs on Cloudflare Workers and D1 with a SQLite twin for the desktop. One Worker, one database, one price that stays small.</p>
          <div className="grid">
            {EDGE.map((f) => (
              <article className="card" key={f.title}>
                <h3><Icon name={f.icon} /> {f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="block" id="mcp">
          <span className="tag">Connect an agent</span>
          <h2>Two lines and Claude is in your CRM.</h2>
          <p className="lead">An owner makes an API key under Settings. The MCP server lists one tool per API operation, and the risky ones (deletes, members, exports) say so, so a careful agent asks first.</p>
          <div className="codebox">
            <pre className="code" id="mcp-cmd">{`claude mcp add --transport http qcrm https://qcrm.qntbr.com/api/mcp \\
  --header "Authorization: Bearer qk_…"`}</pre>
            <button className="btn copy" type="button" data-copy="#mcp-cmd" title="Copy" aria-label="Copy command"><Icon name="copy" /></button>
          </div>
        </section>

        <section className="block" id="privacy-pitch">
          <span className="tag">Privacy and security</span>
          <h2>Built so the easy thing is the safe thing.</h2>
          <div className="grid">
            <article className="card"><h3><Icon name="lock-keyhole" /> Every query is scoped</h3><p>No row is read without its org id in the WHERE. A contact in another org is a 404, not a 403, so ids don't leak what exists.</p></article>
            <article className="card"><h3><Icon name="shield-check" /> Sessions by Better Auth</h3><p>Email and password, with GitHub and Google when the keys are set. Cookie writes check the origin, so a stranger's page can't post as you.</p></article>
            <article className="card"><h3><Icon name="scroll-text" /> An audit log that stays</h3><p>Members, roles, webhooks and keys are logged with who and when. Managers read it; nobody edits it.</p></article>
            <article className="card"><h3><Icon name="key-round" /> Secrets never on disk</h3><p>Deploy secrets resolve through 1Password at deploy time. The repo carries names, never values.</p></article>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
