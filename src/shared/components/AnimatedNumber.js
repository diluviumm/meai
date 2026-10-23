"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Count-up value for KPI cards. Respects prefers-reduced-motion and keeps the
 * final formatted value on every animation frame, so screen readers and tests
 * never observe "NaN" or an empty string.
 */
export default function AnimatedNumber({ value, format = (n) => String(n), duration = 650 }) {
  const target = Number(value);
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [shown, setShown] = useState(safeTarget);
  const previous = useRef(safeTarget);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      previous.current = safeTarget;
      const timer = setTimeout(() => setShown(safeTarget), 0);
      return () => clearTimeout(timer);
    }
    const from = previous.current;
    const started = performance.now();
    let raf = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (safeTarget - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else previous.current = safeTarget;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safeTarget, duration]);

  return <>{format(shown)}</>;
}
