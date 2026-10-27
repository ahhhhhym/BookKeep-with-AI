import { useEffect, type JSX } from 'react';
import { achievementController, useAchievements } from '../lib/achievement-controller';
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
    };
  },[]);
  useEffect(() => {
    if (!card || !state.visible) return;
    let cancelled = false, second = 0;
    const element = document.querySelector<HTMLElement>('.achievement-notice');
    const confirm = (): void => {
      if (cancelled || !unobstructed() || !element?.isConnected || element.dataset.noticeKey !== card.key) return;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      // Two animation frames alone do not prove nonzero opacity after a hidden window resumes.
      if (Number(style.opacity) >= .99 && style.visibility === 'visible' && rect.width > 0 && rect.height > 0
        && rect.top >= 44 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1) void achievementController.visible(card.key);
    };
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(confirm); });
    const retry = setInterval(confirm,500);
    element?.addEventListener('animationend',confirm);
    return () => { cancelled = true; element?.removeEventListener('animationend',confirm); cancelAnimationFrame(first); cancelAnimationFrame(second); clearInterval(retry); };
  },[card?.key,state.visible]);
  if (!card || !state.visible) return null;
  return <aside className="achievement-notice-layer" data-position={state.preferences?.position ?? 'center'} aria-label={card.demo ? '成就提示预览' : '成就提示'}>
    <div className="achievement-notice" data-notice-key={card.key} data-demo={card.demo} data-remaining={Math.ceil(state.remaining)}
      onClick={() => { achievementController.dismiss(); onOpen(); }}
      onMouseEnter={() => achievementController.pause('hover',true)} onMouseLeave={() => achievementController.pause('hover',false)}
      onFocusCapture={() => achievementController.pause('focus',true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) achievementController.pause('focus',false); }}>
      <div className="achievement-notice-symbol"><AppIcon iconKey="lucide:party-popper" size={26} /></div>
      <button type="button" className="achievement-notice-link">
        <strong>{card.title}</strong><span>{card.detail}</span>
      </button>
      <button type="button" className="achievement-notice-close" aria-label="关闭成就提示" onClick={event => { event.stopPropagation(); achievementController.dismiss(); }}>×</button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{card.title}。{card.detail}</span>
      {state.noticeError ? <span className="achievement-notice-error" role="status">{state.noticeError}</span> : null}
    </div>
  </aside>;
}
