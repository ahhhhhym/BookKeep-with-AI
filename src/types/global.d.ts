import type { BookKeepApi } from '../shared/api';

declare global {
  interface Window {
    /** 由受限 preload 注入；未注入时页面必须显示边界错误而不是崩溃。 */
    readonly bookkeep: BookKeepApi;
  }
}

export {};
