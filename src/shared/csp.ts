/**
 * 内容安全策略：构建期注入 index.html meta，运行期由主进程二次校验。
 * 生产策略禁止外部连接、内联脚本、对象嵌入与表单提交。
 */

export type BuildMode = 'development' | 'production';

/** 开发服务器固定地址（scripts/dev.mjs 使用同一端口）。 */
export const DEV_SERVER_HOST = '127.0.0.1';
export const DEV_SERVER_PORT = 5273;
export const DEV_SERVER_ORIGIN = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;

const BASE_DIRECTIVES: readonly string[] = [
  "default-src 'none'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "frame-src 'none'",
];

export function buildContentSecurityPolicy(mode: BuildMode): string {
  if (mode === 'development') {
    return [
      ...BASE_DIRECTIVES,
      `script-src 'self' 'unsafe-inline' ${DEV_SERVER_ORIGIN}`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ws://${DEV_SERVER_HOST}:* ${DEV_SERVER_ORIGIN}`,
    ].join('; ');
  }
  return [...BASE_DIRECTIVES, "script-src 'self'", "style-src 'self'", "connect-src 'none'"].join('; ');
}

/** 生产策略必须满足的最小断言（自检与单测共用）。 */
export const REQUIRED_PRODUCTION_DIRECTIVES: readonly string[] = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
];
