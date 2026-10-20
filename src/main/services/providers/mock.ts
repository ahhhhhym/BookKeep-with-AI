/**
 * 本地 mock provider：确定性合成输出，不出网、不读图片、不写数据库。
 * 用途是打通「provider → 结构校验 → 规范化 → UI」链路；不代表真实识图能力（G2 未执行）。
 */

import {
  CANDIDATE_SCHEMA_VERSION,
  MOCK_MODEL,
  PROMPT_VERSION,
} from '../../../shared/constants';
import { AppError } from '../../../shared/errors';
import type { ProviderCapabilitiesView } from '../../../shared/dto';
import {
  parseCandidateOutput,
  type CandidateOutput,
  type Proposal,
} from '../../../shared/candidate';
import type {
  ProviderResult,
  RecognitionProvider,
  RecognitionRequest,
} from './types';

export const MOCK_ADAPTER_VERSION = 'mock-adapter/1.0.0';

const SYNTHETIC_NOTE = '本地模拟：结果由内置合成数据生成，未发送任何图片或网络请求，不代表真实识别质量。';

function evidence(field: string, text: string, region: { x: number; y: number; width: number; height: number }) {
  return { field, text, region, source: 'image' as const };
}

function baseProposal(overrides: Partial<Proposal>): Proposal {
  return {
    amountFen: null,
    occurredDate: null,
    occurredTime: null,
    timePrecision: 'unknown',
    name: null,
    merchant: null,
    categoryId: null,
    transactionKind: null,
    amountBasis: null,
    groupKey: null,
    lineItems: [],
    evidence: [],
    missingFields: [],
    warnings: [],
    confidence: null,
    ...overrides,
  };
}

function twoExpenseScenario(): CandidateOutput {
  const lunch = baseProposal({
    amountFen: 1800,
    occurredDate: '2026-10-02',
    occurredTime: '12:10',
    timePrecision: 'minute',
    name: '午餐',
    merchant: '示例商户（合成）',
    categoryId: 'cat_food',
    transactionKind: 'expense',
    amountBasis: 'line_payment',
    groupKey: 'demo-order-1',
    evidence: [
      evidence('amountFen', '¥18.00', { x: 0.62, y: 0.34, width: 0.2, height: 0.06 }),
      evidence('occurredDate', '10月02日', { x: 0.08, y: 0.12, width: 0.24, height: 0.06 }),
      evidence('occurredTime', '12:10', { x: 0.36, y: 0.12, width: 0.16, height: 0.06 }),
      evidence('name', '午餐', { x: 0.1, y: 0.3, width: 0.2, height: 0.06 }),
      evidence('categoryId', '餐饮', { x: 0.1, y: 0.4, width: 0.16, height: 0.06 }),
    ],
    missingFields: [],
    warnings: [],
    confidence: 0.91,
  });

  const coffee = baseProposal({
    amountFen: 2250,
    occurredDate: '2026-10-02',
    occurredTime: '15:40',
    timePrecision: 'minute',
    name: '咖啡',
    merchant: '示例咖啡（合成）',
    categoryId: 'cat_food',
    transactionKind: 'expense',
    amountBasis: 'line_payment',
    groupKey: 'demo-order-2',
    evidence: [
      evidence('amountFen', '¥22.50', { x: 0.62, y: 0.56, width: 0.2, height: 0.06 }),
      evidence('occurredDate', '10月02日', { x: 0.08, y: 0.12, width: 0.24, height: 0.06 }),
      evidence('occurredTime', '15:40', { x: 0.36, y: 0.12, width: 0.16, height: 0.06 }),
      evidence('name', '咖啡', { x: 0.1, y: 0.52, width: 0.2, height: 0.06 }),
      evidence('categoryId', '餐饮', { x: 0.1, y: 0.62, width: 0.16, height: 0.06 }),
    ],
    missingFields: [],
    warnings: [],
    confidence: 0.88,
  });

  return { schemaVersion: CANDIDATE_SCHEMA_VERSION, candidates: [lunch, coffee], warnings: [] };
}

