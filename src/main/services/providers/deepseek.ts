/**
 * DeepSeek provider 占位适配器。
 * S04 明确不实现真实 HTTP 调用：没有密钥存取、不发图片、不产生费用。
 * 能力声明的结构化输出状态为 unverified，直到 S09 用真实探针验证（G2）。
 */

import { DEEPSEEK_MODEL } from '../../../shared/constants';
import { notImplemented } from '../../../shared/errors';
import type { ProviderCapabilitiesView } from '../../../shared/dto';
import type { ProviderResult, RecognitionProvider, RecognitionRequest } from './types';

export const DEEPSEEK_ADAPTER_VERSION = 'deepseek-adapter/0.1.0-probe';

export const deepseekProvider: RecognitionProvider = {
  id: 'deepseek',

  capabilities(): ProviderCapabilitiesView {
    return {
      providerId: 'deepseek',
      adapterVersion: DEEPSEEK_ADAPTER_VERSION,
      supportsImage: true,
      structuredOutputStatus: 'unverified',
      trainingSubmitSupported: false,
      model: DEEPSEEK_MODEL,
      probeEvidenceId: null,
    };
  },

  async recognize(_request: RecognitionRequest): Promise<ProviderResult> {
    throw notImplemented('provider.deepseek.recognize.image-handle-scheduler', 'S10');
  },
};
