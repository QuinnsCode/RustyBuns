import type { Review } from "../../write.ts";
import { AccountChip, Shared, TopWeek } from "../Board.tsx";
import { Critic } from "../Critic.tsx";

export function Home({ siteKey, shared }: { siteKey: string; shared: { id: string; post: string; review: Review } | null }) {
  return (
    <main>
      <AccountChip />
      <header>
        <h1>What Would <span>Fantano</span> Say?</h1>
        <p className="sub">Pick your track and your best 15 seconds. Get judged. Only that clip leaves your phone.</p>
      </header>
      {shared ? <Shared {...shared} /> : <Critic siteKey={siteKey} />}
      <TopWeek />
      <footer>Parody. Not affiliated with, endorsed by, or written by any real critic. Clips are judged by AI and not stored; a review's text is kept a day, or for good once shared.</footer>
    </main>
  );
}
