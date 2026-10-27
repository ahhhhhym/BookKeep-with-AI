import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_ACHIEVEMENT_PREFERENCES, isAchievementPreferences, type AchievementPreferences } from '../../shared/achievement-presentation';
import { AppError } from '../../shared/errors';

/** Shell-only, outside generations and archives. A damaged/missing preference never blocks a ledger. */
export function readAchievementPreferences(root: string): AchievementPreferences {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(root, 'shell', 'achievement-notices.json'), 'utf8'));
    if (isAchievementPreferences(value)) return value;
  } catch { /* Defaults also allow a subsequent explicit save to repair this file. */ }
  return { ...DEFAULT_ACHIEVEMENT_PREFERENCES };
}
export function saveAchievementPreferences(root: string, value: AchievementPreferences): AchievementPreferences {
  if (!isAchievementPreferences(value)) throw new AppError('PAYLOAD_INVALID');
  try {
    const target = path.join(root, 'shell', 'achievement-notices.json');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target + '.tmp', JSON.stringify(value), 'utf8');
    renameSync(target + '.tmp', target);
    return { ...value };
  } catch { throw new AppError('STORAGE_UNAVAILABLE'); }
}
