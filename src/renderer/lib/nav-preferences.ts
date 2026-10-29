/** Local shell preference; never part of ledger data or backups. */
export type NavMode = 'detailed' | 'compact';
const KEY = 'bookkeep.navMode';
export function readNavMode(storage: Pick<Storage, 'getItem'> | null): NavMode {
  try { return storage?.getItem(KEY) === 'compact' ? 'compact' : 'detailed'; }
  catch { return 'detailed'; }
}
export function writeNavMode(storage: Pick<Storage, 'setItem'> | null, mode: NavMode): void {
  try { storage?.setItem(KEY, mode); } catch { /* Session state remains usable. */ }
}
