import { TAG } from "./Document.tsx";

export function Footer() {
  return (
    <footer className="wrap">
      <div className="foot">
        <span>qCRM by QNTBR. {TAG}.</span>
        <a href="/privacy">Privacy</a>
        <a href="/demo">Demo</a>
        <span className="grow" />
        <span>Built with RustyBuns on Cloudflare.</span>
      </div>
    </footer>
  );
}
