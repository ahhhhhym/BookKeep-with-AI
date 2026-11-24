import { useEffect, useRef, useState } from 'react';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_QUERY).matches
    : false;
}

/**
 * Subscribe to the system's prefers-reduced-motion media query.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(REDUCED_QUERY);
    const update = (): void => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Interruptible Apple-style cubic ease-out number interpolation.
 * First render displays the exact target immediately; subsequent changes smoothly
 * glide from the current interpolated value to the new target over `durationMs`.
 */
export function useAnimatedNumber(target: number, durationMs = 260): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    if (reduced || !Number.isFinite(target) || !Number.isFinite(currentRef.current) || target === currentRef.current) {
      currentRef.current = target;
      setDisplay(target);
      return undefined;
    }
    const from = currentRef.current;
    const delta = target - from;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number): void => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out: fast start, silky zero-overshoot settle.
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = progress >= 1 ? target : from + delta * eased;
      currentRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return reduced ? target : display;
}
