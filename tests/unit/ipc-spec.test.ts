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

function transactionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amountFen: 1800,
    occurredDate: '2026-09-08',
    occurredTime: null,
    timePrecision: 'date',
    name: '午餐',
    categoryId: 'cat_food',
    merchant: null,
    note: null,
    ...overrides,
  };
}

function mutation(payload: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return buildRequest({ dataEpoch: EPOCH, mutationId: MUTATION_ID, payload, ...extra });
}

describe('IPC 通道白名单', () => {
  it('S07 开放 22 个通道（21 个业务 + 1 个骨架诊断），无 ipcRenderer 直通', () => {
    expect(ALL_CHANNELS).toHaveLength(22);
    expect(BUSINESS_CHANNELS).toHaveLength(21);
    expect(SKELETON_CHANNELS).toEqual([IPC.skeletonMockRecognition]);
    expect(BUSINESS_CHANNELS).not.toContain(IPC.skeletonMockRecognition);
    for (const channel of ALL_CHANNELS) {
      expect(isKnownChannel(channel)).toBe(true);
    }
    expect(isKnownChannel('ipcRenderer.invoke')).toBe(false);
    expect(isKnownChannel('shell.openExternal')).toBe(false);
  });

  it('权限标签符合契约：账本/分类/交易/备份变更为 W，列表为 R，密钥为 S', () => {
    expect(CHANNEL_SPECS.settingsSaveSecret.permission).toBe('S');
    expect(CHANNEL_SPECS.settingsReadAi.permission).toBe('R');
    expect(CHANNEL_SPECS.ledgerEnsureDefault.permission).toBe('W');
    expect(CHANNEL_SPECS.categoryList.permission).toBe('R');
    expect(CHANNEL_SPECS.categoryCreate.permission).toBe('W');
    expect(CHANNEL_SPECS.transactionList.permission).toBe('R');
    expect(CHANNEL_SPECS.transactionSoftDelete.permission).toBe('W');
    expect(CHANNEL_SPECS.backupCreate.permission).toBe('W');
    expect(CHANNEL_SPECS.backupList.permission).toBe('R');
    expect(CHANNEL_SPECS.backupRestore.permission).toBe('W');
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

  it('业务读取必须携带 dataEpoch；ensureDefault 允许启动期 null', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.categoryList, buildRequest()),
      'PAYLOAD_INVALID',
    );
    const ensured = validateIpcRequest(
      CHANNEL_SPECS.ledgerEnsureDefault,
      buildRequest({ dataEpoch: null, mutationId: MUTATION_ID }),
    );
    expect(ensured.payload).toEqual({});
    expect(ensured.mutationId).toBe(MUTATION_ID);
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

describe('账本与分类载荷', () => {
  it('ensureDefault 必须带 mutationId，拒绝未知键', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.ledgerEnsureDefault, buildRequest()),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.ledgerEnsureDefault, mutation({ extra: true })),
      'PAYLOAD_INVALID',
    );
  });

  it('category.create 只接受 name/iconKey/sortOrder，名称长度与图标键由服务层判定', () => {
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.categoryCreate,
      mutation({ name: '早餐', iconKey: 'lucide:utensils' }),
    );
    expect(accepted.payload).toEqual({ name: '早餐', iconKey: 'lucide:utensils' });
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.categoryCreate,
          mutation({ name: '早餐', iconKey: 'lucide:utensils', systemKey: 'food' }),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.categoryCreate, mutation({ name: '早餐', iconKey: 'lucide:utensils', sortOrder: -1 })),
      'FIELD_INVALID',
    );
  });

  it('category.update 拒绝 enabled=false（必须走 disable）与空 patch', () => {
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.categoryUpdate,
          mutation({ id: 'cat_food', expectedVersion: 1, patch: { enabled: false } }),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.categoryUpdate,
          mutation({ id: 'cat_food', expectedVersion: 1, patch: {} }),
        ),
      'FIELD_INVALID',
    );
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.categoryUpdate,
      mutation({ id: 'cat_food', expectedVersion: 1, patch: { name: '用餐', enabled: true } }),
    );
    expect(accepted.payload).toEqual({
      id: 'cat_food',
      expectedVersion: 1,
      patch: { name: '用餐', enabled: true },
    });
  });

  it('category.disable 需要 id 与 expectedVersion', () => {
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.categoryDisable, mutation({ id: 'cat_food' })),
      'PAYLOAD_INVALID',
    );
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.categoryDisable,
      mutation({ id: 'cat_food', expectedVersion: 2 }),
    );
    expect(accepted.payload).toEqual({ id: 'cat_food', expectedVersion: 2 });
  });
});

