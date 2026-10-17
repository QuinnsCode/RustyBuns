"use client";

import { useEffect, useRef, useState } from "react";
import { analyze, type Features } from "../analyze.ts";
import { CLIP_SECONDS, RATE, clock, cut, encodeWav, loudestWindow, peaks } from "../clip.ts";
import { decode } from "../decode.ts";
import type { Review } from "../write.ts";

const MAX_BYTES = 200 * 1024 * 1024;
// The browser decodes mp3, wav, aac/m4a, flac, ogg/opus and the audio in mp4/mov/webm video;
// anything else ffmpeg.wasm converts on the device. The extensions help iOS's picker.
const ACCEPT = "audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.webm,.mp4,.mov,.mkv,.aif,.aiff,.caf,.wma,.ape,.wv,.amr,.ac3";

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, o: { sitekey: string; callback(t: string): void; "expired-callback"(): void; "error-callback"(code?: string): boolean | void; theme: string }): string; reset(id: string): void };
  }
}

interface Track { name: string; samples: Float32Array; features: Features; bars: number[]; duration: number }

/** Web Audio's decoder at 16 kHz, mixed to mono. */
async function native(bytes: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(bytes);
  const samples = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i]! += ch[i]! / buf.numberOfChannels;
  }
  return samples;
}

/** ffmpeg.wasm, fetched only when the browser can't decode a file, so it stays off the first load. */
async function convert(bytes: Uint8Array, name: string, onProgress: (ratio: number) => void): Promise<Float32Array> {
  return (await import("./ffmpeg.ts")).convert(bytes, name, onProgress);
}

/** Decode on the device at 16 kHz mono, measure. Nothing is uploaded here. */
async function load(file: File, onConvert: (ratio: number) => void): Promise<Track> {
  const { samples } = await decode(file, { native, convert }, onConvert);
  return { name: file.name.replace(/\.[^.]+$/, ""), samples, features: analyze(samples, RATE), bars: peaks(samples, 120), duration: samples.length / RATE };
}

function toDataUrl(wav: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

type Stage = { kind: "idle" } | { kind: "busy"; what: string } | { kind: "done"; review: Review } | { kind: "error"; message: string };

export function Critic({ siteKey }: { siteKey: string }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [start, setStart] = useState(0);
  const [link, setLink] = useState("");
  const [hint, setHint] = useState("");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [playing, setPlaying] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const player = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);

  // Turnstile only loads when the deploy has a site key; locally there's none and reviews are estimates.
  useEffect(() => {
    if (!siteKey || !widget.current) return;
    const mount = () => {
      if (widgetId.current || !window.turnstile || !widget.current) return;
      widgetId.current = window.turnstile.render(widget.current, { sitekey: siteKey, theme: "dark", callback: setToken, "expired-callback": () => setToken(""),
        // A hostname missing from the widget, or a bad site key, lands here: say so instead of a dead button.
        "error-callback": (code) => { setStage({ kind: "error", message: `The human check didn't load (error ${code ?? "unknown"}). This site's address may not be on the widget's list.` }); return true; } });
    };
    if (window.turnstile) return mount();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = mount;
    s.onerror = () => setStage({ kind: "error", message: "The human check script was blocked or offline. Reload to try again." });
    document.head.appendChild(s);
  }, [siteKey]);

  const stop = () => { player.current?.src.stop(); player.current?.ctx.close(); player.current = null; setPlaying(false); };
  useEffect(() => stop, []);

  async function pick(f: File | undefined) {
    if (!f) return;
    stop();
    if (f.size > MAX_BYTES) return setStage({ kind: "error", message: "That file's over 200 MB. Even a double album isn't that long." });
    setStage({ kind: "busy", what: "decoding on your device…" });
    try {
      const t = await load(f, (r) => setStage({ kind: "busy", what: r >= 0.01 ? `converting… ${Math.round(r * 100)}%` : "converting on your device…" }));
      setTrack(t);
      setStart(loudestWindow(t.samples, RATE));
      setLink("");
      setStage({ kind: "idle" });
    } catch {
      setStage({ kind: "error", message: "Couldn't decode that one, even with the converter. Try mp3, wav, m4a, flac or ogg." });
    }
  }

  function preview() {
    if (playing || !track) return stop();
    const ctx = new AudioContext();
    const clip = cut(track.samples, RATE, start);
    const buf = ctx.createBuffer(1, clip.length, RATE);
    buf.getChannelData(0).set(clip);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = stop;
    src.start();
    player.current = { ctx, src };
    setPlaying(true);
  }

  async function judge() {
    stop();
    try {
      setStage({ kind: "busy", what: "listening…" });
      const clip = track ? toDataUrl(encodeWav(cut(track.samples, RATE, start), RATE)) : "";
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: track?.features ?? null, clip, hint, title: track?.name ?? "", youtube: track ? "" : link, turnstile: token }),
      });
      const body = (await res.json()) as Review & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStage({ kind: "done", review: body });
    } catch (e) {
      setStage({ kind: "error", message: (e as Error).message });
    } finally {
      if (widgetId.current) { window.turnstile?.reset(widgetId.current); setToken(""); }
    }
  }

  const busy = stage.kind === "busy";
  const ready = (track || link.trim()) && (!siteKey || token) && !busy;

  return (
    <section className="critic">
      {!track ? (
        <label className="drop">
          <input type="file" accept={ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
          <span className="big">{busy ? stage.what : "PICK YOUR TRACK"}</span>
          <span className="small">any audio or video file · decoded on your device</span>
        </label>
      ) : (
        <ClipPicker track={track} start={start} setStart={(s) => { stop(); setStart(s); }} playing={playing} onPreview={preview}
          onClear={() => { stop(); setTrack(null); setStage({ kind: "idle" }); }} />
      )}

      {!track && (
        <input className="field" type="url" inputMode="url" placeholder="…or paste a YouTube link (judged on its title)" value={link} onChange={(e) => setLink(e.target.value)} />
      )}
      <input className="field" type="text" maxLength={80} placeholder="sounds like… (optional)" value={hint} onChange={(e) => setHint(e.target.value)} />

      {siteKey && <div ref={widget} className="turnstile" />}
      <button className="go" disabled={!ready} onClick={judge}>{busy && track ? stage.what : "JUDGE ME"}</button>

      {stage.kind === "error" && <p className="error">{stage.message}</p>}
      {stage.kind === "done" && <Card review={stage.review} />}
    </section>
  );
}

