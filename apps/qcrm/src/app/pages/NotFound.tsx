import { Footer } from "../Footer.tsx";
import { Nav } from "../Nav.tsx";

export function NotFound() {
  return (
    <>
      <Nav inner />
      <main className="wrap" style={{ maxWidth: 720, display: "grid", gap: 16, paddingTop: 24, paddingBottom: 48 }}>
        <span className="tag">404</span>
        <h1 style={{ fontSize: 40 }}>Nothing here.</h1>
        <p>That page doesn't exist. <a href="/">Back to the home page</a>, or <a href="/app">open the app</a>.</p>
      </main>
      <Footer />
    </>
  );
}