function paidOrderScenario(): CandidateOutput {
  const order = baseProposal({
    amountFen: 2000,
    occurredDate: '2026-10-02',
    timePrecision: 'date',
    name: '米饭和汤',
    merchant: '示例餐厅（合成）',
    categoryId: 'cat_food',
    transactionKind: 'expense',
    amountBasis: 'paid_total',
    groupKey: 'demo-order-3',
    lineItems: [
      { name: '米饭', amountFen: 1800, evidenceIndexes: [0] },
      { name: '汤', amountFen: 700, evidenceIndexes: [1] },
    ],
    evidence: [
      evidence('amountFen', '实付 ¥20.00', { x: 0.6, y: 0.8, width: 0.24, height: 0.06 }),
      evidence('lineItems', '米饭 18.00 / 汤 7.00', { x: 0.1, y: 0.4, width: 0.5, height: 0.2 }),
      evidence('occurredDate', '2026-10-02', { x: 0.08, y: 0.12, width: 0.3, height: 0.06 }),
      evidence('name', '米饭和汤', { x: 0.1, y: 0.3, width: 0.3, height: 0.06 }),
      evidence('categoryId', '餐饮', { x: 0.1, y: 0.62, width: 0.16, height: 0.06 }),
    ],
    missingFields: [],
    warnings: [
      {
        code: 'TOTAL_DETAIL_AMBIGUOUS',
        message: '合计与明细同时出现，需人工保留本次实际支付项。',
        field: 'amountBasis',
      },
    ],
    confidence: 0.72,
  });

  return { schemaVersion: CANDIDATE_SCHEMA_VERSION, candidates: [order], warnings: [] };
}

function productPhotoScenario(): CandidateOutput {
  const photo = baseProposal({
    amountFen: null,
    occurredDate: null,
    timePrecision: 'unknown',
    name: '示例商品（合成）',
    merchant: null,
    categoryId: null,
    transactionKind: null,
    amountBasis: null,
    evidence: [
      evidence('name', '示例商品（合成）', { x: 0.32, y: 0.4, width: 0.36, height: 0.12 }),
    ],
    missingFields: ['amountFen', 'occurredDate', 'categoryId'],
    warnings: [
      { code: 'AMOUNT_AMBIGUOUS', message: '商品照片没有可读金额。', field: 'amountFen' },
      { code: 'NON_EXPENSE', message: '无法证实已发生支出。', field: 'transactionKind' },
    ],
    confidence: 0.35,
  });

  return { schemaVersion: CANDIDATE_SCHEMA_VERSION, candidates: [photo], warnings: [] };
}

const SCENARIOS = {
  'two-expenses': twoExpenseScenario,
  'paid-order': paidOrderScenario,
  'product-photo': productPhotoScenario,
} as const;

function buildOutput(scenario: RecognitionRequest['mockScenario']): CandidateOutput {
  const builder = scenario ? SCENARIOS[scenario] : undefined;
  if (!builder) {
    throw new AppError('PAYLOAD_INVALID', {
      fieldErrors: [{ path: 'payload.scenario', code: 'UNKNOWN_SCENARIO' }],
    });
  }
  return builder();
}

export const mockProvider: RecognitionProvider = {
  id: 'mock',

  capabilities(): ProviderCapabilitiesView {
    return {
      providerId: 'mock',
      adapterVersion: MOCK_ADAPTER_VERSION,
      supportsImage: true,
      structuredOutputStatus: 'verified',
      trainingSubmitSupported: false,
      model: MOCK_MODEL,
      probeEvidenceId: null,
    };
  },

  async recognize(request: RecognitionRequest): Promise<ProviderResult> {
    if (request.model !== MOCK_MODEL) {
      throw new AppError('FIELD_INVALID', {
        fieldErrors: [{ path: 'request.model', code: 'MOCK_MODEL_REQUIRED' }],
      });
    }
    if (request.schemaVersion !== CANDIDATE_SCHEMA_VERSION) {
      throw new AppError('OUTPUT_SCHEMA_INVALID', {
        details: { reason: `expected=${CANDIDATE_SCHEMA_VERSION}` },
      });
    }
    if (request.promptVersion !== PROMPT_VERSION) {
      throw new AppError('FIELD_INVALID', {
        fieldErrors: [{ path: 'request.promptVersion', code: 'UNKNOWN_PROMPT_VERSION' }],
      });
    }

    const startedAt = new Date();
    const started = performance.now();
    const output = parseCandidateOutput(buildOutput(request.mockScenario));
    const finishedAt = new Date();
    const durationMs = Number((performance.now() - started).toFixed(3));

    return {
      provider: 'mock',
      adapterVersion: MOCK_ADAPTER_VERSION,
      requestedModel: MOCK_MODEL,
      actualModel: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      output,
      note: SYNTHETIC_NOTE,
    };
  },
};
