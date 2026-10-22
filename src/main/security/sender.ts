/**
 * IPC 发送方校验（docs/ARCHITECTURE.md §1、CONTRACTS §1 R 权限）。
 * 只接受受信本地顶层窗口的主 frame；iframe、子 frame、其他窗口与陌生来源一律拒绝。
 */

import { frameOrigin, isAllowedNavigation } from './window-options';

export interface SenderFacts {
  /** 触发事件的主 frame URL。 */
  readonly frameUrl: string;
  readonly isMainFrame?: boolean;
  /** 父 frame URL；主 frame 为 null。 */
  readonly parentFrameUrl: string | null;
  /** 事件来自的 webContents.id。 */
  readonly senderId: number;
  /** 应用主窗口的 webContents.id。 */
  readonly expectedSenderId: number;
  /** 允许的来源（开发服务器或 bookkeep://app）。 */
  readonly allowedOrigins: readonly string[];
}

export type SenderDecision =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

export function evaluateSender(facts: SenderFacts): SenderDecision {
  if (!Number.isInteger(facts.senderId) || facts.senderId !== facts.expectedSenderId) {
    return { ok: false, reason: 'SENDER_NOT_MAIN_WINDOW' };
  }
  if (facts.isMainFrame===false || facts.parentFrameUrl !== null) {
    return { ok: false, reason: 'SENDER_IS_CHILD_FRAME' };
  }
  if (!isAllowedNavigation(facts.frameUrl, facts.allowedOrigins)) {
    return { ok: false, reason: 'SENDER_ORIGIN_NOT_ALLOWED' };
  }
  const origin = frameOrigin(facts.frameUrl);
  if (origin === null) {
    return { ok: false, reason: 'SENDER_ORIGIN_UNRESOLVED' };
  }
  return { ok: true, origin };
}
