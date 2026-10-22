import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookKeepApi } from '../../src/shared/api';
import { reconcileRestore } from '../../src/renderer/lib/restore-status';
const transport = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }));
vi.mock('electron', () => ({ ipcRenderer: { invoke: transport.invoke }, contextBridge: { exposeInMainWorld: transport.expose }, webUtils: {} }));
const envelope = (epoch: string, data: unknown = {}) => ({ ok: true, data, dataEpoch: epoch, dataRevision: 1 });
let api: BookKeepApi;
beforeEach(async () => {
  vi.resetModules(); transport.invoke.mockReset(); transport.expose.mockReset();
  await import('../../src/preload/index');
  api = transport.expose.mock.calls[0]![1] as BookKeepApi;
  transport.invoke.mockResolvedValue(envelope('old'));
  await api.settings.readAi();
});
afterEach(() => vi.useRealTimers());
describe('preload epoch response fence', () => {
  it.each([true, false])('late old envelope (ok=%s) cannot publish stale data or roll back the next request', async ok => {
    let release!: (v: unknown) => void;
    transport.invoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const late = api.backup.list();
    transport.invoke.mockResolvedValueOnce(envelope('new'));
    await api.settings.readAi();
    release({ ...envelope('old', { records: ['obsolete'] }), ok });
    expect(await late).toMatchObject({ ok: false, error: { code: 'STALE_EPOCH' }, dataEpoch: 'new' });
    transport.invoke.mockResolvedValueOnce(envelope('new'));
    await api.settings.readAi();
    expect(transport.invoke.mock.calls.at(-1)![1].dataEpoch).toBe('new');
  });
  it('synchronizes epoch from a real failure envelope without relaxing an explicit old write epoch', async () => {
    transport.invoke.mockResolvedValueOnce({ ...envelope('new'), ok: false, error: { code: 'STALE_EPOCH' } });
    expect(await api.maintenance.restoreStatus({ restoreId: crypto.randomUUID() })).toMatchObject({ ok: false, error: { code: 'STALE_EPOCH' } });
    transport.invoke.mockResolvedValueOnce(envelope('new'));
    await api.settings.readAi();
    expect(transport.invoke.mock.calls.at(-1)![1].dataEpoch).toBe('new');
    await api.ledger.ensureDefault({ dataEpoch: 'old' });
    expect(transport.invoke.mock.calls.at(-1)![1].dataEpoch).toBe('old');
  });
});

describe('restore reconciliation through the actual preload', () => {
  it('uses the failed status envelope to send the second read with the new epoch and original restoreId', async () => {
    const restoreId = crypto.randomUUID();
    transport.invoke.mockImplementation(async (channel, request) => {
      expect(channel).toBe('backup.restoreStatus');
      expect(request.payload.restoreId).toBe(restoreId);
      if (request.dataEpoch === 'old') return { ...envelope('new'), ok: false, error: { code: 'STALE_EPOCH' } };
      return envelope('new', { status: 'committed', result: { newDataEpoch: 'new' } });
    });
    expect(await reconcileRestore(api, restoreId)).toMatchObject({ status: 'committed' });
    expect(transport.invoke.mock.calls.slice(1).map(c => c[1].dataEpoch)).toEqual(['old', 'new']);
  });
  it('stops after two stale epochs without a mutation', async () => {
    transport.invoke.mockResolvedValue({ ...envelope('new'), ok: false, error: { code: 'STALE_EPOCH' } });
    await expect(reconcileRestore(api, crypto.randomUUID())).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    expect(transport.invoke.mock.calls.slice(1).map(c => c[0])).toEqual(['backup.restoreStatus', 'backup.restoreStatus']);
  });
  it.each(['unknown', 'failed', 'interrupted', 'previously_committed'])('preserves %s instead of reporting current commit', async status => {
    transport.invoke.mockResolvedValue(envelope('old', { status, result: null }));
    expect(await reconcileRestore(api, crypto.randomUUID())).toEqual({ status, result: null });
    expect(transport.invoke).toHaveBeenCalledTimes(2); // bootstrap + one read
  });
  it('does not retry an ordinary transport failure', async () => {
    transport.invoke.mockRejectedValue(Error('synthetic transport loss'));
    await expect(reconcileRestore(api, crypto.randomUUID())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transport.invoke).toHaveBeenCalledTimes(2);
  });
  it('times out a hung query and a late reply cannot complete that reconciliation', async () => {
    vi.useFakeTimers();
    let release!: (v: unknown) => void;
    transport.invoke.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = reconcileRestore(api, crypto.randomUUID());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    release(envelope('old', { status: 'committed', result: { newDataEpoch: 'old' } }));
    await Promise.resolve();
    expect(transport.invoke).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: 'committed', result: { newDataEpoch: 'different' } },
    { status: 'committed', result: null },
    { status: 'unsupported-status', result: null },
  ])('rejects inconsistent or unsupported status $status/$result', async status => {
    transport.invoke.mockResolvedValue(envelope('old', status));
    await expect(reconcileRestore(api, crypto.randomUUID())).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});
