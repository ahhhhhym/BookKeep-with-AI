import type { BookKeepApi, ApiResult } from '../../shared/api';
import type { RestoreStatus } from '../../shared/maintenance';
import { BridgeError } from './bridge';

const STATUS_TIMEOUT_MS = 5_000;

/** 只读核实，不持有恢复token，也无权重发commit；迟到promise不发布页面状态。 */
async function statusWithDeadline(api: BookKeepApi, restoreId: string): Promise<ApiResult<RestoreStatus>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      api.maintenance.restoreStatus({ restoreId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BridgeError('INTERNAL_ERROR', null)), STATUS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function reconcileRestore(api: BookKeepApi, restoreId: string): Promise<RestoreStatus> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await statusWithDeadline(api, restoreId);
    if (!reply.ok) {
      if (attempt === 0 && reply.error.code === 'STALE_EPOCH') continue;
      throw new BridgeError(reply.error.code, reply.error);
    }
    const status = reply.data;
    if (status.status === 'committed' && status.result?.newDataEpoch && status.result.newDataEpoch === reply.dataEpoch) return status;
    if (['previously_committed', 'failed', 'interrupted', 'unknown'].includes(status.status) && status.result === null) return status;
    throw new BridgeError('INTEGRITY_ERROR', null);
  }
  throw new BridgeError('STALE_EPOCH', null);
}

export const RESTORE_STATUS_TEXT = {
  committed: '已核实恢复提交成功；核实时本次恢复为当前数据世代。',
  previously_committed: '本次恢复曾提交，但当前已切换到另一恢复世代；不能据此认定当前数据仍为那次恢复结果。',
  failed: '本次恢复在提交前失败，未确认覆盖当前数据。请核对当前列表后再决定是否重新预览恢复。',
  interrupted: '本次恢复记录中断，未查到当前有效提交。请核对当前列表；程序不会自动重新恢复。',
  unknown: '未查到本次恢复的确定记录，尚不能确认是否提交。程序不会自动重新恢复，可再次核实。',
} as const;
