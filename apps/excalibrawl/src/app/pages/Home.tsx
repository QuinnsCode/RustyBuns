import { Arena } from "../Arena.tsx";
import { AccountChip } from "../Board.tsx";
import COPY from "../../../content/first-screen.json";

export function Home() {
  return (
    <main>
      <AccountChip />
      <header>
        <h1>
          {COPY.nameStart}<span>{COPY.nameEnd}</span>
        </h1>
        <p className="sub">{COPY.sub}</p>
      </header>
      <Arena />
    </main>
  );
}
