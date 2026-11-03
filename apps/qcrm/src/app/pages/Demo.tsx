import { TAG } from "../Document.tsx";
import { Icon } from "../icons.tsx";
import { Nav } from "../Nav.tsx";

// The site inside the site: a throwaway org on the shared 10,000-contact snapshot, in a frame, under a banner that says so.
// The frame loads /app?demo=1, which asks /api/demo for its own account and cookie. A demo lasts an hour, three a day per visitor.
export function Demo() {
  return (
    <>
      <Nav inner />
      <main className="wrap">
        <div className="banner" role="status">
          <Icon name="info" />
          <span><strong>This is a test of the site, inside the site.</strong> The frame below is a real qCRM org with 10,000 contacts, on a throwaway account that lasts one hour (three a day). Click around, break things, connect an agent. Nothing here is anyone's real data.</span>
        </div>
        <div className="frame" id="demo-frame">
          <div className="chrome"><i /><i /><i /><span className="url">qcrm.qntbr.com/app · {TAG}</span><span className="pill">demo</span></div>
          <iframe src="/app?demo=1" title="qCRM demo" loading="eager" />
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          Want the demo full-screen? <a href="/app?demo=1">Open it as its own page</a>. Want your own org? <a href="/app">Sign in</a>.
        </p>
      </main>
    </>
  );
}
