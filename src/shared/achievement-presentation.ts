export interface AchievementPreferences { readonly enabled: boolean; readonly position: 'center' | 'bottom-right' }
export const DEFAULT_ACHIEVEMENT_PREFERENCES: AchievementPreferences = { enabled: true, position: 'center' };
export function isAchievementPreferences(value: unknown): value is AchievementPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && typeof v.enabled === 'boolean' && (v.position === 'center' || v.position === 'bottom-right');
}
export interface AchievementPresentation {
  readonly ledgerId: string; readonly dataEpoch: string; readonly revision: number;
  readonly foreground: boolean; readonly preferences: AchievementPreferences;
  readonly foregroundMs: number;
}
