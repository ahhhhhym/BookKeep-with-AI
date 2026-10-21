import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCHEMA_VERSION, MOCK_MODEL, PROMPT_VERSION } from '../../src/shared/constants';
import { AppError } from '../../src/shared/errors';
import { normalizeCandidateOutput, parseCandidateOutput } from '../../src/shared/candidate';
import { mockProvider } from '../../src/main/services/providers/mock';
import type { RecognitionRequest } from '../../src/main/services/providers/types';

function buildRequest(overrides: Partial<RecognitionRequest> = {}): RecognitionRequest {
  return {
    requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    model: MOCK_MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    image: null,
    categories: [{ id: 'cat_food', name: '餐饮' }],
    mockScenario: 'two-expenses',
    ...overrides,
  };
}

describe('mock provider', () => {
  it('声明为本地模拟：不支持的训练提交、无真实模型标识', () => {
    const capabilities = mockProvider.capabilities();
    expect(capabilities.providerId).toBe('mock');
    expect(capabilities.trainingSubmitSupported).toBe(false);
    expect(capabilities.probeEvidenceId).toBeNull();
    expect(capabilities.model).toBe(MOCK_MODEL);
  });

  it('两笔消费场景输出合法结构且不阻断', async () => {
    const result = await mockProvider.recognize(buildRequest());
    expect(result.provider).toBe('mock');
    expect(result.actualModel).toBeNull();
    expect(result.requestedModel).toBe(MOCK_MODEL);

    const parsed = parseCandidateOutput(result.output);
    expect(parsed.candidates).toHaveLength(2);
    const normalized = normalizeCandidateOutput(parsed);
    expect(normalized.candidates.map((candidate) => candidate.blocking)).toEqual([false, false]);
    expect(normalized.candidates.every((candidate) => candidate.missingFields.length === 0)).toBe(true);
  });

  it('合计/明细场景保留阻断疑点', async () => {
    const result = await mockProvider.recognize(buildRequest({ mockScenario: 'paid-order' }));
    const normalized = normalizeCandidateOutput(parseCandidateOutput(result.output));
    expect(normalized.candidates[0]?.blocking).toBe(true);
    expect(normalized.candidates[0]?.warnings.map((warning) => warning.code)).toContain('TOTAL_DETAIL_AMBIGUOUS');
  });

  it('商品照片场景缺金额/日期并阻断', async () => {
    const result = await mockProvider.recognize(buildRequest({ mockScenario: 'product-photo' }));
    const normalized = normalizeCandidateOutput(parseCandidateOutput(result.output));
    const candidate = normalized.candidates[0];
    expect(candidate?.blocking).toBe(true);
    expect(candidate?.missingFields).toEqual(expect.arrayContaining(['amountFen', 'occurredDate']));
  });

  it('确定性输出：同一场景两次结果结构一致', async () => {
    const first = await mockProvider.recognize(buildRequest());
    const second = await mockProvider.recognize(buildRequest());
    expect(first.output).toEqual(second.output);
  });

  it('拒绝错误模型/提示词/未知场景，不静默降级', async () => {
    await expect(mockProvider.recognize(buildRequest({ model: 'deepseek-flash' }))).rejects.toBeInstanceOf(AppError);
    await expect(
      mockProvider.recognize(buildRequest({ promptVersion: 'bk-prompt.vX' })),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      mockProvider.recognize(buildRequest({ mockScenario: 'unknown' as never })),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('不发起网络请求、不读取文件（recognize 只依赖输入与内置数据）', async () => {
    const result = await mockProvider.recognize(buildRequest({ image: null }));
    expect(result.note).toContain('未发送任何图片或网络请求');
    expect(JSON.stringify(result.output)).not.toContain('data:image');
  });
});
