"use client";

import { useEffect, useRef } from "react";
import { cssColor, loadEngine, waveFrame, type Engine, type WavePalette } from "../engine.ts";

const FALLBACK: WavePalette = { sky: 0x7cc4ff, navy: 0x0b1f3a, cream: 0xf4eee2 };

/** Read the page's palette tokens off :root (the stylesheet defines them per colour scheme). */
function palette(): WavePalette {
  const s = getComputedStyle(document.documentElement);
  return {
    sky: cssColor(s.getPropertyValue("--sky"), FALLBACK.sky),
    navy: cssColor(s.getPropertyValue("--navy"), FALLBACK.navy),
    cream: cssColor(s.getPropertyValue("--cream"), FALLBACK.cream),
  };
}

/**
 * The hero's pixel-art breaking wave: a canvas sized to its container, painted by the wasm
 * shader every animation frame while it is visible. Nothing is drawn until the engine loads,
 * so the CSS gradient behind it is the fallback; the hero text around it is server-rendered.
 */
export function Wave({ pixel = 8 }: { pixel?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let engine: Engine | undefined;
    let raf = 0;
    let stopped = false;
    let visible = true;
    let colours = palette();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let buf = new Uint8Array(0);
    let image: ImageData | undefined;
    const t0 = performance.now();

    const size = () => {
      // Pixel art: one canvas pixel per CSS pixel is plenty, whatever the devicePixelRatio.
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        buf = new Uint8Array(w * h * 4);
        image = new ImageData(new Uint8ClampedArray(buf.buffer), w, h);
      }
    };
    const paint = () => {
      if (!engine) return;
      size();
      waveFrame(engine, buf, canvas.width, canvas.height, (performance.now() - t0) / 1000, pixel, colours);
      if (image) ctx.putImageData(image, 0, 0);
    };
    const running = () => !stopped && visible && document.visibilityState === "visible" && !reduced.matches;
    const loop = () => {
      raf = 0;
      if (!running()) return;
      paint();
      raf = requestAnimationFrame(loop);
    };
    const wake = () => {
      if (!engine) return;
      if (running()) {
        if (!raf) raf = requestAnimationFrame(loop);
      } else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (reduced.matches) paint(); // one still frame for people who asked for no motion
      }
    };
    const recolour = () => {
      colours = palette();
      if (!running()) paint();
    };

    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      wake();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { if (!running()) paint(); });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    reduced.addEventListener("change", wake);
    scheme.addEventListener("change", recolour);

    loadEngine().then((e) => {
      if (stopped) return;
      engine = e;
      wake();
      if (!running()) paint();
    }).catch(() => { /* no engine: the gradient behind the canvas stays */ });

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reduced.removeEventListener("change", wake);
      scheme.removeEventListener("change", recolour);
    };
  }, [pixel]);
  return <canvas ref={ref} aria-hidden="true" className="wave" />;
}
