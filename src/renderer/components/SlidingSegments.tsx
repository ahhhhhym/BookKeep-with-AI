import { useLayoutEffect, useRef, useState, type JSX } from 'react';

/** Presentation only: the owner approves navigation before changing value. CSS retargets
 * from the current interpolated position; no timers, duplicated pages or business effects. */
export function SlidingSegments<T extends string>({ value, items, onChange, label, className = '' }: {
  value: T; items: readonly { value: T; label: string; controls?: string }[];
  onChange: (value: T) => void; label: string; className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const update = (): void => {
      const selected = root.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected || !root.getClientRects().length) return;
      const box = root.getBoundingClientRect(), button = selected.getBoundingClientRect();
      setIndicator({ x: button.left - box.left - root.clientLeft, y: button.top - box.top - root.clientTop, width: button.width, height: button.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    root.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value, items]);
  return <div ref={ref} className={`segmented sliding-segments ${className}`} role="group" aria-label={label}>
    <span className="segment-indicator" aria-hidden="true" data-ready={!!indicator} style={indicator ? { transform: `translate(${indicator.x}px, ${indicator.y}px)`, width: indicator.width, height: indicator.height } : undefined} />
    {items.map(item => <button type="button" key={item.value} aria-pressed={value === item.value} aria-controls={item.controls} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}
