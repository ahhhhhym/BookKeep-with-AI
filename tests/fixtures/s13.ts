/** Hand-authored SYNTHETIC fixtures. No user images, keys or ledger input. */
import { randomUUID } from 'node:crypto';
import { DatasetService, bytesHash, type DatasetEnvironment } from '../../src/main/services/dataset/store';
import { DATASET_NOTICE, FIELDS, type DatasetCommand, type DatasetSummary, type Label, type Rights, type Sample } from '../../src/shared/dataset';
import { AppError } from '../../src/shared/errors';
import type { Proposal } from '../../src/shared/candidate';
import type { EvaluationProvider } from '../../src/main/services/dataset/provider';
export const EPOCH = '10000000-0000-4000-8000-000000000001', LEDGER = '20000000-0000-4000-8000-000000000002';
export function proposal(extra: Partial<Proposal> = {}): Proposal {
    const p: Proposal = { amountFen: 1800, occurredDate: '2026-09-08', occurredTime: null, timePrecision: 'date', name: '午餐', merchant: '合成商户', categoryId: 'cat_food', transactionKind: 'expense', amountBasis: 'line_payment', groupKey: null, lineItems: [], evidence: [], missingFields: [], warnings: [], confidence: null, ...extra };
    p.missingFields = FIELDS.filter(f => p[f] === null);
    p.evidence = FIELDS.filter(f => p[f] !== null).map(field => ({ field, text: String(p[field]), region: { x: .05, y: .1, width: .9, height: .2 }, source: 'image' }));
    if (p.transactionKind && p.transactionKind !== 'expense')
        p.warnings = [{ code: 'NON_EXPENSE', message: '合成非支出', field: 'transactionKind' }];
    return p;
}
export function label(ordinal = 0, extra: Partial<Proposal> = {}, transactionId: string = randomUUID()): Label {
    const p = proposal(extra);
    return { labelId: `label-${ordinal}`, ordinal, transactionId, value: { ...p, evidence: p.evidence.map(e => ({ ...e, source: 'human' })) }, facts: Object.fromEntries(FIELDS.map(f => [f, { status: p[f] === null ? 'unknown' : 'known', reason: p[f] === null ? 'not_visible' : 'synthetic visible text', basisRef: null }])) as Label['facts'] };
}
export function rights(): Rights { return { sourceType: 'other', sourceAlias: 'S13 SYNTHETIC', collectedOn: '2026-10-22', registrar: 'synthetic-author', licenseStatus: 'allowed', licenseAlias: 'project-authored-synthetic', licenseVersion: 'v1', purposes: ['evaluation', 'future_training'], recipients: ['local-selftest'], allowImages: true, retainUntil: '2099-01-01T00:00:00.000Z', reviewAt: '2098-01-01T00:00:00.000Z', redactionStatus: 'approved', redactionMethod: 'synthetic-no-private-data.v1', redactionReviewer: 'synthetic-reviewer' }; }
export function harness(root: string, override: Partial<DatasetEnvironment> = {}) {
    const images = new Map<string, {
        bytes: Buffer;
        originalHash: string;
    }>();
    const responses = new Map<string, Proposal[] | 'failed'>();
    let epoch = EPOCH;
    let providerCalls = 0;
    const provider: EvaluationProvider = { id: 'mock', adapterVersion: 's13-fixture.v1', async recognize(input) { providerCalls++; const p = responses.get(input.sampleId) ?? []; if (p === 'failed')
            throw new AppError('NETWORK_ERROR'); return { output: { schemaVersion: 'bk-candidate.v1', candidates: p, warnings: [] }, metadata: { httpStatus: null, actualModel: null, usage: null } }; } };
    const env: DatasetEnvironment = { root, ledgerId: () => LEDGER, epoch: () => epoch, categories: () => [{ id: 'cat_food', name: '食品餐饮' }, { id: 'cat_other', name: '其他' }], image: (id, hash) => { const value = images.get(id); if (!value || bytesHash(value.bytes) !== hash)
            throw new AppError('IMAGE_NOT_PREPARED'); return value; }, prediction: () => { throw new AppError('DATASET_INVALID'); }, provider: () => provider, runnerHash: 'a'.repeat(64), appCommit: 'synthetic-fixture', ...override };
    let service = new DatasetService(env);
    const command = (c: DatasetCommand, id = randomUUID()) => service.command(c, id) as Record<string, unknown>;
    function addImage(bytes: Buffer = Buffer.from('SYNTHETIC IMAGE BYTES ' + randomUUID())) { const id = randomUUID(); images.set(id, { bytes, originalHash: bytesHash(bytes) }); return { imageAssetId: id, preparedHash: bytesHash(bytes) }; }
    function grant(image: ReturnType<typeof addImage>, r = rights()) { return command({ op: 'consent', ...image, purpose: 'dataset', decision: 'grant', supersedesId: null, noticeVersion: DATASET_NOTICE, rights: r, runManifestHash: null }).consentId as string; }
    function register(image: ReturnType<typeof addImage>, consentId: string, scene = 'single', relations: string[] = [], kind: 'real' | 'synthetic' = 'synthetic') { return command({ op: 'register', ...image, consentId, kind, predictionJobId: null, primaryScene: scene, secondaryScenes: [], relations }).sampleId as string; }
    function annotate(id: string, labels: Label[]) { const s = (service.read({ kind: 'sample', id }) as {
        sample: Sample;
    }).sample; command({ op: 'label', id, expectedVersion: s.version, labels, annotator: 'synthetic-annotator', reviewer: 'synthetic-reviewer', reviewMode: 'different_person', reason: 'hand-authored ground truth', correctionOfLockedTest: false }); }
    function sample(labels: Label[] = [label()], scene = 'single', relations: string[] = [], bytes?: Buffer) { const image = addImage(bytes), cid = grant(image), id = register(image, cid, scene, relations); annotate(id, labels); return { id, image, consentId: cid }; }
    function version(ids: string[], tag = 'synthetic-' + randomUUID(), seed = 13) { return command({ op: 'version', tag, sampleIds: ids, seed, synonyms: { 午餐: ['午饭'] }, synonymVersion: 'synthetic-synonyms.v1' }).versionId as string; }
    return { get service() { return service; }, command, addImage, grant, register, annotate, sample, version, responses, env, images, provider, get providerCalls() { return providerCalls; }, setEpoch: (value: string) => { epoch = value; }, restart: () => { service.shutdown(); service = new DatasetService(env); return service; }, summary: () => service.read({ kind: 'summary', id: null }) as DatasetSummary };
}
export async function waitRun(service: DatasetService, id: string) { for (let i = 0; i < 1000; i++) {
    const run = service.read({ kind: 'run', id }) as {
        status: string;
    };
    if (run.status !== 'queued' && run.status !== 'processing')
        return run;
    await new Promise(r => setTimeout(r, 5));
} throw new Error('runner timeout'); }
