"use client";

import { useEffect, useRef, useState } from "react";

/** Motion primitives: scroll reveal and counting numbers. All respect prefers-reduced-motion. */

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Fades and lifts its children in when they scroll into view. `delay` in ms staggers siblings. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div", style, ...rest }: { children: React.ReactNode; delay?: number; className?: string; as?: any; style?: React.CSSProperties; [k: string]: unknown }) {
  const ref = useRef<HTMLElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ?reveal=all shows everything at once (full-page screenshots, headless renders)
    if (location.search.includes("reveal=all")) { document.documentElement.classList.add("reveal-all"); setOn(true); return; }
    if (!("IntersectionObserver" in window)) { setOn(true); return; }
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} {...rest} className={`reveal ${on ? "in" : ""} ${className}`} style={{ ...style, transitionDelay: `${delay}ms` }}>{children}</Tag>;
}

/** Counts from 0 to `value` over `ms` with ease-out. Formats with `format`. */
export function CountUp({ value, ms = 1200, format = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 }), className }: { value: number | null | undefined; ms?: number; format?: (n: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    if (reduced) { setN(value); return; }
    const start = performance.now();
    const a = from.current;
    const b = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setN(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={className}>—</span>;
  return <span className={className}>{format(n)}</span>;
}

/** Splits a headline into words that rise in one after another. */
export function Words({ text, base = 0, step = 60, className }: { text: string; base?: number; step?: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="word" style={{ animationDelay: `${base + i * step}ms` }}>{w}&nbsp;</span>
      ))}
    </span>
  );
}
