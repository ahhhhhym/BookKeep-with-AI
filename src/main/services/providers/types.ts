/** provider 适配器内部接口（仅主进程使用，不暴露给渲染层）。 */

import type { CandidateOutput } from '../../../shared/candidate';
import type { MockScenario, ProviderCapabilitiesView, ProviderId } from '../../../shared/dto';

export interface RecognitionImageHandle {
  readonly mime: string;
  readonly hash: string;
  readonly byteLength: number;
}

export interface RecognitionRequest {
  readonly requestId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  /** 真实 provider 的受限图片句柄；mock 不使用，也不保存。 */
  readonly image: RecognitionImageHandle | null;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** 仅本地 mock 使用的合成场景选择；真实 provider 忽略。 */
  readonly mockScenario?: MockScenario;
}

export interface ProviderResult {
  readonly provider: ProviderId;
  readonly adapterVersion: string;
  readonly requestedModel: string;
  /** 只有真实响应才有值；mock 必须为 null。 */
  readonly actualModel: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  /** 已通过 bk-candidate.v1 结构校验的原始输出（模型语义对象）。 */
  readonly output: CandidateOutput;
  readonly note: string;
}

export interface RecognitionProvider {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilitiesView;
  recognize(request: RecognitionRequest): Promise<ProviderResult>;
}
