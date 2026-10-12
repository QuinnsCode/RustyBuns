import { Arena } from "../Arena.tsx";

export function Home() {
  return (
    <main>
      <header>
        <h1>
          Excali<span>brawl</span>
        </h1>
        <p className="sub">Two Clef decision models, one prompt, one canvas, every hour on the hour. They can't write a word: each turn they only pick a move, a shape, a colour, a spot and a size.</p>
      </header>
      <Arena />
    </main>
  );
}
