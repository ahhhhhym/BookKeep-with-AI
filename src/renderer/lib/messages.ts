/** 错误码 → 中文文案（docs/UX.md 各页错误文案；未知码保留可复制的安全编号）。 */

import type { ErrorCode } from '../../shared/errors';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  PERMISSION_DENIED: '当前窗口无权执行该操作，请从应用主窗口重试。',
  PAYLOAD_INVALID: '请求内容不完整或格式不正确，本次操作未执行。',
  FIELD_INVALID: '输入内容不符合要求，请检查后重试。',
  CONTRACT_VERSION_UNSUPPORTED: '应用前后端版本不一致，请重新启动应用。',
  NOT_IMPLEMENTED: '此功能尚未实现。',
  REVIEW_STALE: '候选或账本已变化，本次未入账。请重新读取并逐项核对。',
  REVIEW_INCOMPLETE: '请先补填字段、处理疑点并逐项核对后再批准。',
  DUPLICATE_UNRESOLVED: '疑似重复尚未处理，请核实是否是另一笔真实消费并说明理由。',
  NON_EXPENSE: '此项尚未核实为真实支出，不能入账。',
  EVIDENCE_MISSING: '字段依据不足，请对照来源图补填并说明事实依据。',
  IMAGE_FORMAT: '图片格式不支持，请选择JPEG、PNG或WebP。',
  IMAGE_DECODE: '图片内容损坏或无法解码，请重新选择。',
  IMAGE_TOO_LARGE: '图片超过10MiB，请在外部裁剪或压缩后重选。',
  IMAGE_DIMENSION: '图片最长边超过8192像素或包含动画，请重新选择静态图。',
  IMAGE_REGION_INVALID: '裁剪或遮盖区域超出图片，请调整位置和尺寸。',
  IMAGE_IN_USE: '图片正被任务或记录引用，不能删除；可另存处理图。',
  IMAGE_NOT_PREPARED: '请先保存并核对处理图，再同意上传。',
  BATCH_LIMIT: '每批最多20张，请重新选择。',
  ARTIFACT_MISSING: '本地图像未保留或文件缺失，请重新选择。',
  CONSENT_REQUIRED: '请核对当前处理图并重新同意本次上传。',
  UNSUPPORTED: '当前版本不支持该操作。',
  SECRET_INVALID: '密钥格式无效，请核对后重新输入。',
  SECRET_RATE_LIMIT: '提交过于频繁，请稍后重试。',
  SECRET_UNREADABLE: '当前用户无法读取已存密钥，请重新配置。',
  SECRET_REQUIRED: '尚未配置识图密钥，可先保存图片或继续手工记账。',
  PROVIDER_NOT_READY: '识图服务尚未就绪，当前不可发起识别。',
  PROVIDER_AUTH: '密钥无效或已失效，请到设置重新配置。',
  PROVIDER_FORBIDDEN: '账户无权访问此服务，请检查账户权限。',
  PROVIDER_BALANCE: '账户余额不足，请检查账户。',
  PROVIDER_INPUT: '图片请求不被服务接受，请检查图片或模型配置。',
  PROVIDER_RATE_LIMIT: '服务请求过于频繁，请稍后重试。',
  REQUEST_TIMEOUT: '本次请求已超时。',
  NETWORK_ERROR: '当前无法连接识图服务，可稍后重试；图片已保存在本地。',
  OUTPUT_SCHEMA_INVALID: '识别结果格式无效，本图没有生成候选。',
  INTERNAL_ERROR: '操作未完成，请重试并记录错误编号。',
  STORAGE_UNAVAILABLE: '无法访问本地数据目录，请检查系统环境。',
  STORAGE_FULL: '存储空间不足，尚未保存。请释放空间后重试。',
  DB_BUSY: '账本正忙，请稍后重试。',
  AMOUNT_INVALID: '请输入 0.01～9,999,999.99 元，最多两位小数。',
  AMOUNT_TOTAL_OVERFLOW: '汇总金额超出支持范围，无法显示准确结果。',
  FUTURE_PERIOD: '请选择不晚于上海今天的统计周期。',
  FUTURE_POINT: '尚未到来，当前不提供支出详情。',
  POINT_OUTSIDE_SCOPE: '该日期不在当前统计周期内，请重新选择。',
  DATE_INVALID: '请选择有效的完整日期（1900-01-01～9998-12-31）。',
  RANGE_INVALID: '开始日期必须早于结束日期。',
  NOT_FOUND: '记录不存在或已被删除，请刷新后重试。',
  STATE_CONFLICT: '当前状态不允许该操作，请刷新后重试。',
  VERSION_CONFLICT: '数据已变化，请刷新后重新编辑。',
  TRANSACTION_DELETED: '这笔记录已删除，可先到“已删除记录”中恢复。',
  CATEGORY_DISABLED: '该分类已停用，新支出不能选用；历史记录仍保留。',
  CATEGORY_NAME_EXISTS: '分类名称已存在（含停用项），请换一个名称。',
  CATEGORY_PROTECTED: '系统“其他”分类不能停用。',
  CATEGORY_LIMIT: '分类数量已达上限（500 个，含停用）。',
  ICON_INVALID: '图标不可用，请选择本地图标。',
  IDEMPOTENCY_CONFLICT: '该提交标识已用于另一份内容，请重新操作。',
  SNAPSHOT_STALE: '列表数据已变化，请从第一页重新读取。',
  STALE_EPOCH: '数据世代已变化（可能恢复了备份），请重新读取。',
  RECOVERY_REQUIRED: '账本处于恢复模式，业务写入已停止；请先在“数据管理”从备份恢复。',
  MIGRATION_FAILED: '数据库迁移失败，旧数据未被覆盖；请从迁移前备份恢复。',
  SCHEMA_TOO_NEW: '数据库版本比当前应用新，请使用更新的应用版本。',
  SCHEMA_UNSUPPORTED: '数据库版本不受当前应用支持，现有数据未修改。',
  INTEGRITY_ERROR: '账本完整性检查失败，现有数据未修改；请从备份恢复。',
  BACKUP_INVALID: '备份文件损坏或格式不兼容，已拒绝恢复，当前数据未改变。',
  BACKUP_FAILED: '备份创建失败，请检查磁盘空间与权限。',
  HASH_MISMATCH: '备份文件校验不一致，已拒绝恢复，当前数据未改变。',
  RESTORE_FAILED: '恢复失败，当前账本未被覆盖。',
  TOKEN_EXPIRED: '确认已过期，请重新预览后再操作。',
};

export const BRIDGE_UNAVAILABLE_TEXT = '未检测到安全的界面通道，请重新启动应用。';

export function describeErrorCode(code: string, fallbackLabel = '操作未完成'): string {
  const known = MESSAGES[code as ErrorCode];
  if (known) return known;
  return `${fallbackLabel}（错误编号：${code}）。`;
}

export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    return describeErrorCode(code);
  }
  return '操作未完成，请重试。';
}
