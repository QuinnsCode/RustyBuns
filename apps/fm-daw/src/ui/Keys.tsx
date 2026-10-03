// On-screen keys labelled with the QWERTY letter that plays them.
import { KEY_LABEL } from "./input.ts";
import { noteName } from "./PianoRoll.tsx";

const SPAN = 18;
const isBlack = (s: number) => [1, 3, 6, 8, 10].includes(((s % 12) + 12) % 12);

export function Keys(props: {
  base: number; // midi of the A key
  octave: number;
  held: Set<number>;
  midiDevices: string[];
  color: string;
  onKey(midi: number, on: boolean): void;
  onOctave(d: number): void;
}) {
  const whites = Array.from({ length: SPAN }, (_, s) => s).filter((s) => !isBlack(s));
  return (
    <section className="keys-bar" style={{ "--track": props.color } as React.CSSProperties} aria-label="Keyboard">
      <div className="oct">
        <button className="ghost" onClick={() => props.onOctave(-1)} title="Octave down (Z)"><kbd>Z</kbd> −</button>
        <span className="silk">Oct {props.octave >= 0 ? `+${props.octave}` : props.octave}</span>
        <button className="ghost" onClick={() => props.onOctave(1)} title="Octave up (X)">+ <kbd>X</kbd></button>
      </div>
      <div className="keys" style={{ "--whites": whites.length } as React.CSSProperties}>
        {Array.from({ length: SPAN }, (_, s) => {
          const m = props.base + s;
          const white = !isBlack(s);
          const wi = whites.indexOf(white ? s : s - 1);
          const down = props.held.has(m);
          return (
            <button
              key={s}
              className={`${white ? "key white" : "key black"}${down ? " down" : ""}`}
              style={{ "--i": wi } as React.CSSProperties}
              aria-label={noteName(m)}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); props.onKey(m, true); }}
              onPointerUp={() => props.onKey(m, false)}
              onPointerCancel={() => props.onKey(m, false)}
            >
              <span className="kl">{KEY_LABEL[s]}</span>
              {s === 0 && <span className="kn">{noteName(m)}</span>}
            </button>
          );
        })}
      </div>
      <p className="dim keys-help">
        Letters play, <kbd>Shift</kbd> accents. {props.midiDevices.length
          ? <>MIDI: <strong>{props.midiDevices.join(", ")}</strong></>
          : "Plug in a MIDI keyboard any time."}
      </p>
    </section>
  );
}
