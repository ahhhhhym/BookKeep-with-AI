import type { ChannelSpec } from './ipc';
import { IMPORT_CHANNELS as C, IMPORT_PROMPT, NOTICE_VERSION, type CandidateQuery, type ImportInput, type PrepareInput, type ResourceInput, type StartInput, type VersionedJob, type RetryInput, type JobQuery } from './imports';
import { isPlainRecord, isUuidV4 } from './validation';
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) < 2147483647;
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => isPlainRecord(v) && Object.keys(v).length === names.length && names.every(n => n in v);
const rect = (v: unknown): boolean => keys(v, ['x', 'y', 'width', 'height']) && Object.values(v).every(n => Number.isSafeInteger(n) && Number(n) >= 0) && Number(v.width) > 0 && Number(v.height) > 0;
const consent = (v: unknown) => keys(v, ['preparedHash', 'confirmed', 'noticeVersion']) && hash(v.preparedHash) && v.confirmed === true && v.noticeVersion === NOTICE_VERSION;
const page = (v: unknown) => keys(v, ['limit', 'cursor']) && Number.isInteger(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 100 && (v.cursor === null || (typeof v.cursor === 'string' && v.cursor.length <= 2048));
function spec<T>(channel: ChannelSpec['channel'], required: string[], valid: (v: Record<string, unknown>) => boolean, mutation: boolean, permission: ChannelSpec['permission']): ChannelSpec<T> {
    return { channel, permission, skeletonOnly: false, request: { required, optional: [], allowNullEpoch: false, requireMutationId: mutation,
            validatePayload: v => valid(v) ? [] : [{ path: 'payload', code: 'INVALID_IMPORT_INPUT' }], cast: v => v as T } };
}
const jobVersion = (v: Record<string, unknown>) => isUuidV4(v.jobId) && version(v.expectedVersion);
const retry = (v: Record<string, unknown>) => jobVersion(v) && v.possibleChargeAccepted === true && consent(v.uploadConsent);
export const IMPORT_SPECS = {
    imageSelect: spec<Record<string, never>>(C.imageSelect, [], () => true, false, 'F'),
    // Paths exist only inside the isolated preload: public API accepts actual File objects.
    imageDrop: spec<{
        paths: string[];
    }>(C.imageDrop, ['paths'], v => Array.isArray(v.paths) && v.paths.length >= 1 && v.paths.length <= 20 && v.paths.every(p => typeof p === 'string' && p.length <= 32767 && !p.includes('\0')), false, 'F'),
    imageImport: spec<ImportInput>(C.imageImport, ['selectionTokens', 'retention'], v => Array.isArray(v.selectionTokens) && v.selectionTokens.length >= 1 && v.selectionTokens.length <= 20 && v.selectionTokens.every(isUuidV4) && new Set(v.selectionTokens).size === v.selectionTokens.length && ['keep_original', 'prepared_only'].includes(String(v.retention)), true, 'F'),
    imagePrepare: spec<PrepareInput>(C.imagePrepare, ['imageAssetId', 'expectedVersion', 'crop', 'masks', 'retainOriginal'], v => isUuidV4(v.imageAssetId) && version(v.expectedVersion) && (v.crop === null || rect(v.crop)) && Array.isArray(v.masks) && v.masks.length <= 50 && v.masks.every(rect) && typeof v.retainOriginal === 'boolean', true, 'F'),
    imageResource: spec<ResourceInput>(C.imageResource, ['imageAssetId', 'variant'], v => isUuidV4(v.imageAssetId) && ['original', 'prepared'].includes(String(v.variant)), false, 'R'),
    imageDelete: spec<{
        imageAssetId: string;
        expectedVersion: number;
        confirmed: true;
    }>(C.imageDelete, ['imageAssetId', 'expectedVersion', 'confirmed'], v => isUuidV4(v.imageAssetId) && version(v.expectedVersion) && v.confirmed === true, true, 'W'),
    recognitionStart: spec<StartInput>(C.recognitionStart, ['images', 'provider', 'promptVersion', 'uploadConsent', 'forceNew', 'reason'], v => Array.isArray(v.images) && v.images.length >= 1 && v.images.length <= 20 && v.images.every(i => keys(i, ['imageAssetId', 'preparedHash']) && isUuidV4(i.imageAssetId) && hash(i.preparedHash)) && ['mock', 'deepseek'].includes(String(v.provider)) && v.promptVersion === IMPORT_PROMPT && Array.isArray(v.uploadConsent) && v.uploadConsent.length === v.images.length && v.uploadConsent.every(consent) && typeof v.forceNew === 'boolean' && (v.reason === null || (typeof v.reason === 'string' && v.reason.trim().length > 0 && v.reason.length <= 500)) && (!v.forceNew || v.reason !== null), true, 'U'),
    recognitionCancel: spec<VersionedJob>(C.recognitionCancel, ['jobId', 'expectedVersion'], jobVersion, true, 'W'),
    recognitionRetry: spec<RetryInput>(C.recognitionRetry, ['jobId', 'expectedVersion', 'possibleChargeAccepted', 'uploadConsent'], retry, true, 'U'),
    recognitionResume: spec<RetryInput>(C.recognitionResume, ['jobId', 'expectedVersion', 'possibleChargeAccepted', 'uploadConsent'], retry, true, 'U'),
    recognitionStatus: spec<JobQuery>(C.recognitionStatus, ['jobId', 'statusFilter', 'page'], v => (v.jobId === null || isUuidV4(v.jobId)) && Array.isArray(v.statusFilter) && v.statusFilter.length <= 5 && v.statusFilter.every(s => ['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(String(s))) && page(v.page), false, 'R'),
    candidateList: { ...spec<CandidateQuery>(C.candidateList, ['jobId', 'page'], v => (v.jobId === null || isUuidV4(v.jobId)) && page(v.page), false, 'R'), request: {
        required:['jobId','page'],optional:['reviewStates'],allowNullEpoch:false,requireMutationId:false,
        validatePayload:(v:Record<string,unknown>)=>(v.jobId===null||isUuidV4(v.jobId))&&page(v.page)&&(!('reviewStates' in v)||Array.isArray(v.reviewStates)&&v.reviewStates.length<=3&&v.reviewStates.every((s:unknown)=>['pending_review','approved','rejected'].includes(String(s))))?[]:[{path:'payload',code:'INVALID_IMPORT_INPUT'}],cast:(v:Record<string,unknown>)=>v as unknown as CandidateQuery,
    } },
};
