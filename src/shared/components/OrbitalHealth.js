"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight 3D orbital health view.
 * Canvas 2D projection is intentional: no WebGL dependency, no shader compile,
 * and it keeps the dashboard smooth on low-end mobile devices.
 */
export default function OrbitalHealth({ items = [] }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let start = performance.now();
    let raf = 0;

    const draw = (now) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const t = reduce ? 0 : (now - start) / 1800;
      const max = Math.max(1, ...items.map((item) => item.requests || 0));
      const radiusBase = Math.min(rect.width, rect.height) * 0.31;

      ctx.strokeStyle = "rgba(148,148,159,.18)";
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 3; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, radiusBase * ring / 3, radiusBase * ring / 3 * 0.38, -0.35, 0, Math.PI * 2);
        ctx.stroke();
      }

      const sorted = [...items].slice(0, 10);
      sorted.forEach((item, index) => {
        const angle = t + (index / Math.max(1, sorted.length)) * Math.PI * 2;
        const orbit = radiusBase * (0.55 + 0.45 * ((item.requests || 0) / max));
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit * 0.38;
        const z = (Math.sin(angle) + 1) / 2;
        const size = 5 + z * 8 + Math.min(10, Math.sqrt(item.requests || 0) / 8);
        const score = item.score == null ? 50 : item.score;
        const color = score >= 80 ? "16,185,129" : score >= 60 ? "245,158,11" : "239,68,68";
        ctx.beginPath();
        ctx.fillStyle = `rgba(${color},${0.35 + z * 0.6})`;
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${color},.8)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (index < 5) {
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "rgba(148,148,159,.9)";
          ctx.fillText(String(item.name || "").slice(0, 18), x + size + 3, y + 3);
        }
      });

      ctx.beginPath();
      ctx.fillStyle = "rgba(93,79,176,.18)";
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(93,79,176,.9)";
      ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${sorted.length}`, cx, cy + 3);
      ctx.textAlign = "start";
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    const onResize = () => { if (reduce) draw(performance.now()); };
    draw(performance.now());
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [items]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-bg-subtle">
      <canvas ref={canvasRef} className="block h-48 w-full" role="img" aria-label="Orbital health 3D: ukuran orb menunjukkan request, warna menunjukkan health score" />
      <div className="pointer-events-none absolute left-2 top-2 text-[10px] text-text-muted">Orbital health · 3D projection</div>
    </div>
  );
}
