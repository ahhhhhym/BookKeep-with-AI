import { app, nativeTheme, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { isThemeSource, type ThemeSource } from '../shared/appearance';

const preferencePath = (): string => path.join(app.getPath('userData'), 'appearance.json');
export function initializeAppearance(): void {
  let source: ThemeSource = 'system';
  try {
    const value: unknown = JSON.parse(readFileSync(preferencePath(), 'utf8'));
    if (isThemeSource(value)) source = value;
  } catch { /* Missing or damaged UI preference falls back to the system. */ }
  nativeTheme.themeSource = source;
}
export function readAppearance(): ThemeSource { return nativeTheme.themeSource; }
export function applyAppearance(source: ThemeSource): ThemeSource {
  const target = preferencePath();
  writeFileSync(target + '.tmp', JSON.stringify(source), 'utf8');
  renameSync(target + '.tmp', target);
  nativeTheme.themeSource = source;
  for (const window of BrowserWindow.getAllWindows()) updateWindowAppearance(window);
  return source;
}
export function titlebarPalette(): { color: string; symbolColor: string; height: number } {
  return { color: nativeTheme.shouldUseDarkColors ? '#181818' : '#ffffff', symbolColor: nativeTheme.shouldUseDarkColors ? '#ededed' : '#1f2937', height: 44 };
}
export function followWindowAppearance(window: BrowserWindow): void {
  const update = (): void => updateWindowAppearance(window);
  nativeTheme.on('updated', update);
  window.once('closed', () => nativeTheme.removeListener('updated', update));
}
function updateWindowAppearance(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.setTitleBarOverlay(titlebarPalette());
  window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f5f7fb');
}
