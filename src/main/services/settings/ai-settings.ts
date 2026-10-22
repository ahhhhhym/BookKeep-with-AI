/** S09: main-process-only secret store; Windows safeStorage user-bound encryption. */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedFile, regularPath } from '../../storage/safe-file';
import { randomUUID } from 'node:crypto';
import { CANDIDATE_SCHEMA_VERSION, DEEPSEEK_MODEL, PROMPT_VERSION } from '../../../shared/constants';
import { AppError } from '../../../shared/errors';
import type { AiSettingsView, SecretSaveResult, SecretStatusView } from '../../../shared/dto';
import type { SaveSecretInput } from '../../../shared/ipc';

export interface SecretEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export class SecretStore {
  private session: string | null = null;
  private mode: 'absent' | 'encrypted' | 'session' = 'absent';
  private version = 0;
  private unreadable = false;
  private readonly receipts = new Map<string, SecretSaveResult>();
  private readonly file: string;
  constructor(directory: string, private readonly encryption: SecretEncryption) {
    this.file = path.join(directory, 'deepseek.secret.json');
    try {
      if (!existsSync(this.file)) return;
      regularPath(this.file,path.dirname(this.file));
      const raw = readBoundedFile(this.file,16384);
      if (raw.length > 16384) throw new Error();
      const value = JSON.parse(raw.toString('utf8'));
      if (!Number.isSafeInteger(value.version) || value.version < 0 || !['absent', 'encrypted'].includes(value.mode)) throw new Error();
      this.version = value.version; this.mode = value.mode;
      if (value.mode === 'encrypted') this.readForProvider();
    } catch { this.unreadable = true; }
  }
  private encryptionAvailable():boolean {try{return this.encryption.isEncryptionAvailable();}catch{return false;}}
  status(): SecretStatusView {
    return { configured: !this.unreadable && this.mode !== 'absent', mode: this.mode,
      encryptionAvailable: this.encryptionAvailable(), version: this.version,
      lastErrorCode: this.unreadable ? 'SECRET_UNREADABLE' : null };
  }
  /** Never exposed over IPC. No env/config/tool credential fallback. */
  readForProvider(): string {
    if (this.unreadable) throw new AppError('SECRET_UNREADABLE');
    if (this.mode === 'session' && this.session !== null) return this.session;
    if (this.mode === 'absent') throw new AppError('SECRET_REQUIRED');
    try {
      if (!this.encryptionAvailable()) throw new Error();
      regularPath(this.file,path.dirname(this.file));
      const value = JSON.parse(readBoundedFile(this.file,16384).toString('utf8'));
      const key = this.encryption.decryptString(Buffer.from(value.blob, 'base64'));
      validateSecret(key); return key;
    } catch { this.unreadable = true; throw new AppError('SECRET_UNREADABLE'); }
  }
  save(input: SaveSecretInput, mutationId: string): SecretSaveResult {
    const previous = this.receipts.get(mutationId);
    if (previous) return { ...previous };
    if (this.receipts.size >= 1000) throw new AppError('SECRET_RATE_LIMIT');
    if (input.expectedVersion !== this.version) throw new AppError('VERSION_CONFLICT', { details: { currentVersion: this.version } });
    if (this.version >= Number.MAX_SAFE_INTEGER) throw new AppError('VERSION_EXHAUSTED');
    if (this.unreadable && input.action !== 'remove') throw new AppError('SECRET_UNREADABLE');
    if (input.action === 'save') validateSecret(input.secret);
    const nextMode = input.action === 'remove' ? 'absent' : input.persistence === 'encrypted' && this.encryptionAvailable() ? 'encrypted' : 'session';
    const version = this.version + 1;
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      regularPath(this.file,path.dirname(this.file),false);
      mkdirSync(path.dirname(this.file), { recursive: true });
      const blob = nextMode === 'encrypted' ? this.encryption.encryptString(input.secret!).toString('base64') : null;
      const bytes = JSON.stringify({ version, mode: nextMode === 'encrypted' ? 'encrypted' : 'absent', blob });
      const fd = openSync(temp, 'wx');
      try { writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
      const check = JSON.parse(readFileSync(temp, 'utf8'));
      if (check.version !== version || (blob !== null && this.encryption.decryptString(Buffer.from(check.blob, 'base64')) !== input.secret)) throw new Error();
      renameSync(temp, this.file);
    } catch {
      try { if (existsSync(temp)) unlinkSync(temp); } catch { /* encrypted temporary blob only */ }
      throw new AppError('STORAGE_UNAVAILABLE');
    }
    this.mode = nextMode; this.version = version; this.unreadable = false;
    this.session = nextMode === 'session' ? input.secret! : null;
    const result: SecretSaveResult = { configured: nextMode !== 'absent', mode: nextMode, version };
    this.receipts.set(mutationId, result); return { ...result };
  }
  clearSession(): void { this.session = null; if(this.mode==='session')this.mode='absent'; }
}
export function validateSecret(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) throw new AppError('SECRET_INVALID');
}
export function readAiSettings(secret: SecretStore, ledgerId: string | null, verified = false): AiSettingsView {
  const status = secret.status();
  return { provider: 'deepseek', model: DEEPSEEK_MODEL, promptVersion: PROMPT_VERSION,
    schemaVersion: CANDIDATE_SCHEMA_VERSION, readiness: verified ? 'ready' : 'needs_probe',
    secretMode: status.mode, configured: status.configured, settingsVersion: status.version, ledgerId };
}
