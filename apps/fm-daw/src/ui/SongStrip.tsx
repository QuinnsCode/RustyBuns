// Song mode's strip in the header (src/song.ts): the chain as letters. Click a slot to play the next pattern there,
// + adds a copy of the last slot, the fresh one adds a pattern nobody has used, − drops the last slot, the list icon leaves.
// Icons after lucide (ISC): list-music, plus, minus, sparkles; the word is the tooltip.
import { MAX_CHAIN, PATTERNS, freshPattern, letter, type Song } from "../song.ts";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const LIST = "M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3";
const PLUS = "M5 12h14M12 5v14";
const MINUS = "M5 12h14";
const FRESH = "M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z";

export function SongStrip({ song, bars, onChain }: { song: Song | undefined; bars: number; onChain: (chain: number[] | null) => void }) {
  if (!song) {
    return (
      <div className="field"><span className="silk">Song</span>
        <div className="seg"><button onClick={() => onChain([0])} title={`Song mode: this ${bars}-bar loop becomes pattern A, to chain with others`}><Icon d={LIST} /></button></div>
      </div>
    );
  }
  const { chain } = song, full = chain.length >= MAX_CHAIN || (chain.length + 1) * song.bars > 512;
  const at = (j: number, k: number) => onChain(chain.map((x, i) => (i === j ? k : x)));
  return (
    <div className="field song"><span className="silk">Song · {song.bars} bar{song.bars === 1 ? "" : "s"} a slot</span>
      <div className="seg mini" role="list" aria-label="Song chain">
        {chain.map((k, j) => (
          <button key={j} role="listitem" className={`pat p${k}`} onClick={() => at(j, (k + 1) % PATTERNS)}
            title={`Slot ${j + 1} plays ${letter(k)}: click for ${letter((k + 1) % PATTERNS)}`}>{letter(k)}</button>
        ))}
        <button onClick={() => onChain([...chain, chain[chain.length - 1]])} disabled={full} title={`Add a slot (${letter(chain[chain.length - 1])} again)`}><Icon d={PLUS} /></button>
        <button onClick={() => onChain([...chain, freshPattern(song)])} disabled={full} title={`Add a slot with a new pattern (${letter(freshPattern(song))})`}><Icon d={FRESH} /></button>
        <button onClick={() => onChain(chain.slice(0, -1))} disabled={chain.length < 2} title="Drop the last slot (undo brings it back)"><Icon d={MINUS} /></button>
        <button className="on" onClick={() => onChain(null)} title="Leave song mode: the notes stay where they are"><Icon d={LIST} /></button>
      </div>
    </div>
  );
}
