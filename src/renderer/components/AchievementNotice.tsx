import { useEffect, type JSX, type CSSProperties } from 'react';
import { achievementController, useAchievements } from '../lib/achievement-controller';
import { NOTICE_MOTION } from '../lib/achievement-notices';
import { AppIcon } from '../lib/icon-registry';

function unobstructed(): boolean {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  return !Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"], .backdrop[data-open="true"]'))
    .some(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
}
export function AchievementNotice({onOpen}: {onOpen: () => void}): JSX.Element | null {
  const state = useAchievements();
  const card = state.active;
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = (): void => achievementController.setReducedMotion(motion.matches);
    updateMotion();motion.addEventListener('change',updateMotion);
    const originalConfirm = window.confirm;
    const guardedConfirm: typeof window.confirm = message => {
      achievementController.nativeDialog(true);
      try { return originalConfirm.call(window,message); }
      finally { achievementController.nativeDialog(false); }
    };
    window.confirm = guardedConfirm;
    const update = (): void => achievementController.setEligible(unobstructed());
    const blur = (): void => achievementController.setEligible(false);
    const observer = new MutationObserver(update);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','aria-modal','data-open','hidden','style']});
    window.addEventListener('blur',blur); window.addEventListener('focus',update);
    document.addEventListener('visibilitychange',update); window.addEventListener('resize',update);
    update();
    return () => {
      if (window.confirm === guardedConfirm) window.confirm = originalConfirm;
      observer.disconnect(); window.removeEventListener('blur',blur); window.removeEventListener('focus',update);
      document.removeEventListener('visibilitychange',update); window.removeEventListener('resize',update);
      achievementController.setEligible(false);
      motion.removeEventListener('change',updateMotion);
    };
  },[]);
  useEffect(() => {
    if (!card || !state.visible) return;
    let cancelled = false;
    const element = document.querySelector<HTMLElement>('.achievement-notice');
    const confirm = (): void => {
      if (cancelled || state.phase === 'exiting' || !unobstructed() || !element?.isConnected || element.dataset.noticeKey !== card.key) return;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      // Inspect actual presentation, including finished entry; mount/two frames are not visibility proof.
      if (!element.getAnimations().some(a => a.playState === 'running' || a.pending)
        && Number(style.opacity) >= .999 && style.visibility === 'visible' && rect.width > 0 && rect.height > 0
        && rect.top >= 56 - 1 && rect.left >= 12 - 1 && rect.right <= innerWidth - 12 + 1 && rect.bottom <= innerHeight - 12 + 1) void achievementController.visible(card.key);
    };
    const first = requestAnimationFrame(confirm);
    const retry = setInterval(confirm,50);
    element?.addEventListener('animationend',confirm);
    return () => { cancelled = true; element?.removeEventListener('animationend',confirm); cancelAnimationFrame(first); clearInterval(retry); };
  },[card?.key,state.visible,state.phase]);
  useEffect(() => {
    if (!state.visible || !state.interactive) return;
    const element = document.querySelector<HTMLElement>('.achievement-notice');
    achievementController.pause('hover',!!element?.matches(':hover'));
    achievementController.pause('focus',!!element?.contains(document.activeElement));
  },[card?.key,state.visible,state.interactive]);
  if (!card) return null;
  return <aside className="achievement-notice-layer" data-visible={state.visible} data-position={state.preferences?.position ?? 'center'} aria-hidden={!state.visible} aria-label={card.demo ? '成就提示预览' : '成就提示'}
    style={{'--notice-enter':`${NOTICE_MOTION.enter}ms`,'--notice-exit':`${NOTICE_MOTION.exit}ms`,'--notice-reduced':`${NOTICE_MOTION.reduced}ms`} as CSSProperties}>
    <div key={card.key} className="achievement-notice" data-phase={state.phase} data-notice-key={card.key} data-demo={card.demo} data-remaining={Math.ceil(state.remaining)}
      onClick={() => { achievementController.dismiss(onOpen); }}
      onMouseEnter={() => achievementController.pause('hover',true)} onMouseLeave={() => achievementController.pause('hover',false)}
      onFocusCapture={() => achievementController.pause('focus',true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) achievementController.pause('focus',false); }}>
      <div className="achievement-notice-symbol"><AppIcon iconKey="lucide:party-popper" size={26} /></div>
      <button type="button" className="achievement-notice-link" disabled={!state.interactive}>
        <strong>{card.title}</strong><span>{card.detail}</span>
      </button>
      <button type="button" className="achievement-notice-close" disabled={!state.interactive} aria-label="关闭成就提示" onClick={event => { event.stopPropagation(); achievementController.dismiss(); }}>×</button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{card.title}。{card.detail}</span>
      {state.noticeError ? <span className="achievement-notice-error" role="status">{state.noticeError}</span> : null}
    </div>
  </aside>;
}
