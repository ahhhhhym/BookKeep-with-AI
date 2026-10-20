/**
 * IPC 通道白名单与请求规格（docs/CONTRACTS.md §1/§3/§6/§7）。
 *
 * S04 只开放最小集合：
 *  - settings.ai / settings.readStatus / provider.capabilities：只读，真实返回；
 *  - settings.saveSecret：受限密钥入口，S04 校验后返回 NOT_IMPLEMENTED（S09 实现存储）；
 *  - skeleton.mockRecognition：骨架诊断，强制 provider=mock，不出网、不写库，S10 起被
 *    recognition.start 取代后移除（命名带 skeleton 前缀，禁止被业务页面当作契约能力）。
 */

import type { RequestSpec } from './envelope.js';
import type { MockRecognitionInput, ProviderId } from './dto.js';
import { SECRET_MAX_LENGTH, SECRET_MIN_LENGTH } from './constants.js';
import { hasControlCharacters, isBoundedString, isPlainRecord } from './validation.js';

export const IPC = {
  settingsReadAi: 'settings.ai',
  settingsReadStatus: 'settings.readStatus',
  settingsSaveSecret: 'settings.saveSecret',
  providerCapabilities: 'provider.capabilities',
  skeletonMockRecognition: 'skeleton.mockRecognition',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** 权限标签沿用 CONTRACTS §1。 */
export type PermissionTag = 'R' | 'W' | 'F' | 'U' | 'S' | 'D';

export interface ChannelSpec<TPayload = unknown> {
  readonly channel: IpcChannel;
  readonly permission: PermissionTag;
  /** true 表示 S04 专有诊断通道，不属于业务契约。 */
  readonly skeletonOnly: boolean;
  readonly request: RequestSpec<TPayload>;
}

export interface SaveSecretInput {
  action: 'save' | 'remove';
  secret?: string;
  persistence?: 'encrypted' | 'session';
}

export interface ProviderCapabilitiesInput {
  providerId: ProviderId;
}

const PROVIDER_IDS: readonly string[] = ['deepseek', 'mock'];

function validateSecretPayload(payload: Record<string, unknown>): { path: string; code: string }[] {
  const issues: { path: string; code: string }[] = [];
  const action = payload.action;
  if (action !== 'save' && action !== 'remove') {
    issues.push({ path: 'payload.action', code: 'EXPECTED_SAVE_OR_REMOVE' });
    return issues;
  }
  if (action === 'remove') {
    if ('secret' in payload) issues.push({ path: 'payload.secret', code: 'NOT_ALLOWED_ON_REMOVE' });
    if ('persistence' in payload) issues.push({ path: 'payload.persistence', code: 'NOT_ALLOWED_ON_REMOVE' });
    return issues;
  }
  const secret = payload.secret;
  if (typeof secret !== 'string') {
    issues.push({ path: 'payload.secret', code: 'EXPECTED_STRING' });
  } else {
    if (!isBoundedString(secret, SECRET_MIN_LENGTH, SECRET_MAX_LENGTH)) {
      issues.push({ path: 'payload.secret', code: 'SECRET_LENGTH' });
    }
    // 密钥为不透明输入：不做 trim/NFC 改写，含控制字符直接拒绝。
    if (hasControlCharacters(secret)) {
      issues.push({ path: 'payload.secret', code: 'CONTROL_CHARACTER' });
    }
  }
  if (payload.persistence !== 'encrypted' && payload.persistence !== 'session') {
    issues.push({ path: 'payload.persistence', code: 'EXPECTED_ENCRYPTED_OR_SESSION' });
  }
  return issues;
}

function validateCapabilitiesPayload(payload: Record<string, unknown>): { path: string; code: string }[] {
  if (typeof payload.providerId !== 'string' || !PROVIDER_IDS.includes(payload.providerId)) {
    return [{ path: 'payload.providerId', code: 'UNKNOWN_PROVIDER' }];
  }
  return [];
}

function validateMockPayload(payload: Record<string, unknown>): { path: string; code: string }[] {
  const scenario = payload.scenario;
  if (scenario !== 'paid-order' && scenario !== 'two-expenses' && scenario !== 'product-photo') {
    return [{ path: 'payload.scenario', code: 'UNKNOWN_SCENARIO' }];
  }
  return [];
}

const EMPTY_SPEC: RequestSpec<Record<string, never>> = {
  required: [],
  optional: [],
  allowNullEpoch: true,
  requireMutationId: false,
  validatePayload: () => [],
  cast: () => ({}),
};

export const CHANNEL_SPECS: {
  readonly settingsReadAi: ChannelSpec<Record<string, never>>;
  readonly settingsReadStatus: ChannelSpec<Record<string, never>>;
  readonly settingsSaveSecret: ChannelSpec<SaveSecretInput>;
  readonly providerCapabilities: ChannelSpec<ProviderCapabilitiesInput>;
  readonly skeletonMockRecognition: ChannelSpec<MockRecognitionInput>;
} = {
  settingsReadAi: {
    channel: IPC.settingsReadAi,
    permission: 'R',
    skeletonOnly: false,
    request: EMPTY_SPEC,
  },
  settingsReadStatus: {
    channel: IPC.settingsReadStatus,
    permission: 'R',
    skeletonOnly: false,
    request: EMPTY_SPEC,
  },
  settingsSaveSecret: {
    channel: IPC.settingsSaveSecret,
    permission: 'S',
    skeletonOnly: false,
    request: {
      required: ['action'],
      optional: ['secret', 'persistence'],
      allowNullEpoch: false,
      requireMutationId: true,
      validatePayload: validateSecretPayload,
      cast: (payload) => payload as unknown as SaveSecretInput,
    },
  },
  providerCapabilities: {
    channel: IPC.providerCapabilities,
    permission: 'R',
    skeletonOnly: false,
    request: {
      required: ['providerId'],
      optional: [],
      allowNullEpoch: true,
      requireMutationId: false,
      validatePayload: validateCapabilitiesPayload,
      cast: (payload) => payload as unknown as ProviderCapabilitiesInput,
    },
  },
  skeletonMockRecognition: {
    channel: IPC.skeletonMockRecognition,
    permission: 'R',
    skeletonOnly: true,
    request: {
      required: ['scenario'],
      optional: [],
      allowNullEpoch: true,
      requireMutationId: false,
      validatePayload: validateMockPayload,
      cast: (payload) => payload as unknown as MockRecognitionInput,
    },
  },
};

/** 业务契约通道（可出现在 CONTRACTS 中）；skeleton.* 不计入。 */
export const BUSINESS_CHANNELS: readonly IpcChannel[] = [
  IPC.settingsReadAi,
  IPC.settingsReadStatus,
  IPC.settingsSaveSecret,
  IPC.providerCapabilities,
];

export const SKELETON_CHANNELS: readonly IpcChannel[] = [IPC.skeletonMockRecognition];

export const ALL_CHANNELS: readonly IpcChannel[] = [...BUSINESS_CHANNELS, ...SKELETON_CHANNELS];

export function isKnownChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (ALL_CHANNELS as readonly string[]).includes(value);
}

/** settings.saveSecret 专用限流：每窗口每分钟 ≤5 次提交（CONTRACTS §1 S 权限）。 */
export const SECRET_SUBMIT_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;

export function isSaveSecretPayload(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value);
}
