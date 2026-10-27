import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { primaryNavId, type NavId } from '../../shared/nav';

/** One mounted foreground page. New requests retarget the exit, never queue pages. */
export function useMainTransition(target: NavId) {
  const [shown, setShown] = useState(target);
  const [phase, setPhase] = useState<'stable' | 'leaving' | 'entering'>('stable');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ref = useRef<HTMLDivElement>(null);
  const shownRef = useRef(target), latest = useRef(target), phaseRef = useRef(phase);
  const animation = useRef<Animation | null>(null);
  const resetScroll = useRef(false);
  latest.current = target;
  const changePhase = (value: typeof phase): void => { phaseRef.current = value; setPhase(value); };
  const enterFrom = (from: { opacity: string | number; transform: string }): void => {
    const el = ref.current;
    if (!el) return;
    const enter = el.animate([from, { opacity: 1, transform: 'translateY(0px)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    animation.current = enter;
    enter.onfinish = () => {
      if (animation.current !== enter) return;
      enter.cancel(); animation.current = null; changePhase('stable');
    };
  };
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (): void => { animation.current?.cancel(); animation.current = null; };
    if (reduced) { resetScroll.current = primaryNavId(shownRef.current) !== primaryNavId(target); cancel(); shownRef.current = target; setShown(target); changePhase('stable'); return; }
    if (target === shownRef.current) {
      if (phaseRef.current === 'leaving') {
        const style = getComputedStyle(el), from = { opacity: style.opacity, transform: style.transform };
        cancel(); enterFrom(from); changePhase('entering');
      }
      return;
    }
    if (phaseRef.current === 'leaving') return;
    if (primaryNavId(target) === primaryNavId(shownRef.current)) {
      shownRef.current = target; setShown(target); return;
    }
    const style = getComputedStyle(el), opacity = style.opacity, transform = style.transform;
    cancel();
    if (el.contains(document.activeElement)) el.parentElement?.focus({ preventScroll: true });
    changePhase('leaving');
    const exit = el.animate([{ opacity, transform }, { opacity: 0, transform }], { duration: 60, easing: 'ease-out', fill: 'forwards' });
    animation.current = exit;
    exit.onfinish = () => {
      if (animation.current !== exit) return;
      // Keep the completed exit's zero opacity until React has committed the new
      // page and its entry animation. Cancelling it first can expose the old page.
      animation.current = null;
      resetScroll.current = primaryNavId(shownRef.current) !== primaryNavId(latest.current);
      flushSync(() => { shownRef.current = latest.current; setShown(latest.current); changePhase('entering'); });
      exit.cancel();
    };
  }, [target, reduced]);
  useLayoutEffect(() => {
    if (resetScroll.current && ref.current) {
      ref.current.parentElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      resetScroll.current = false;
    }
    if (phase !== 'entering' || animation.current || !ref.current) return;
    enterFrom({ opacity: 0, transform: 'translateY(10px)' });
  }, [shown, phase]);
  useEffect(() => () => animation.current?.cancel(), []);
  return { shown, phase, ref };
}
