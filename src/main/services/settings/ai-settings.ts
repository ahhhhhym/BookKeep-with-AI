/**
 * AI 设置与密钥状态（S04 骨架）。
 * 只读状态是真实的：不伪造 configured。写入在 S04 明确 NOT_IMPLEMENTED，
 * 真实加密存取由 S09 通过同一受限接口实现，S15 加固。
 */

import { CANDIDATE_SCHEMA_VERSION, DEEPSEEK_MODEL, PROMPT_VERSION } from '../../../shared/constants';
import { notImplemented } from '../../../shared/errors';
import type { AiSettingsView, SecretStatusView } from '../../../shared/dto';
import type { SaveSecretInput } from '../../../shared/ipc';

export interface SettingsEnvironment {
  /** 由主进程调用 safeStorage.isEncryptionAvailable() 得到，不接受渲染层传入。 */
  readonly encryptionAvailable: boolean;
}

export function readAiSettings(_env: SettingsEnvironment): AiSettingsView {
  return {
    provider: 'deepseek',
    model: DEEPSEEK_MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    // 真实识图/JSON 组合尚未验证，S04 一律 stub；不得展示为 ready。
    readiness: 'stub',
    secretMode: 'absent',
    configured: false,
    settingsVersion: 0,
    ledgerId: null,
  };
}

export function readSecretStatus(env: SettingsEnvironment): SecretStatusView {
  return {
    configured: false,
    mode: 'absent',
    encryptionAvailable: env.encryptionAvailable,
    version: 0,
    lastErrorCode: null,
  };
}

/** S04 只允许校验后拒绝：不接收、不保存、不回显任何密钥。 */
export function saveSecretStub(input: SaveSecretInput): never {
  throw notImplemented(
    input.action === 'save' ? 'settings.saveSecret.save' : 'settings.saveSecret.remove',
    'S09',
  );
}
