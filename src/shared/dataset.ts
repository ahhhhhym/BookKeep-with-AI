/** Dataset DTOs are separate from the strict online Proposal contract. No file paths or secrets. */
import { MISSING_FIELDS, parseCandidateOutput, type MissingField, type Proposal } from './candidate';
import { CANDIDATE_SCHEMA_VERSION } from './constants';
import { isPlainRecord, isUuidV4 } from './validation';
export const DATASET_SCHEMA = 'bk-dataset.v1';
export const DATASET_NOTICE = 'dataset-notice.v1';
export const FIELDS = MISSING_FIELDS;
export type Split = 'train' | 'dev' | 'test';
export type Purpose = 'evaluation' | 'future_training';
export type FieldFact = {
    status: 'known' | 'unknown' | 'assisted';
    reason: string;
    basisRef: string | null;
};
export type HumanProposal = Omit<Proposal, 'evidence'> & {
    evidence: (Omit<Proposal['evidence'][number], 'source'> & {
        source: 'human';
    })[];
};
export interface Label {
    labelId: string;
    ordinal: number;
    transactionId: string;
    value: HumanProposal;
    facts: Record<MissingField, FieldFact>;
}
export interface Rights {
    sourceType: 'payment_detail' | 'order_list' | 'product_photo' | 'other';
    sourceAlias: string;
    collectedOn: string;
    registrar: string;
    licenseStatus: 'allowed';
    licenseAlias: string;
    licenseVersion: string;
    purposes: Purpose[];
    recipients: string[];
    allowImages: boolean;
    retainUntil: string;
    reviewAt: string;
    redactionStatus: 'approved';
    redactionMethod: string;
    redactionReviewer: string;
}
export interface DatasetConsent {
    id: string;
    imageAssetId: string;
    preparedHash: string;
    purpose: 'dataset' | 'recognition';
    decision: 'grant' | 'withdraw';
    scopeHash: string;
    noticeVersion: string;
    epoch: string;
    supersedesId: string | null;
    createdAt: string;
    rights: Rights | null;
    runManifestHash: string | null;
}
export interface Sample {
    id: string;
    version: number;
    kind: 'real' | 'synthetic';
    imageAssetId: string;
    preparedHash: string;
    originalHash: string;
    byteSize: number;
    consentId: string;
    rights: Rights;
    relations: string[];
    primaryScene: string;
    secondaryScenes: string[];
    labels: Label[] | null;
    annotator: string | null;
    reviewer: string | null;
    reviewMode: 'different_person' | 'same_person' | null;
    reviewedAt: string | null;
    reviewStatus: 'unlabelled' | 'labelled' | 'reviewed';
    predictionJobId: string | null;
    predictionAvailable: boolean;
    prediction: Proposal[];
    predictionMetadata: Record<string, unknown> | null;
    previousVersion: number | null;
    reason: string;
    createdAt: string;
}
export interface DatasetVersion {
    id: string;
    tag: string;
    manifestHash: string;
    seed: number;
    algorithm: 'group-sse.v1';
    samples: Sample[];
    groups: Record<string, string>;
    splits: Record<string, Split>;
    categorySnapshot: {
        id: string;
        name: string;
    }[];
    categorySnapshotHash: string;
    synonyms: Record<string, string[]>;
    synonymVersion: string;
    testLocked: boolean;
    contaminated: boolean;
    exploratory: boolean;
    status: 'active' | 'withdrawn' | 'invalid';
    epoch: string;
    specVersions: {
        dataset: 'dataset-spec.v1';
        evaluation: 'evaluation-spec.v1';
        schema: typeof DATASET_SCHEMA;
        label: 'label-policy.v1';
    };
    createdAt: string;
}
export interface Alignment {
    sampleId: string;
    predictionOrdinal: number;
    labelId: string;
    reason: string;
}
export interface Pair {
    id: string;
    leftSample: string;
    leftLabel: string;
    rightSample: string;
    rightLabel: string;
    positive: boolean;
    hardNegative: boolean;
}
export interface Metric {
    key: string;
    numerator: number;
    denominator: number;
    value: number | null;
    kind: string;
    scene: string;
    split: string;
    wilson95: [
        number,
        number
    ] | null;
}
export interface EvaluationResult {
    sampleId: string;
    status: 'completed' | 'failed' | 'cancelled' | 'unprocessed';
    predictions: Proposal[];
    errorCode: string | null;
    durationMs: number;
    actualModel: string | null;
    usage: {
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
    } | null;
    attempts: number;
}
export interface Run {
    id: string;
    datasetVersionId: string;
    manifestHash: string;
    epoch: string;
    revision: number;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    scope: 'framework' | 'quality';
    provider: 'mock' | 'deepseek';
    split: Split;
    intent: 'development' | 'final';
    seed: number;
    promptVersion: string;
    promptHash: string;
    runnerVersion: string;
    runnerHash: string;
    appCommit: string;
    adapterVersion: string;
    requestedModel: string;
    startedAt: string | null;
    finishedAt: string | null;
    results: EvaluationResult[];
    alignment: Alignment[] | null;
    alignmentHash: string | null;
    alignmentReviewer: string | null;
    pairPool: Pair[];
    duplicatePredictions: string[];
    report: Record<string, unknown> | null;
    invalidReason: string | null;
    acceptedAt?: string;
    duplicateOutput?: {
        leftSample: string;
        leftOrdinal: number;
        rightSample: string;
        rightOrdinal: number;
    }[];
}
export type DatasetCommand = {
    op: 'consent';
    imageAssetId: string;
    preparedHash: string;
    purpose: 'dataset' | 'recognition';
    decision: 'grant' | 'withdraw';
    supersedesId: string | null;
    noticeVersion: typeof DATASET_NOTICE;
    rights: Rights | null;
    runManifestHash: string | null;
} | {
    op: 'register';
    imageAssetId: string;
    preparedHash: string;
    kind: 'real' | 'synthetic';
    consentId: string;
    predictionJobId: string | null;
    primaryScene: string;
    secondaryScenes: string[];
    relations: string[];
} | {
    op: 'label';
    id: string;
    expectedVersion: number;
    labels: Label[];
    annotator: string;
    reviewer: string | null;
    reviewMode: 'different_person' | 'same_person' | null;
    reason: string;
    correctionOfLockedTest: boolean;
} | {
    op: 'link';
    ids: string[];
    relation: string;
    reason: string;
} | {
    op: 'version';
    tag: string;
    sampleIds: string[];
    seed: number;
    synonyms: Record<string, string[]>;
    synonymVersion: string;
} | {
    op: 'export';
    versionId: string;
    sampleIds: string[] | null;
    includeImages: boolean;
    purpose: Purpose;
    recipient: string;
    confirmed: true;
} | {
    op: 'validate';
    versionId: string;
} | {
    op: 'validatePrepared';
    versionId: string;
    artifactId: string;
    manifestHash: string;
    schemaVersion: typeof DATASET_SCHEMA;
} | {
    op: 'reauthorize';
    sampleId: string;
    expectedVersion: number;
    consentId: string;
} | {
    op: 'prepare';
    versionId: string;
    exportId: string;
    adapterVersion: 'future-training.v1';
} | {
    op: 'submit' | 'trainingStatus';
    versionId: string;
} | {
    op: 'evaluate';
    versionId: string;
    scope: 'framework' | 'quality';
    provider: 'mock' | 'deepseek';
    split: Split;
    intent: 'development' | 'final';
    seed: number;
    promptVersion: string;
    possibleChargeAccepted: boolean;
    fixture: string | null;
} | {
    op: 'align';
    runId: string;
    alignment: Alignment[];
    reviewer: string;
    blindConfirmed: true;
    duplicatePredictions: string[];
} | {
    op: 'cancel';
    runId: string;
} | {
    op: 'contaminate';
    versionId: string;
    reason: string;
} | {
    op: 'withdraw';
    sampleId: string;
    reason: string;
};
export interface DatasetRead {
    kind: 'summary' | 'sample' | 'version' | 'run' | 'blinded';
    id: string | null;
}
export interface DatasetSummary {
    samples: {
        id: string;
        version: number;
        kind: string;
        primaryScene: string;
        reviewStatus: string;
        preparedHash: string;
        consentId: string;
    }[];
    versions: {
        id: string;
        tag: string;
        manifestHash: string;
        status: string;
        exploratory: boolean;
        contaminated: boolean;
    }[];
    runs: {
        id: string;
        status: string;
        scope: string;
        provider: string;
        report: Record<string, unknown> | null;
    }[];
    consents: DatasetConsent[];
    withdrawals: Record<string, unknown>[];
    exports: {
        id: string;
        versionId: string;
        status: string;
        recipient: string;
        manifestHash: string;
    }[];
    revision: number;
    trainingSubmitSupported: false;
    trained: false;
}
const id = isUuidV4;
const text = (v: unknown, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const list = (v: unknown, check: (x: unknown) => boolean, max = 1000): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(check);
const exact = (v: unknown, ks: string[]): v is Record<string, unknown> => isPlainRecord(v) && Object.keys(v).length === ks.length && ks.every(k => Object.hasOwn(v, k));
export function validRights(v: unknown): v is Rights {
    return exact(v, ['sourceType', 'sourceAlias', 'collectedOn', 'registrar', 'licenseStatus', 'licenseAlias', 'licenseVersion', 'purposes', 'recipients', 'allowImages', 'retainUntil', 'reviewAt', 'redactionStatus', 'redactionMethod', 'redactionReviewer']) &&
        ['payment_detail', 'order_list', 'product_photo', 'other'].includes(String(v.sourceType)) &&
        ['sourceAlias', 'collectedOn', 'registrar', 'licenseAlias', 'licenseVersion', 'redactionMethod', 'redactionReviewer'].every(k => text(v[k])) &&
        v.licenseStatus === 'allowed' && v.redactionStatus === 'approved' && typeof v.allowImages === 'boolean' &&
        list(v.purposes, x => x === 'evaluation' || x === 'future_training', 2) && v.purposes.length > 0 && new Set(v.purposes).size === v.purposes.length &&
        list(v.recipients, x => text(x), 20) && v.recipients.length > 0 &&
        typeof v.retainUntil === 'string' && Number.isFinite(Date.parse(v.retainUntil)) && typeof v.reviewAt === 'string' && Number.isFinite(Date.parse(v.reviewAt));
}
export function validateLabels(input: unknown, categoryIds: readonly string[]): Label[] {
    if (!Array.isArray(input) || input.length > 100)
        throw new Error('LABEL_SCHEMA');
    const seen = new Set<string>();
    const transactions = new Set<string>();
    for (const raw of input) {
        if (!exact(raw, ['labelId', 'ordinal', 'transactionId', 'value', 'facts']) || !text(raw.labelId, 64) || !text(raw.transactionId, 64) ||
            !Number.isSafeInteger(raw.ordinal) || raw.ordinal !== input.indexOf(raw) || seen.has(String(raw.labelId)) || transactions.has(String(raw.transactionId)))
            throw new Error('DUPLICATE_OR_BAD_LABEL');
        seen.add(String(raw.labelId));
        transactions.add(String(raw.transactionId));
        const value = raw.value;
        if (!isPlainRecord(value) || !Array.isArray(value.evidence) || value.evidence.some(e => !isPlainRecord(e) || e.source !== 'human'))
            throw new Error('HUMAN_EVIDENCE_REQUIRED');
        const parsed = parseCandidateOutput({ schemaVersion: CANDIDATE_SCHEMA_VERSION, candidates: [{ ...value, evidence: value.evidence.map(e => ({ ...e, source: 'image' })) }], warnings: [] }).candidates[0];
        if (parsed.amountFen !== null && (!Number.isSafeInteger(parsed.amountFen) || parsed.amountFen < 1 || parsed.amountFen > 999999999))
            throw new Error('INVALID_LABEL_AMOUNT');
        if (parsed.categoryId !== null && !categoryIds.includes(parsed.categoryId))
            throw new Error('INVALID_LABEL_CATEGORY');
        if (!exact(raw.facts, [...FIELDS]))
            throw new Error('FIELD_FACTS_REQUIRED');
        for (const field of FIELDS) {
            const fact = raw.facts[field];
            if (!exact(fact, ['status', 'reason', 'basisRef']) || !['known', 'unknown', 'assisted'].includes(String(fact.status)) || !text(fact.reason, 500) ||
                !(fact.basisRef === null || text(fact.basisRef, 100)) || (fact.status === 'unknown') !== (parsed[field] === null) ||
                (fact.status === 'assisted' && fact.basisRef === null))
                throw new Error('UNKNOWN_FACT_INCONSISTENT');
            if (fact.status !== 'unknown' && !parsed.evidence.some(e => e.field === field))
                throw new Error('LABEL_EVIDENCE_MISSING');
        }
        if (parsed.missingFields.slice().sort().join() !== FIELDS.filter(f => parsed[f] === null).slice().sort().join())
            throw new Error('LABEL_MISSING_MISMATCH');
        if (parsed.transactionKind !== null && parsed.transactionKind !== 'expense' && !parsed.warnings.some(w => w.code === 'NON_EXPENSE'))
            throw new Error('NON_EXPENSE_WARNING_REQUIRED');
    }
    const labels = input as Label[];
    for (const label of labels)
        if (label.value.groupKey && label.value.transactionKind === 'expense' && label.value.amountBasis === 'paid_total' &&
            labels.some(other => other !== label && other.value.transactionKind === 'expense' && other.value.groupKey === label.value.groupKey))
            throw new Error('TOTAL_DETAIL_CONFLICT');
    return structuredClone(labels);
}
export function validDatasetCommand(v: unknown): v is DatasetCommand {
    if (!isPlainRecord(v))
        return false;
    const shape: Record<string, string[]> = {
        consent: ['imageAssetId', 'preparedHash', 'purpose', 'decision', 'supersedesId', 'noticeVersion', 'rights', 'runManifestHash'],
        register: ['imageAssetId', 'preparedHash', 'kind', 'consentId', 'predictionJobId', 'primaryScene', 'secondaryScenes', 'relations'],
        label: ['id', 'expectedVersion', 'labels', 'annotator', 'reviewer', 'reviewMode', 'reason', 'correctionOfLockedTest'],
        link: ['ids', 'relation', 'reason'], version: ['tag', 'sampleIds', 'seed', 'synonyms', 'synonymVersion'],
        export: ['versionId', 'sampleIds', 'includeImages', 'purpose', 'recipient', 'confirmed'], validate: ['versionId'],
        prepare: ['versionId', 'exportId', 'adapterVersion'], validatePrepared: ['versionId', 'artifactId', 'manifestHash', 'schemaVersion'], reauthorize: ['sampleId', 'expectedVersion', 'consentId'], submit: ['versionId'], trainingStatus: ['versionId'],
        evaluate: ['versionId', 'scope', 'provider', 'split', 'intent', 'seed', 'promptVersion', 'possibleChargeAccepted', 'fixture'],
        align: ['runId', 'alignment', 'reviewer', 'blindConfirmed', 'duplicatePredictions'], cancel: ['runId'], contaminate: ['versionId', 'reason'], withdraw: ['sampleId', 'reason'],
    };
    if (typeof v.op !== 'string' || !Object.hasOwn(shape, v.op) || !exact(v, ['op', ...shape[v.op]]))
        return false;
    for (const k of ['imageAssetId', 'consentId', 'id', 'versionId', 'runId', 'sampleId', 'exportId'])
        if (k in v && !id(v[k]))
            return false;
    for (const k of ['preparedHash'])
        if (k in v && !hash(v[k]))
            return false;
    for (const k of ['seed', 'expectedVersion'])
        if (k in v && (!Number.isSafeInteger(v[k]) || Number(v[k]) < (k === 'seed' ? 0 : 1) || Number(v[k]) > 2147483647))
            return false;
    for (const k of ['reason', 'tag', 'annotator', 'recipient', 'relation', 'synonymVersion', 'promptVersion'])
        if (k in v && !text(v[k], 500))
            return false;
    for (const k of ['ids', 'sampleIds'])
        if (k in v && !(k === 'sampleIds' && v.op === 'export' && v[k] === null) && (!list(v[k], id) || (v[k] as unknown[]).length === 0 || new Set(v[k] as unknown[]).size !== (v[k] as unknown[]).length))
            return false;
    switch (v.op) {
        case 'consent': return ['dataset', 'recognition'].includes(String(v.purpose)) && ['grant', 'withdraw'].includes(String(v.decision)) && (v.supersedesId === null || id(v.supersedesId)) && v.noticeVersion === DATASET_NOTICE && (v.rights === null || validRights(v.rights)) && (v.runManifestHash === null || hash(v.runManifestHash));
        case 'register': return ['real', 'synthetic'].includes(String(v.kind)) && (v.predictionJobId === null || id(v.predictionJobId)) && text(v.primaryScene) && list(v.secondaryScenes, x => text(x), 20) && list(v.relations, x => text(x, 64), 100);
        case 'label': return Array.isArray(v.labels) && v.labels.length <= 100 && (v.reviewer === null || text(v.reviewer)) && [null, 'same_person', 'different_person'].includes(v.reviewMode as null) && typeof v.correctionOfLockedTest === 'boolean';
        case 'version': return isPlainRecord(v.synonyms) && Object.keys(v.synonyms).length <= 500 && Object.entries(v.synonyms).every(([k, a]) => text(k) && list(a, x => text(x), 30));
        case 'export': return typeof v.includeImages === 'boolean' && ['evaluation', 'future_training'].includes(String(v.purpose)) && v.confirmed === true;
        case 'evaluate': return ['framework', 'quality'].includes(String(v.scope)) && ['mock', 'deepseek'].includes(String(v.provider)) && ['train', 'dev', 'test'].includes(String(v.split)) && ['development', 'final'].includes(String(v.intent)) && typeof v.possibleChargeAccepted === 'boolean' && (v.fixture === null || v.fixture === 's13-hand-calculated.v1');
        case 'align': return list(v.alignment, a => exact(a, ['sampleId', 'predictionOrdinal', 'labelId', 'reason']) && id(a.sampleId) && Number.isSafeInteger(a.predictionOrdinal) && Number(a.predictionOrdinal) >= 0 && text(a.labelId, 64) && text(a.reason, 500), 100000) && text(v.reviewer) && v.blindConfirmed === true && list(v.duplicatePredictions, x => text(x, 128), 100000);
        case 'prepare': return v.adapterVersion === 'future-training.v1';
        case 'validatePrepared': return hash(v.artifactId) && hash(v.manifestHash) && v.schemaVersion === DATASET_SCHEMA;
        default: return true;
    }
}
export function validDatasetRead(v: unknown): v is DatasetRead { return exact(v, ['kind', 'id']) && ['summary', 'sample', 'version', 'run', 'blinded'].includes(String(v.kind)) && (v.kind === 'summary' ? v.id === null : id(v.id)); }
