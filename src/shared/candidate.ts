/**
 * bk-candidate.v1 结构化候选：运行时校验与最小规范化（docs/CONTRACTS.md §7.2）。
 *
 * S04 只实现结构校验、缺失字段派生和阻断等级派生；重复匹配、合计/明细组规则、
 * 审核状态机与入账由 S10/S11 在契约之上实现。这里绝不写正式账本。
 */

import { CANDIDATE_SCHEMA_VERSION } from './constants.js';
import { isBoundedString, isPlainRecord, isSafeIntegerInRange, type PlainRecord } from './validation.js';

export const TRANSACTION_KINDS = ['expense', 'refund', 'transfer', 'income', 'failed', 'closed'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const AMOUNT_BASES = ['paid_total', 'line_payment'] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];

export const TIME_PRECISIONS = ['unknown', 'date', 'minute'] as const;
export type TimePrecision = (typeof TIME_PRECISIONS)[number];

/** 模型允许自报的 warning code；主进程可追加派生 code（如 MODEL_MISSING_MISMATCH）。 */
export const MODEL_WARNING_CODES = [
  'AMOUNT_AMBIGUOUS',
  'DATE_UNCERTAIN',
  'NAME_UNKNOWN',
  'CATEGORY_UNKNOWN',
  'NON_EXPENSE',
  'TOTAL_DETAIL_AMBIGUOUS',
  'BLURRY',
  'INSTRUCTION_IN_IMAGE',
  'OTHER',
] as const;

export const DERIVED_WARNING_CODES = ['MODEL_MISSING_MISMATCH', 'EVIDENCE_MISSING'] as const;

export const MISSING_FIELDS = ['amountFen', 'occurredDate', 'name', 'categoryId'] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];

export const EVIDENCE_FIELDS = [
  'amountFen',
  'occurredDate',
  'occurredTime',
  'name',
  'merchant',
  'categoryId',
  'transactionKind',
  'amountBasis',
  'lineItems',
] as const;

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Evidence {
  field: string;
  text: string | null;
  region: Region | null;
  source: 'image';
}

export interface LineItem {
  name: string | null;
  amountFen: number | null;
  evidenceIndexes: number[];
}

export interface ProposalWarning {
  code: string;
  message: string;
  field: string | null;
}

export interface Proposal {
  amountFen: number | null;
  occurredDate: string | null;
  occurredTime: string | null;
  timePrecision: TimePrecision;
  name: string | null;
  merchant: string | null;
  categoryId: string | null;
  transactionKind: TransactionKind | null;
  amountBasis: AmountBasis | null;
  groupKey: string | null;
  lineItems: LineItem[];
  evidence: Evidence[];
  missingFields: MissingField[];
  warnings: ProposalWarning[];
  confidence: number | null;
}

export interface CandidateOutput {
  schemaVersion: typeof CANDIDATE_SCHEMA_VERSION;
  candidates: Proposal[];
  warnings: ProposalWarning[];
}

export interface NormalizedCandidate {
  ordinal: number;
  proposal: Proposal;
  current: Proposal;
  missingFields: MissingField[];
  warnings: ProposalWarning[];
  blocking: boolean;
}

export interface NormalizedOutput {
  schemaVersion: typeof CANDIDATE_SCHEMA_VERSION;
  candidates: NormalizedCandidate[];
  warnings: ProposalWarning[];
}

export class CandidateSchemaError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super('OUTPUT_SCHEMA_INVALID');
    this.name = 'CandidateSchemaError';
    this.issues = issues;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GROUP_KEY_PATTERN = /^[\x21-\x7e]{1,64}$/;

const PROPOSAL_KEYS = [
  'amountFen',
  'occurredDate',
  'occurredTime',
  'timePrecision',
  'name',
  'merchant',
  'categoryId',
  'transactionKind',
  'amountBasis',
  'groupKey',
  'lineItems',
  'evidence',
  'missingFields',
  'warnings',
  'confidence',
] as const;