/** The waveform with a draggable window: the listener picks the 15 seconds that get judged. */
function ClipPicker({ track, start, setStart, playing, onPreview, onClear }: {
  track: Track; start: number; setStart(s: number): void; playing: boolean; onPreview(): void; onClear(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const span = Math.min(CLIP_SECONDS, track.duration);
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const t = ((clientX - r.left) / r.width) * track.duration - span / 2;
    setStart(Math.max(0, Math.min(track.duration - span, t)));
  };
  return (
    <div className="picker">
      <div className="picker-head">
        <span className="name">{track.name}</span>
        <button className="icon" onClick={onClear} title="Pick another track" aria-label="Pick another track">✕</button>
      </div>
      <div className="wave" ref={box}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e.clientX); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e.clientX); }}>
        {track.bars.map((h, i) => <i key={i} style={{ height: `${Math.max(4, h * 100)}%` }} />)}
        <div className="window" style={{ left: `${(start / track.duration) * 100}%`, width: `${(span / track.duration) * 100}%` }} />
      </div>
      <div className="picker-foot">
        <button className="icon play" onClick={onPreview} title={playing ? "Stop" : "Play this bit"} aria-label={playing ? "Stop" : "Play this bit"}>{playing ? "■" : "▶"}</button>
        <span className="when">{clock(start)}–{clock(start + span)}</span>
        <span className="tip">drag to pick your best {CLIP_SECONDS}s</span>
      </div>
    </div>
  );
}

function Card({ review }: { review: Review }) {
  const [shared, setShared] = useState(false);
  async function share() {
    const text = `What Would Fantano Say? ${review.verdict} ${review.score}/10: "${review.headline}"`;
    try {
      if (navigator.share) await navigator.share({ text, url: location.origin });
      else { await navigator.clipboard.writeText(`${text} ${location.origin}`); setShared(true); }
    } catch { /* the share sheet was closed */ }
  }
  return (
    <article className={`card v-${review.verdict.replace(" ", "-").toLowerCase()}`}>
      <div className="score">
        <span className="verdict">{review.verdict}</span>
        <span className="num">{review.score}</span>
        <span className="of">/10</span>
      </div>
      <p className="box">{review.box}</p>
      <h2>{review.headline}</h2>
      <p>{review.review}</p>
      <dl>
        <dt>Best</dt><dd>{review.bestBit}</dd>
        <dt>Worst</dt><dd>{review.worstBit}</dd>
      </dl>
      {review.by === "estimate" && <p className="canned">Estimated from the numbers: the critic didn't listen to this one.</p>}
      <button className="share" onClick={share}>{shared ? "COPIED" : "SHARE"}</button>
    </article>
  );
}
