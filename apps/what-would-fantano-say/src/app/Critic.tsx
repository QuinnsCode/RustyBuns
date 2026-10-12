"use client";

import { useEffect, useRef, useState } from "react";
import { analyze, type Features } from "../analyze.ts";
import type { Review } from "../review.ts";

const RATE = 22050;
const MAX_BYTES = 80 * 1024 * 1024;

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, o: { sitekey: string; callback(t: string): void; "expired-callback"(): void; theme: string }): string; reset(id: string): void };
  }
}

/** Decode in the browser, mixed to mono at 22 kHz, and measure it. Nothing is uploaded. */
async function listen(file: File): Promise<Features> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels;
  }
  return analyze(mono, buf.sampleRate);
}

type Stage = { kind: "idle" } | { kind: "busy"; what: string } | { kind: "done"; review: Review; features: Features | null } | { kind: "error"; message: string };

export function Critic({ siteKey }: { siteKey: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [hint, setHint] = useState("");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  // Turnstile only loads when the deploy has a site key; locally there's none and reviews are canned.
  useEffect(() => {
    if (!siteKey || !widget.current) return;
    const mount = () => {
      if (widgetId.current || !window.turnstile || !widget.current) return;
      widgetId.current = window.turnstile.render(widget.current, { sitekey: siteKey, theme: "dark", callback: setToken, "expired-callback": () => setToken("") });
    };
    if (window.turnstile) return mount();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = mount;
    document.head.appendChild(s);
  }, [siteKey]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return setStage({ kind: "error", message: "That file's over 80 MB. Even double albums aren't that long." });
    setFile(f);
    setLink("");
    setStage({ kind: "idle" });
  };

  async function judge() {
    try {
      let features: Features | null = null;
      if (file) {
        setStage({ kind: "busy", what: "listening (on your device)…" });
        features = await listen(file);
      }
      setStage({ kind: "busy", what: "forming an opinion…" });
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features, hint, title: file ? file.name.replace(/\.[^.]+$/, "") : "", youtube: file ? "" : link, turnstile: token }),
      });
      const body = (await res.json()) as Review & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStage({ kind: "done", review: body, features });
    } catch (e) {
      setStage({ kind: "error", message: e instanceof DOMException ? "Couldn't decode that file. Try an mp3, wav, m4a or ogg." : (e as Error).message });
    } finally {
      if (widgetId.current) { window.turnstile?.reset(widgetId.current); setToken(""); }
    }
  }

  const ready = (file || link.trim()) && (!siteKey || token) && stage.kind !== "busy";

  return (
    <section className="critic">
      <label
        className={`drop${drag ? " over" : ""}${file ? " has" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept="audio/*" onChange={(e) => pick(e.target.files?.[0])} />
        <span className="big">{file ? file.name : "DROP YOUR TRACK"}</span>
        <span className="small">{file ? `${(file.size / 1e6).toFixed(1)} MB · stays on your device` : "or click. mp3, wav, m4a, ogg"}</span>
      </label>

      <div className="or">or</div>
      <input className="field" type="url" placeholder="paste a YouTube link (judged on its title alone)" value={link} disabled={!!file}
        onChange={(e) => setLink(e.target.value)} />
      <input className="field" type="text" maxLength={80} placeholder="sounds like… (optional: 'death grips', 'sad folk', 'hyperpop')" value={hint}
        onChange={(e) => setHint(e.target.value)} />

      {siteKey && <div ref={widget} className="turnstile" />}
      <div className="actions">
        <button className="go" disabled={!ready} onClick={judge}>{stage.kind === "busy" ? stage.what : "JUDGE ME"}</button>
        {file && <button className="clear" onClick={() => { setFile(null); setStage({ kind: "idle" }); }} title="Clear">✕</button>}
      </div>

      {stage.kind === "error" && <p className="error">{stage.message}</p>}
      {stage.kind === "done" && <Card review={stage.review} features={stage.features} />}
    </section>
  );
}

function Card({ review, features }: { review: Review; features: Features | null }) {
  return (
    <article className={`card v-${review.verdict.replace(" ", "-").toLowerCase()}`}>
      <div className="score">
        <span className="verdict">{review.verdict}</span>
        <span className="num">{review.score}</span>
        <span className="of">/10</span>
      </div>
      <h2>{review.headline}</h2>
      <p>{review.review}</p>
      <dl>
        <dt>Best</dt><dd>{review.bestBit}</dd>
        <dt>Worst</dt><dd>{review.worstBit}</dd>
      </dl>
      {features && (
        <p className="nums" title="What the critic 'heard': measured in your browser">
          {features.bpm} BPM · {features.loudnessDb} dBFS · {features.dynamicsDb} dB range · {Math.round(features.bass * 100)}% bass
        </p>
      )}
      {review.by === "canned" && <p className="canned">Canned review: this deploy has no critic on staff.</p>}
    </article>
  );
}
