import { Arena } from "../Arena.tsx";
import COPY from "../../../content/first-screen.json";

export function Home() {
  return (
    <main>
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
