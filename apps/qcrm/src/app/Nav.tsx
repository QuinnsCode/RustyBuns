import { Icon } from "./icons.tsx";

export const Nav = ({ inner }: { inner?: boolean }) => (
  <nav className="wrap nav">
    <a className="brand" href="/"><Icon name="waves" size={20} /> q<b>CRM</b></a>
    <span className="grow" />
    {!inner && <a href="/#edge">Why</a>}
    {!inner && <a href="/#mcp">Agents</a>}
    <a href="/privacy">Privacy</a>
    <a className="btn" href="/demo"><Icon name="flask-conical" /> Demo</a>
    <a className="btn primary" href="/app">Sign in</a>
  </nav>
);
