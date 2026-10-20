import { describe, expect, it } from 'vitest';
import {
  CandidateSchemaError,
  normalizeCandidateOutput,
  parseCandidateOutput,
} from '../../src/shared/candidate';
import { makeOutput, makeProposal } from './fixtures';

function expectSchemaError(raw: unknown): CandidateSchemaError {
  try {
    parseCandidateOutput(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(CandidateSchemaError);
    return error as CandidateSchemaError;
  }
  throw new Error('expected CandidateSchemaError');
}

describe('bk-candidate.v1 结构校验', () => {
  it('接受空候选数组（0 笔候选是合法结果）', () => {
    const output = parseCandidateOutput(makeOutput({ candidates: [] }));
    expect(output.candidates).toHaveLength(0);
  });

  it('接受合法候选并保留全部字段', () => {
    const output = parseCandidateOutput(makeOutput());
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]?.amountFen).toBe(4426);
    expect(output.candidates[0]?.timePrecision).toBe('date');
  });

  it('拒绝未知根键与错误 schemaVersion', () => {
    expect(expectSchemaError({ ...makeOutput(), extra: true }).issues).toContain('root.extra:UNKNOWN_KEY');
    expect(expectSchemaError(makeOutput({ schemaVersion: 'bk-candidate.v2' })).issues).toContain(
      'root.schemaVersion:UNSUPPORTED_SCHEMA',
    );
  });

  it('拒绝超过 100 个候选或 20 条根级 warnings', () => {
    const tooMany = {
      ...makeOutput(),
      candidates: Array.from({ length: 101 }, () => makeProposal()),
    };
    expect(expectSchemaError(tooMany).issues).toContain('root.candidates:EXPECTED_ARRAY_MAX_100');
  });

  it('拒绝未知 warning code 与非法 evidence 区域', () => {
    const unknownWarning = makeOutput({
      candidates: [
        makeProposal({
          warnings: [{ code: 'TOTALLY_FINE', message: '模型自称安全', field: null }],
        }),
      ],
    });
    expect(expectSchemaError(unknownWarning).issues.join()).toContain('UNKNOWN_CODE');

    const badRegion = makeOutput({
      candidates: [
        makeProposal({
          evidence: [{ field: 'amountFen', text: null, region: { x: 0.9, y: 0.1, width: 0.5, height: 0.2 }, source: 'image' }],
        }),
      ],
    });
    expect(expectSchemaError(badRegion).issues.join()).toContain('REGION_RANGE');
  });

  it('拒绝 precision 与日期/时间不一致的候选', () => {
    const inconsistent = makeOutput({
      candidates: [makeProposal({ timePrecision: 'minute', occurredTime: null })],
    });
    expect(expectSchemaError(inconsistent).issues.join()).toContain('MINUTE_INCONSISTENT');

    const unknownWithDate = makeOutput({
      candidates: [makeProposal({ timePrecision: 'unknown', occurredDate: '2026-09-08' })],
    });
    expect(expectSchemaError(unknownWithDate).issues.join()).toContain('UNKNOWN_WITH_VALUES');
  });

  it('拒绝不存在的日历日期与非法 groupKey', () => {
    const badDate = makeOutput({ candidates: [makeProposal({ occurredDate: '2026-02-30' })] });
    expect(expectSchemaError(badDate).issues.join()).toContain('INVALID_DATE');

    const badGroup = makeOutput({ candidates: [makeProposal({ groupKey: '订单 一' })] });
    expect(expectSchemaError(badGroup).issues.join()).toContain('INVALID_GROUP_KEY');
  });

  it('拒绝缺少键的候选（所有键必须显式存在）', () => {
    const { confidence: _ignored, ...withoutConfidence } = makeProposal();
    const raw = makeOutput({ candidates: [withoutConfidence] });
    expect(expectSchemaError(raw).issues.join()).toContain('confidence:MISSING_KEY');
  });
});

describe('候选规范化与阻断派生', () => {
  it('缺失字段由实际值重新计算，不信任模型自报', () => {
    const output = parseCandidateOutput(
      makeOutput({
        candidates: [
          makeProposal({
            categoryId: null,
            missingFields: [],
          }),
        ],
      }),
    );
    const normalized = normalizeCandidateOutput(output);
    expect(normalized.candidates[0]?.missingFields).toEqual(['categoryId']);
    expect(normalized.candidates[0]?.warnings.map((warning) => warning.code)).toContain('MODEL_MISSING_MISMATCH');
    expect(normalized.candidates[0]?.blocking).toBe(true);
  });

  it('非支出与证据缺失都阻断', () => {
    const nonExpense = normalizeCandidateOutput(
      parseCandidateOutput(makeOutput({ candidates: [makeProposal({ transactionKind: 'refund' })] })),
    );
    expect(nonExpense.candidates[0]?.blocking).toBe(true);

    const noEvidence = normalizeCandidateOutput(
      parseCandidateOutput(makeOutput({ candidates: [makeProposal({ evidence: [] })] })),
    );
    const codes = noEvidence.candidates[0]?.warnings.map((warning) => warning.code) ?? [];
    expect(codes).toContain('EVIDENCE_MISSING');
    expect(noEvidence.candidates[0]?.blocking).toBe(true);
  });

  it('完整且为支出的候选不阻断，但 current 与 proposal 互不共享引用', () => {
    const normalized = normalizeCandidateOutput(parseCandidateOutput(makeOutput()));
    const candidate = normalized.candidates[0];
    expect(candidate?.blocking).toBe(false);
    expect(candidate?.current).not.toBe(candidate?.proposal);
    expect(candidate?.current).toEqual(candidate?.proposal);
    expect(candidate?.current.evidence).not.toBe(candidate?.proposal.evidence);
  });
});