describe('交易载荷', () => {
  it('transaction.create 要求 8 个完整字段且拒绝 source/sourceCandidateId 注入', () => {
    const accepted = validateIpcRequest(CHANNEL_SPECS.transactionCreate, mutation(transactionPayload()));
    expect(accepted.payload).toMatchObject({ amountFen: 1800, name: '午餐', categoryId: 'cat_food' });

    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionCreate,
          mutation(transactionPayload({ source: 'ai' })),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionCreate,
          mutation(transactionPayload({ sourceCandidateId: 'c-1' })),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.transactionCreate, mutation({ amountFen: 1 })),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionCreate,
          mutation(transactionPayload({ amountFen: '1800' })),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionCreate,
          mutation(transactionPayload({ timePrecision: 'unknown' })),
        ),
      'FIELD_INVALID',
    );
  });

  it('transaction.update 只允许白名单 patch 且不能为空', () => {
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.transactionUpdate,
      mutation({ id: 'trans-1', expectedVersion: 1, patch: { amountFen: 2000 } }),
    );
    expect(accepted.payload).toMatchObject({ id: 'trans-1', expectedVersion: 1 });
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionUpdate,
          mutation({ id: 'trans-1', expectedVersion: 1, patch: { source: 'ai' } }),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionUpdate,
          mutation({ id: 'trans-1', expectedVersion: 1, patch: {} }),
        ),
      'FIELD_INVALID',
    );
  });

  it('transaction.softDelete/restore 需要 id 与 expectedVersion', () => {
    for (const spec of [CHANNEL_SPECS.transactionSoftDelete, CHANNEL_SPECS.transactionRestore]) {
      expectAppError(() => validateIpcRequest(spec, mutation({ id: 'trans-1' })), 'PAYLOAD_INVALID');
      const accepted = validateIpcRequest(spec, mutation({ id: 'trans-1', expectedVersion: 1 }));
      expect(accepted.payload).toEqual({ id: 'trans-1', expectedVersion: 1 });
    }
  });

  it('transaction.list 允许省略 filter/page 使用契约默认值，并校验结构与上限', () => {
    const valid = {
      filter: {
        dateStart: null,
        dateEnd: null,
        categoryIds: ['cat_food'],
        nameQuery: null,
        deleted: 'active',
      },
      page: { limit: 50, cursor: null },
    };
    expect(
      validateIpcRequest(CHANNEL_SPECS.transactionList, buildRequest({ dataEpoch: EPOCH, payload: valid }))
        .payload,
    ).toEqual(valid);

    // 省略 filter/page：默认 active、limit=50、无游标。
    const defaults = validateIpcRequest(
      CHANNEL_SPECS.transactionList,
      buildRequest({ dataEpoch: EPOCH, payload: {} }),
    );
    expect(defaults.payload).toEqual({
      filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' },
      page: { limit: 50, cursor: null },
    });

    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionList,
          buildRequest({ dataEpoch: EPOCH, payload: { filter: { sortBy: 'amount' } } }),
        ),
      'PAYLOAD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionList,
          buildRequest({ dataEpoch: EPOCH, payload: { ...valid, page: { limit: 101, cursor: null } } }),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionList,
          buildRequest({
            dataEpoch: EPOCH,
            payload: {
              ...valid,
              filter: { ...valid.filter, categoryIds: Array.from({ length: 501 }, (_, index) => `cat_${index}`) },
            },
          }),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.transactionList,
          buildRequest({ dataEpoch: EPOCH, payload: { ...valid, filter: { ...valid.filter, deleted: 'everything' } } }),
        ),
      'FIELD_INVALID',
    );
  });
});

describe('备份载荷', () => {
  it('backup.create 只允许 manual 且必须确认敏感数据', () => {
    const accepted = validateIpcRequest(
      CHANNEL_SPECS.backupCreate,
      mutation({ kind: 'manual', containsPrivateDataAcknowledged: true }),
    );
    expect(accepted.payload).toEqual({ kind: 'manual', containsPrivateDataAcknowledged: true });
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.backupCreate,
          mutation({ kind: 'pre_migration', containsPrivateDataAcknowledged: true }),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () => validateIpcRequest(CHANNEL_SPECS.backupCreate, mutation({ kind: 'manual' })),
      'PAYLOAD_INVALID',
    );
  });

  it('backup.restore preview 需要合法 backupId，commit 需要 token 与确认', () => {
    const preview = validateIpcRequest(
      CHANNEL_SPECS.backupRestore,
      mutation({ mode: 'preview', backupId: '00000000-0000-4000-8000-000000000001' }),
    );
    expect(preview.payload).toMatchObject({ mode: 'preview' });
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.backupRestore,
          mutation({ mode: 'preview', backupId: 'not-a-uuid' }),
        ),
      'FIELD_INVALID',
    );
    const commit = validateIpcRequest(
      CHANNEL_SPECS.backupRestore,
      mutation({ mode: 'commit', restoreToken: 'token', currentDataWillBeReplaced: true }),
    );
    expect(commit.payload).toMatchObject({ mode: 'commit' });
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.backupRestore,
          mutation({ mode: 'commit', restoreToken: 'token' }),
        ),
      'FIELD_INVALID',
    );
    expectAppError(
      () =>
        validateIpcRequest(
          CHANNEL_SPECS.backupRestore,
          mutation({ mode: 'destroy', backupId: '00000000-0000-4000-8000-000000000001' }),
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
