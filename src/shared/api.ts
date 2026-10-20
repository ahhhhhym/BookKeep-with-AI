/** 受限 preload 暴露给渲染层的 API 形状（唯一跨进程入口）。 */

import type {
  AiSettingsView,
  MockRecognitionInput,
  MockRecognitionView,
  ProviderCapabilitiesView,
  SecretSaveResult,
  SecretStatusView,
} from './dto';
import type { ProviderCapabilitiesInput, SaveSecretInput } from './ipc';
import type { AppErrorPayload } from './errors';

/** 桥接结果对象：错误以数据形式返回，不跨上下文抛自定义异常（避免丢字段）。 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload };

export interface BookKeepApi {
  readonly contractVersion: string;
  readonly skeletonStage: 'S04';
  readonly settings: {
    /** AI 配置摘要（不含密钥、明文或路径）。 */
    readAi(): Promise<ApiResult<AiSettingsView>>;
    /** 本机密钥状态；只返回 configured/mode/version，不返回掩码或片段。 */
    readStatus(): Promise<ApiResult<SecretStatusView>>;
    /** 受限密钥写入入口：S04 校验载荷后返回 NOT_IMPLEMENTED，S09 实现安全存储。 */
    saveSecret(input: SaveSecretInput): Promise<ApiResult<SecretSaveResult>>;
  };
  readonly provider: {
    capabilities(input: ProviderCapabilitiesInput): Promise<ApiResult<ProviderCapabilitiesView>>;
  };
  /** S04 骨架诊断入口：强制本地 mock，不出网、不读文件、不写库。 */
  readonly skeleton: {
    mockRecognition(input: MockRecognitionInput): Promise<ApiResult<MockRecognitionView>>;
  };
}
