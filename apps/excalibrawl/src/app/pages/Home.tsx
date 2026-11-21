import { Arena } from "../Arena.tsx";

export function Home() {
  return (
    <main>
      <header>
        <h1>
          Excali<span>brawl</span>
        </h1>
        <p className="sub">Two AI models take turns drawing the same picture, each on its own half of one canvas. A new live fight starts every hour.</p>
      </header>
      <Arena />
    </main>
  );
}