const EVIDENCE_KEYS = ['field', 'text', 'region', 'source'] as const;
const REGION_KEYS = ['x', 'y', 'width', 'height'] as const;
const LINE_ITEM_KEYS = ['name', 'amountFen', 'evidenceIndexes'] as const;
const WARNING_KEYS = ['code', 'message', 'field'] as const;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1900 || year > 9998) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function collectUnknownKeys(source: PlainRecord, allowed: readonly string[], path: string, issues: string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key}:UNKNOWN_KEY`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) issues.push(`${path}.${key}:MISSING_KEY`);
  }
}

function parseNullableText(value: unknown, path: string, maxLength: number, issues: string[]): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    issues.push(`${path}:EXPECTED_STRING_OR_NULL`);
    return null;
  }
  if (!isBoundedString(value, 1, maxLength)) {
    issues.push(`${path}:TEXT_LENGTH`);
    return null;
  }
  return value;
}

function parseRegion(value: unknown, path: string, issues: string[]): Region | null {
  if (value === null) return null;
  if (!isPlainRecord(value)) {
    issues.push(`${path}:EXPECTED_OBJECT_OR_NULL`);
    return null;
  }
  collectUnknownKeys(value, REGION_KEYS, path, issues);
  const parts = REGION_KEYS.map((key) => value[key]);
  if (!parts.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    issues.push(`${path}:REGION_NUMBER`);
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    issues.push(`${path}:REGION_RANGE`);
    return null;
  }
  return { x, y, width, height };
}

function parseEvidence(value: unknown, path: string, issues: string[]): Evidence | null {
  if (!isPlainRecord(value)) {
    issues.push(`${path}:EXPECTED_OBJECT`);
    return null;
  }
  collectUnknownKeys(value, EVIDENCE_KEYS, path, issues);
  const field = value.field;
  if (typeof field !== 'string' || !(EVIDENCE_FIELDS as readonly string[]).includes(field)) {
    issues.push(`${path}.field:UNKNOWN_FIELD`);
  }
  const text = parseNullableText(value.text, `${path}.text`, 500, issues);
  const region = parseRegion(value.region, `${path}.region`, issues);
  if (text === null && region === null) issues.push(`${path}:EVIDENCE_EMPTY`);
  if (value.source !== 'image') issues.push(`${path}.source:EXPECTED_IMAGE`);
  return { field: String(field), text, region, source: 'image' };
}

function parseLineItem(value: unknown, path: string, issues: string[]): LineItem | null {
  if (!isPlainRecord(value)) {
    issues.push(`${path}:EXPECTED_OBJECT`);
    return null;
  }
  collectUnknownKeys(value, LINE_ITEM_KEYS, path, issues);
  const name = parseNullableText(value.name, `${path}.name`, 100, issues);
  const amountFen =
    value.amountFen === null
      ? null
      : isSafeIntegerInRange(value.amountFen, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
        ? value.amountFen
        : null;
  if (value.amountFen !== null && amountFen === null) issues.push(`${path}.amountFen:EXPECTED_SAFE_INTEGER_OR_NULL`);
  const indexes = value.evidenceIndexes;
  if (!Array.isArray(indexes) || !indexes.every((entry) => Number.isSafeInteger(entry) && (entry as number) >= 0)) {
    issues.push(`${path}.evidenceIndexes:EXPECTED_INDEX_ARRAY`);
    return null;
  }
  return { name, amountFen, evidenceIndexes: [...(indexes as number[])] };
}

function parseWarning(value: unknown, path: string, mode: 'model' | 'derived', issues: string[]): ProposalWarning | null {
  if (!isPlainRecord(value)) {
    issues.push(`${path}:EXPECTED_OBJECT`);
    return null;
  }
  collectUnknownKeys(value, WARNING_KEYS, path, issues);
  const allowed = mode === 'model' ? (MODEL_WARNING_CODES as readonly string[]) : ([...MODEL_WARNING_CODES, ...DERIVED_WARNING_CODES] as string[]);
  if (typeof value.code !== 'string' || !allowed.includes(value.code)) {
    issues.push(`${path}.code:UNKNOWN_CODE`);
    return null;
  }
  const message = typeof value.message === 'string' && isBoundedString(value.message, 1, 500) ? value.message : null;
  if (message === null) issues.push(`${path}.message:TEXT_LENGTH`);
  const field = value.field;
  if (field !== null && (typeof field !== 'string' || !(EVIDENCE_FIELDS as readonly string[]).includes(field))) {
    issues.push(`${path}.field:UNKNOWN_FIELD`);
  }
  return { code: value.code, message: message ?? '', field: typeof field === 'string' ? field : null };
}

function parseProposal(value: unknown, path: string, issues: string[]): Proposal | null {
  if (!isPlainRecord(value)) {
    issues.push(`${path}:EXPECTED_OBJECT`);
    return null;
  }
  collectUnknownKeys(value, PROPOSAL_KEYS, path, issues);

  const amountFen =
    value.amountFen === null
      ? null
      : isSafeIntegerInRange(value.amountFen, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
        ? value.amountFen
        : null;
  if (value.amountFen !== null && amountFen === null) issues.push(`${path}.amountFen:EXPECTED_SAFE_INTEGER_OR_NULL`);

  const occurredDate =
    value.occurredDate === null
      ? null
      : typeof value.occurredDate === 'string' && isCalendarDate(value.occurredDate)
        ? value.occurredDate
        : null;
  if (value.occurredDate !== null && occurredDate === null) issues.push(`${path}.occurredDate:INVALID_DATE`);

  const occurredTime =
    value.occurredTime === null
      ? null
      : typeof value.occurredTime === 'string' && TIME_PATTERN.test(value.occurredTime)
        ? value.occurredTime
        : null;
  if (value.occurredTime !== null && occurredTime === null) issues.push(`${path}.occurredTime:INVALID_TIME`);

  const timePrecision = value.timePrecision;
  if (typeof timePrecision !== 'string' || !(TIME_PRECISIONS as readonly string[]).includes(timePrecision)) {
    issues.push(`${path}.timePrecision:UNKNOWN_PRECISION`);
    return null;
  }
  if (timePrecision === 'unknown' && (occurredDate !== null || occurredTime !== null)) {
    issues.push(`${path}.timePrecision:UNKNOWN_WITH_VALUES`);
  }
  if (timePrecision === 'date' && (occurredDate === null || occurredTime !== null)) {
    issues.push(`${path}.timePrecision:DATE_INCONSISTENT`);
  }
  if (timePrecision === 'minute' && (occurredDate === null || occurredTime === null)) {
    issues.push(`${path}.timePrecision:MINUTE_INCONSISTENT`);
  }

  const name = parseNullableText(value.name, `${path}.name`, 100, issues);
  const merchant = parseNullableText(value.merchant, `${path}.merchant`, 100, issues);
  const categoryId = parseNullableText(value.categoryId, `${path}.categoryId`, 64, issues);

  const transactionKind =
    value.transactionKind === null
      ? null
      : typeof value.transactionKind === 'string' && (TRANSACTION_KINDS as readonly string[]).includes(value.transactionKind)
        ? (value.transactionKind as TransactionKind)
        : undefined;
  if (transactionKind === undefined) issues.push(`${path}.transactionKind:UNKNOWN_KIND`);

  const amountBasis =
    value.amountBasis === null
      ? null
      : typeof value.amountBasis === 'string' && (AMOUNT_BASES as readonly string[]).includes(value.amountBasis)
        ? (value.amountBasis as AmountBasis)
        : undefined;
  if (amountBasis === undefined) issues.push(`${path}.amountBasis:UNKNOWN_BASIS`);

  const groupKey =
    value.groupKey === null
      ? null
      : typeof value.groupKey === 'string' && GROUP_KEY_PATTERN.test(value.groupKey)
        ? value.groupKey
        : undefined;
  if (groupKey === undefined) issues.push(`${path}.groupKey:INVALID_GROUP_KEY`);

  const lineItems: LineItem[] = [];
  if (!Array.isArray(value.lineItems) || value.lineItems.length > 100) {
    issues.push(`${path}.lineItems:EXPECTED_ARRAY_MAX_100`);
  } else {
    value.lineItems.forEach((item, index) => {
      const parsed = parseLineItem(item, `${path}.lineItems[${index}]`, issues);
      if (parsed) lineItems.push(parsed);
    });
  }

  const evidence: Evidence[] = [];
  if (!Array.isArray(value.evidence) || value.evidence.length > 50) {
    issues.push(`${path}.evidence:EXPECTED_ARRAY_MAX_50`);
  } else {
    value.evidence.forEach((item, index) => {
      const parsed = parseEvidence(item, `${path}.evidence[${index}]`, issues);
      if (parsed) evidence.push(parsed);
    });
  }

  const missingFields: MissingField[] = [];
  if (!Array.isArray(value.missingFields)) {
    issues.push(`${path}.missingFields:EXPECTED_ARRAY`);
  } else {
    for (const entry of value.missingFields) {
      if (typeof entry !== 'string' || !(MISSING_FIELDS as readonly string[]).includes(entry)) {
        issues.push(`${path}.missingFields:UNKNOWN_FIELD`);
      } else if (!missingFields.includes(entry as MissingField)) {
        missingFields.push(entry as MissingField);
      }
    }
  }

  const warnings: ProposalWarning[] = [];
  if (!Array.isArray(value.warnings) || value.warnings.length > 20) {
    issues.push(`${path}.warnings:EXPECTED_ARRAY_MAX_20`);
  } else {
    value.warnings.forEach((item, index) => {
      const parsed = parseWarning(item, `${path}.warnings[${index}]`, 'model', issues);
      if (parsed) warnings.push(parsed);
    });
  }

  const confidence =
    value.confidence === null
      ? null
      : typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
        ? value.confidence
        : undefined;
  if (confidence === undefined) issues.push(`${path}.confidence:INVALID_CONFIDENCE`);

  if (issues.length > 0) return null;

  return {
    amountFen,
    occurredDate,
    occurredTime,
    timePrecision: timePrecision as TimePrecision,
    name,
    merchant,
    categoryId,
    transactionKind: transactionKind ?? null,
    amountBasis: amountBasis ?? null,
    groupKey: groupKey ?? null,
    lineItems,
    evidence,
    missingFields,
    warnings,
    confidence: confidence ?? null,
  };
}

/** 校验 provider 输出根结构；任何结构问题整图失败，不做“抢救式”解析。 */
export function parseCandidateOutput(raw: unknown): CandidateOutput {
  const issues: string[] = [];
  if (!isPlainRecord(raw)) throw new CandidateSchemaError(['root:EXPECTED_OBJECT']);
  collectUnknownKeys(raw, ['schemaVersion', 'candidates', 'warnings'], 'root', issues);
  if (raw.schemaVersion !== CANDIDATE_SCHEMA_VERSION) issues.push('root.schemaVersion:UNSUPPORTED_SCHEMA');

  const candidates: Proposal[] = [];
  if (!Array.isArray(raw.candidates) || raw.candidates.length > 100) {
    issues.push('root.candidates:EXPECTED_ARRAY_MAX_100');
  } else {
    raw.candidates.forEach((candidate, index) => {
      const parsed = parseProposal(candidate, `root.candidates[${index}]`, issues);
      if (parsed) candidates.push(parsed);
    });
  }

  const warnings: ProposalWarning[] = [];
  if (!Array.isArray(raw.warnings) || raw.warnings.length > 20) {
    issues.push('root.warnings:EXPECTED_ARRAY_MAX_20');
  } else {
    raw.warnings.forEach((warning, index) => {
      const parsed = parseWarning(warning, `root.warnings[${index}]`, 'model', issues);
      if (parsed) warnings.push(parsed);
    });
  }

  if (issues.length > 0) throw new CandidateSchemaError(issues);
  return { schemaVersion: CANDIDATE_SCHEMA_VERSION, candidates, warnings };
}

const BLOCKING_WARNING_CODES: ReadonlySet<string> = new Set(['NON_EXPENSE', 'TOTAL_DETAIL_AMBIGUOUS', 'EVIDENCE_MISSING']);

function deriveMissingFields(proposal: Proposal): MissingField[] {
  const derived: MissingField[] = [];
  if (proposal.amountFen === null) derived.push('amountFen');
  if (proposal.occurredDate === null) derived.push('occurredDate');
  if (proposal.name === null) derived.push('name');
  if (proposal.categoryId === null) derived.push('categoryId');
  return derived;
}

function evidenceCovers(proposal: Proposal, field: string): boolean {
  return proposal.evidence.some((item) => item.field === field);
}

/**
 * 规范化：proposal 不可变，current 为可编辑副本；缺失字段与阻断由主进程派生。
 * 不信任模型自报的 severity/resolved，也不做任何入账动作。
 */
export function normalizeCandidateOutput(output: CandidateOutput): NormalizedOutput {
  const candidates = output.candidates.map((proposal, ordinal) => {
    const missingFields = deriveMissingFields(proposal);
    const warnings: ProposalWarning[] = proposal.warnings.map((warning) => ({ ...warning }));

    const modelMissing = [...proposal.missingFields].sort();
    if (modelMissing.join(',') !== [...missingFields].sort().join(',')) {
      warnings.push({
        code: 'MODEL_MISSING_MISMATCH',
        message: '模型自报缺失字段与实际值不一致，已按实际值重新计算。',
        field: null,
      });
    }

    for (const field of ['amountFen', 'occurredDate', 'name', 'categoryId'] as const) {
      if (proposal[field] !== null && !evidenceCovers(proposal, field)) {
        warnings.push({ code: 'EVIDENCE_MISSING', message: `字段 ${field} 缺少来源证据。`, field });
      }
    }

    const blocking =
      missingFields.length > 0 ||
      warnings.some((warning) => BLOCKING_WARNING_CODES.has(warning.code)) ||
      proposal.transactionKind !== 'expense';

    return {
      ordinal,
      proposal,
      current: structuredCloneProposal(proposal),
      missingFields,
      warnings,
      blocking,
    };
  });

  return {
    schemaVersion: output.schemaVersion,
    candidates,
    warnings: output.warnings.map((warning) => ({ ...warning })),
  };
}

function structuredCloneProposal(proposal: Proposal): Proposal {
  return {
    ...proposal,
    lineItems: proposal.lineItems.map((item) => ({ ...item, evidenceIndexes: [...item.evidenceIndexes] })),
    evidence: proposal.evidence.map((item) => ({ ...item, region: item.region ? { ...item.region } : null })),
    missingFields: [...proposal.missingFields],
    warnings: proposal.warnings.map((warning) => ({ ...warning })),
  };
}

/** 业务范围校验（结构校验之后）：单笔金额 1～999,999,999 分，0 与负数规范化 null。 */
export function businessRangeWarnings(proposal: Proposal): ProposalWarning[] {
  const warnings: ProposalWarning[] = [];
  if (proposal.amountFen !== null && (proposal.amountFen <= 0 || proposal.amountFen > 999_999_999)) {
    warnings.push({ code: 'AMOUNT_AMBIGUOUS', message: '金额超出本地可接受范围，已按未知处理。', field: 'amountFen' });
  }
  if (proposal.categoryId !== null && proposal.categoryId.length > 64) {
    warnings.push({ code: 'CATEGORY_UNKNOWN', message: '分类标识不可识别。', field: 'categoryId' });
  }
  return warnings;
}
