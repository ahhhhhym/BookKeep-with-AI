import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, MAX_IPC_PAYLOAD_BYTES } from '../../src/shared/constants';
import { AppError } from '../../src/shared/errors';
import {
  ALL_CHANNELS,
  BUSINESS_CHANNELS,
  CHANNEL_SPECS,
  IPC,
  SKELETON_CHANNELS,
  isKnownChannel,
} from '../../src/shared/ipc';
import { validateIpcRequest } from '../../src/main/ipc/validate-request';

const REQUEST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const EPOCH = '9b2f8f6a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const MUTATION_ID = '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f';

function buildRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: REQUEST_ID,
    dataEpoch: null,
    payload: {},
    ...overrides,
  };
}

function expectAppError(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`expected AppError ${code}`);
}

describe('IPC 通道白名单', () => {
  it('S04 只开放 5 个通道，skeleton 通道不进入业务契约', () => {
    expect(ALL_CHANNELS).toHaveLength(5);
    expect(BUSINESS_CHANNELS).toHaveLength(4);
    expect(SKELETON_CHANNELS).toEqual([IPC.skeletonMockRecognition]);
    expect(BUSINESS_CHANNELS).not.toContain(IPC.skeletonMockRecognition);
    for (const channel of ALL_CHANNELS) {
      expect(isKnownChannel(channel)).toBe(true);
    }
    expect(isKnownChannel('ipcRenderer.invoke')).toBe(false);
    expect(isKnownChannel('shell.openExternal')).toBe(false);
  });

  it('权限标签符合契约（saveSecret 为 S，其余为 R）', () => {
    expect(CHANNEL_SPECS.settingsSaveSecret.permission).toBe('S');
    expect(CHANNEL_SPECS.settingsReadAi.permission).toBe('R');
    expect(CHANNEL_SPECS.providerCapabilities.permission).toBe('R');
  });
});

describe('请求信封校验', () => {
  it('接受启动期 dataEpoch=null 的只读请求', () => {
    const request = validateIpcRequest(CHANNEL_SPECS.settingsReadAi, buildRequest());
    expect(request.requestId).toBe(REQUEST_ID);
    expect(request.dataEpoch).toBeNull();
    expect(request.payload).toEqual({});
  });

  it('拒绝未知信封键（防越权字段注入）', () => {
    const error = expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.settingsReadAi, buildRequest({ permission: 'W' })),
      'PAYLOAD_INVALID',
    );
    expect(error.fieldErrors).toEqual([{ path: 'request.permission', code: 'UNKNOWN_KEY' }]);
  });

  it('拒绝契约版本不匹配', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.settingsReadAi, buildRequest({ contractVersion: 'bookkeep.v2' })),
      'CONTRACT_VERSION_UNSUPPORTED',
    );
  });

  it('拒绝非 UUIDv4 的 requestId', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.settingsReadAi, buildRequest({ requestId: 'abc' })),
      'PAYLOAD_INVALID',
    );
  });

  it('拒绝超过 256KiB 的载荷', () => {
    const error = expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.settingsReadAi,
          buildRequest({ payload: { blob: 'x'.repeat(MAX_IPC_PAYLOAD_BYTES) } }),
        ),
      'PAYLOAD_INVALID',
    );
    expect(error.details).toEqual({ maxBytes: MAX_IPC_PAYLOAD_BYTES });
  });

  it('世代不匹配返回 STALE_EPOCH', () => {
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.settingsSaveSecret,
          buildRequest({ dataEpoch: EPOCH, mutationId: MUTATION_ID, payload: { action: 'remove' } }),
          { expectedEpoch: '11111111-2222-4333-8444-555555555555' },
        ),
      'STALE_EPOCH',
    );
  });
});

describe('settings.saveSecret 载荷', () => {
  it('变更操作必须带 dataEpoch 与 mutationId', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.settingsSaveSecret, buildRequest({ payload: { action: 'remove' } })),
      'PAYLOAD_INVALID',
    );
    const error = expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.settingsSaveSecret,
          buildRequest({ dataEpoch: EPOCH, payload: { action: 'remove' } }),
        ),
      'PAYLOAD_INVALID',
    );
    expect(error.fieldErrors).toEqual([{ path: 'request.mutationId', code: 'MUTATION_ID_REQUIRED' }]);
  });

  it('接受合法的移除请求', () => {
    const request = validateIpcRequest(
      CHANNEL_SPECS.settingsSaveSecret,
      buildRequest({ dataEpoch: EPOCH, mutationId: MUTATION_ID, payload: { action: 'remove' } }),
    );
    expect(request.payload).toEqual({ action: 'remove' });
    expect(request.mutationId).toBe(MUTATION_ID);
  });

  it('保存时必须有 1～512 字符且无控制字符的密钥与持久化方式', () => {
    const base = { dataEpoch: EPOCH, mutationId: MUTATION_ID };
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.settingsSaveSecret,
      buildRequest({ ...base, payload: { action: 'save', secret: 'sk-test', persistence: 'encrypted' } }),
    );
    expect(accepted.payload).toEqual({ action: 'save', secret: 'sk-test', persistence: 'encrypted' });

    for (const payload of [
      { action: 'save', secret: '', persistence: 'encrypted' },
      { action: 'save', secret: 'x'.repeat(513), persistence: 'encrypted' },
      { action: 'save', secret: 'sk-\nkey', persistence: 'session' },
      { action: 'save', secret: 'sk-\tkey', persistence: 'session' },
      { action: 'save', secret: 'sk-key' },
      { action: 'save', secret: 'sk-key', persistence: 'disk' },
    ]) {
      expectAppError(
        () => validateIpcRequest(CHANNEL_SPECS.settingsSaveSecret, buildRequest({ ...base, payload })),
        'FIELD_INVALID',
      );
    }
  });

  it('移除请求不得夹带 secret 或 persistence', () => {
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.settingsSaveSecret,
          buildRequest({
            dataEpoch: EPOCH,
            mutationId: MUTATION_ID,
            payload: { action: 'remove', secret: 'sk-key' },
          }),
        ),
      'FIELD_INVALID',
    );
  });
});

describe('只读载荷校验', () => {
  it('provider.capabilities 拒绝未知 provider', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.providerCapabilities, buildRequest({ payload: { providerId: 'openai' } })),
      'FIELD_INVALID',
    );
  });

  it('skeleton.mockRecognition 拒绝未声明字段与未知场景', () => {
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.skeletonMockRecognition,
          buildRequest({ payload: { scenario: 'two-expenses', extra: 1 } }),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.skeletonMockRecognition,
          buildRequest({ payload: { scenario: 'unknown' } }),
        ),
      'FIELD_INVALID',
    );
  });

  it('接受合法 mock 场景', () => {
    const request = validateIpcRequest(
      CHANNEL_SPECS.skeletonMockRecognition,
      buildRequest({ payload: { scenario: 'paid-order' } }),
    );
    expect(request.payload).toEqual({ scenario: 'paid-order' });
  });
});
