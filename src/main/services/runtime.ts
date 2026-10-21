/** 运行环境摘要（只读、无敏感信息），用于设置页与自检报告。 */

import type { RuntimeSummaryView } from '../../shared/dto';
import { CONTRACT_VERSION } from '../../shared/constants';

export interface RuntimeEnvironment {
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly versions: NodeJS.ProcessVersions;
}

export function getRuntimeSummary(env: RuntimeEnvironment): RuntimeSummaryView {
  return {
    appVersion: env.appVersion,
    contractVersion: CONTRACT_VERSION,
    platform: env.platform,
    arch: env.arch,
    electron: env.versions.electron ?? 'unknown',
    chrome: env.versions.chrome ?? 'unknown',
    node: env.versions.node ?? 'unknown',
    modules: env.versions.modules ?? 'unknown',
  };
}
