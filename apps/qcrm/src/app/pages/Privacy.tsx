import { Footer } from "../Footer.tsx";
import { Nav } from "../Nav.tsx";

// Short, true, and matched by routes: /api/orgs/:org/export and DELETE /api/me do what this page says.
export function Privacy() {
  return (
    <>
      <Nav inner />
      <main className="wrap" style={{ maxWidth: 720, display: "grid", gap: 16, paddingTop: 24, paddingBottom: 48 }}>
        <span className="tag">Privacy</span>
        <h1 style={{ fontSize: 40 }}>Your rows are yours.</h1>
        <p>qCRM stores what your org types in: contacts, companies, deals, activities, members, webhooks and an audit log of who changed what. It stores nothing it doesn't show you.</p>
        <h2>What we keep</h2>
        <p>Your account (email, name, a password hash, or a GitHub or Google account if this host offers those sign-ins), your sessions (expiry, IP and browser string, for your own session list), and your orgs' rows. Deploy logs drop query strings. We never log emails or row contents.</p>
        <h2>Where it lives</h2>
        <p>One Cloudflare D1 database for the hosted service, in Cloudflare's network. The desktop app keeps a sqlite file in your home folder and talks to no server unless you add a sync target.</p>
        <h2>Who can see it</h2>
        <p>Members of your org, by role. QNTBR's super admin account can list orgs and grant an admin when an owner is locked out; it is never a member and every use is in your audit log.</p>
        <h2>Take it or bury it</h2>
        <p>An owner downloads every row of the org as one JSON file from Settings (GET /api/orgs/:org/export). Anyone deletes their account, the orgs they own and all of their rows from Settings (DELETE /api/me). Both happen at once, not after a review.</p>
        <h2>Agents</h2>
        <p>An agent connected through MCP acts under an API key an owner made, with that owner's org and no more. Keys show their first eight characters and last use, and revoke at once.</p>
        <h2>Demo</h2>
        <p>The demo org is seeded with made-up people and is deleted within 24 hours of being made. Don't type anything real into it.</p>
        <p className="muted">Questions: hello@qntbr.com</p>
      </main>
      <Footer />
    </>
  );
}
