export type ThemeSource = 'system' | 'light' | 'dark';
export function isThemeSource(value: unknown): value is ThemeSource {
  return value === 'system' || value === 'light' || value === 'dark';
}
