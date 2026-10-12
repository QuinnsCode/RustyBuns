import { Critic } from "../Critic.tsx";

export function Home({ siteKey }: { siteKey: string }) {
  return (
    <main>
      <header>
        <h1>What Would <span>Fantano</span> Say?</h1>
        <p className="sub">Pick your track and your best 15 seconds. Get judged. Only that clip leaves your phone.</p>
      </header>
      <Critic siteKey={siteKey} />
      <footer>Parody. Not affiliated with, endorsed by, or written by any real critic. Clips are judged by AI and not stored.</footer>
    </main>
  );
}
