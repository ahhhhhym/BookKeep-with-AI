/** 页面截图：仅用于开发自检证据，不含任何用户数据。 */

import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PAGES = ['ledger', 'statistics', 'import', 'queue', 'review', 'data', 'settings'] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function capturePages(window: BrowserWindow, targetDir: string): Promise<string[]> {
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];

  for (const page of PAGES) {
    await window.webContents.executeJavaScript(
      `(() => {
        const aiPage = ['import', 'queue', 'review'].includes('${page}');
        const button = document.querySelector('[data-nav-item="' + (aiPage ? 'ai' : '${page}') + '"]');
        if (button instanceof HTMLElement) button.click();
        return true;
      })()`,
      true,
    );
    await delay(150);
    if (page === 'import' || page === 'queue' || page === 'review') {
      await window.webContents.executeJavaScript(
        `(() => {
          const button = document.querySelector('.ai-switcher [aria-controls="ai-${page}"]');
          if (button instanceof HTMLElement) button.click();
          return true;
        })()`,
        true,
      );
      await delay(150);
    }
    const image = await window.webContents.capturePage();
    const target = path.join(targetDir, `${page}.png`);
    writeFileSync(target, image.toPNG());
    written.push(target);
  }

  return written;
}
