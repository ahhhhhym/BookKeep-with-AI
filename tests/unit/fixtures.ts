import type { Proposal } from '../../src/shared/candidate';

/** 单测用的合法候选（合成数据，不是验收夹具）。 */
export function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    amountFen: 4426,
    occurredDate: '2026-09-08',
    occurredTime: null,
    timePrecision: 'date',
    name: '午餐',
    merchant: null,
    categoryId: 'cat_food',
    transactionKind: 'expense',
    amountBasis: 'paid_total',
    groupKey: null,
    lineItems: [],
    evidence: [
      { field: 'amountFen', text: '¥44.26', region: null, source: 'image' },
      { field: 'occurredDate', text: '2026-09-08', region: null, source: 'image' },
      { field: 'name', text: '午餐', region: null, source: 'image' },
      { field: 'categoryId', text: '餐饮', region: null, source: 'image' },
    ],
    missingFields: [],
    warnings: [],
    confidence: 0.8,
    ...overrides,
  };
}

export function makeOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'bk-candidate.v1',
    candidates: [makeProposal()],
    warnings: [],
    ...overrides,
  };
}
