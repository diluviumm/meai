"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Orbital health view.
 *
 * WebGL (Three.js) is the primary renderer. If WebGL is unavailable, the
 * component falls back to the original Canvas 2D projection, so low-end
 * devices and headless agents still get a readable chart.
 */
function colorFor(score) {
  return score >= 80 ? 0x10b981 : score >= 60 ? 0xf59e0b : 0xef4444;
}

function drawFallback(canvas, items, reduce) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
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
}

export default function OrbitalHealth({ items = [] }) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState("webgl");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let raf = 0;
    let renderer = null;
    let scene = null;
    let camera = null;
    let group = null;
    let observer = null;
    let fallbackCleanup = null;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
    const sorted = [...items].slice(0, 12);

    const boot = async () => {
      try {
        if (!window.WebGLRenderingContext) throw new Error("WebGL tidak tersedia");
        const THREE = await import("three");
        if (disposed) return;
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0, 14);
        group = new THREE.Group();
        group.rotation.x = -0.32;
        scene.add(group);

        const center = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.25, 2),
          new THREE.MeshBasicMaterial({ color: 0x5d4fb0, wireframe: true, transparent: true, opacity: 0.55 }),
        );
        group.add(center);

        const max = Math.max(1, ...sorted.map((item) => item.requests || 0));
        sorted.forEach((item, index) => {
          const score = item.score == null ? 50 : item.score;
          const radius = 2.4 + 3.4 * ((item.requests || 0) / max);
          const angle = (index / Math.max(1, sorted.length)) * Math.PI * 2;
          const orb = new THREE.Mesh(
            new THREE.SphereGeometry(0.22 + Math.min(0.35, Math.sqrt(item.requests || 0) / 80), 16, 16),
            new THREE.MeshBasicMaterial({ color: colorFor(score), transparent: true, opacity: 0.9 }),
          );
          orb.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.38, Math.sin(angle) * 1.4);
          orb.userData.baseY = orb.position.y;
          orb.userData.phase = angle;
          group.add(orb);
        });

        const ringMaterial = new THREE.LineBasicMaterial({ color: 0x8f86d8, transparent: true, opacity: 0.18 });
        for (let ring = 1; ring <= 3; ring += 1) {
          const points = [];
          for (let step = 0; step <= 96; step += 1) {
            const angle = (step / 96) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(angle) * ring * 2.1, Math.sin(angle) * ring * 2.1 * 0.38, 0));
          }
          group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), ringMaterial));
        }

        const resize = () => {
          const rect = canvas.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          renderer.setSize(rect.width, rect.height, false);
          camera.aspect = rect.width / rect.height;
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();

        const animate = (now) => {
          if (disposed) return;
          if (!reduce) {
            group.rotation.y += 0.003;
            group.children.forEach((child) => {
              if (child.userData?.baseY != null) child.position.y = child.userData.baseY + Math.sin(now / 900 + child.userData.phase) * 0.12;
            });
          }
          renderer.render(scene, camera);
          if (!reduce) raf = requestAnimationFrame(animate);
        };
        setMode("webgl");
        animate(performance.now());
      } catch {
        if (disposed) return;
        setMode("2d");
        fallbackCleanup = drawFallback(canvas, sorted, reduce);
      }
    };

    boot();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      fallbackCleanup?.();
      if (scene) {
        scene.traverse?.((object) => {
          object.geometry?.dispose?.();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
          else object.material?.dispose?.();
        });
      }
      renderer?.dispose?.();
    };
  }, [items]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-bg-subtle">
      <canvas ref={canvasRef} className="block h-48 w-full" role="img" aria-label="Orbital health 3D: ukuran orb menunjukkan request, warna menunjukkan health score" />
      <div className="pointer-events-none absolute left-2 top-2 text-[10px] text-text-muted">Orbital health · {mode === "webgl" ? "WebGL 3D" : "2D fallback"}</div>
    </div>
  );
}
