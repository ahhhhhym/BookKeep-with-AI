/** 错误码 → 中文文案（docs/UX.md 各页错误文案；未知码保留可复制的安全编号）。 */

import type { ErrorCode } from '../../shared/errors';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  PERMISSION_DENIED: '当前窗口无权执行该操作，请从应用主窗口重试。',
  PAYLOAD_INVALID: '请求内容不完整或格式不正确，本次操作未执行。',
  FIELD_INVALID: '输入内容不符合要求，请检查后重试。',
  CONTRACT_VERSION_UNSUPPORTED: '应用前后端版本不一致，请重新启动应用。',
  NOT_IMPLEMENTED: '此功能尚未实现。',
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
  DB_BUSY: '账本正忙，请稍后重试。',
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
