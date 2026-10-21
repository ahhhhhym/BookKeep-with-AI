import type { NormalizedCandidate, ProposalWarning } from './candidate';
import type { ErrorCode } from './errors';
export const IMPORT_PROMPT = 'bk-receipt.s10.v1';
export const NOTICE_VERSION = 'recognition.v1';
export const IMAGE_LIMIT = 10 * 1024 * 1024;
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface Asset {
    id: string;
    version: number;
    originalHash: string;
    preparedHash: string | null;
    width: number;
    height: number;
    byteSize: number;
    originalRetained: boolean;
    parentAssetId: string | null;
    source: 'selection' | 'drop' | 'prepared';
    createdAt: string;
}
export interface Selection {
    tokens: string[];
}
export interface ImportInput {
    selectionTokens: string[];
    retention: 'keep_original' | 'prepared_only';
}
export interface ImportResult {
    batchId: string;
    results: {
        asset: Asset | null;
        errorCode: ErrorCode | null;
        reused: boolean;
    }[];
}
export interface PrepareInput {
    imageAssetId: string;
    expectedVersion: number;
    crop: Rect | null;
    masks: Rect[];
    retainOriginal: boolean;
}
export interface ResourceInput {
    imageAssetId: string;
    variant: 'original' | 'prepared';
}
export interface Resource {
    url: string;
    expiresAt: number;
    asset: Asset;
}
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export interface Job {
    id: string;
    version: number;
    imageAssetId: string;
    preparedHash: string;
    status: JobStatus;
    generation: number;
    attempt: number;
    totalAttempts: number;
    provider: 'deepseek' | 'mock';
    model: string;
    actualModel: string | null;
    promptVersion: string;
    schemaVersion: string;
    errorCode: ErrorCode | null;
    startedAt: string | null;
    finishedAt: string | null;
    nextAttemptAt: string | null;
    candidateCount: number;
    createdAt: string;
    needsConsent: boolean;
    warnings: ProposalWarning[];
}
export interface StartInput {
    images: {
        imageAssetId: string;
        preparedHash: string;
    }[];
    provider: 'deepseek' | 'mock';
    promptVersion: typeof IMPORT_PROMPT;
    uploadConsent: {
        preparedHash: string;
        confirmed: true;
        noticeVersion: typeof NOTICE_VERSION;
    }[];
    forceNew: boolean;
    reason: string | null;
}
export interface VersionedJob {
    jobId: string;
    expectedVersion: number;
}
export interface RetryInput extends VersionedJob {
    possibleChargeAccepted: true;
    uploadConsent: {
        preparedHash: string;
        confirmed: true;
        noticeVersion: typeof NOTICE_VERSION;
    };
}
export interface Page {
    limit: number;
    cursor: string | null;
}
export interface JobQuery {
    jobId: string | null;
    statusFilter: JobStatus[];
    page: Page;
}
export interface ListResult<T> {
    items: T[];
    nextCursor: string | null;
    totalCount: number;
    snapshotRevision: number;
}
export interface JobList extends ListResult<Job> {
    counts: Record<JobStatus, number>;
}
export interface Candidate extends NormalizedCandidate {
    id: string;
    version: number;
    jobId: string;
    imageAssetId: string;
    preparedHash: string;
    reviewState: 'pending_review' | 'rejected' | 'approved';
    postedTransactionId: string | null;
    duplicateMatches: {
        targetType: 'transaction' | 'candidate' | 'job';
        targetId: string;
        targetVersion: number;
        basis: string;
    }[];
    excludedByDefault: boolean;
    createdAt: string;
}
export interface CandidateQuery {
    jobId: string | null;
    page: Page;
    reviewStates?: Candidate['reviewState'][];
}
export const IMPORT_CHANNELS = {
    imageSelect: 'image.select', imageDrop: 'image.drop', imageImport: 'image.import',
    imagePrepare: 'image.prepare', imageResource: 'image.resource', imageDelete: 'image.delete',
    recognitionStart: 'recognition.start', recognitionCancel: 'recognition.cancel',
    recognitionRetry: 'recognition.retry', recognitionResume: 'recognition.resume',
    recognitionStatus: 'recognition.status', candidateList: 'candidate.list',
} as const;
