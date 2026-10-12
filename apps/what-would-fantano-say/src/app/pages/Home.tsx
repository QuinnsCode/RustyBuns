import { Critic } from "../Critic.tsx";

export function Home({ siteKey }: { siteKey: string }) {
  return (
    <main>
      <header>
        <h1>What Would <span>Fantano</span> Say?</h1>
        <p className="sub">Drop a track. Get judged. The song stays on your device; only a few numbers about it leave.</p>
      </header>
      <Critic siteKey={siteKey} />
      <footer>Parody. Not affiliated with, endorsed by, or written by any real critic. Reviews are written by AI.</footer>
    </main>
  );
}
