/** 骨架界面截图：仅用于开发自检证据，不含任何用户数据。 */

import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PAGES = ['ledger', 'statistics', 'import', 'queue', 'review', 'categories', 'data', 'settings'] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function capturePages(window: BrowserWindow, targetDir: string): Promise<string[]> {
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];

  for (const page of PAGES) {
    await window.webContents.executeJavaScript(
      `(() => {
        const button = document.querySelector('[data-nav-item="${page}"]');
        if (button instanceof HTMLElement) button.click();
        return true;
      })()`,
      true,
    );
    await delay(150);
    if (page === 'import') {
      // 触发一次本地 mock 识别，让截图包含真实的候选表格（不出网）。
      await window.webContents.executeJavaScript(
        `(() => {
          const run = document.querySelector('[data-action="run-mock"]');
          if (run instanceof HTMLElement) run.click();
          return true;
        })()`,
        true,
      );
      await delay(400);
    }
    const image = await window.webContents.capturePage();
    const target = path.join(targetDir, `${page}.png`);
    writeFileSync(target, image.toPNG());
    written.push(target);
  }

  return written;
}
