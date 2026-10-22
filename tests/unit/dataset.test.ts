import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { harness, label, proposal, rights, waitRun, LEDGER, EPOCH } from '../fixtures/s13';
import { DATASET_NOTICE, validateLabels, validDatasetCommand, type DatasetVersion, type Run, type Sample } from '../../src/shared/dataset';
import { DatasetService, bytesHash } from '../../src/main/services/dataset/store';
import type { EvaluationProvider } from '../../src/main/services/dataset/provider';
import { groupSamples, splitSamples } from '../../src/main/services/dataset/split';
import { score, pairPool } from '../../src/main/services/dataset/metrics';
import { promptConfig } from '../../src/main/services/dataset/prompt';
const roots: string[] = [];
const setup = (override: Parameters<typeof harness>[1] = {}) => { const root = mkdtempSync(path.join(tmpdir(), 'BookKeep S13 中文 空格 ')); roots.push(root); return harness(root, override); };
afterEach(() => { for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true }); });
const exportCmd = (versionId: string, extra: Record<string, unknown> = {}) => ({ op: 'export' as const, versionId, sampleIds: null, includeImages: true, purpose: 'future_training' as const, recipient: 'local-selftest', confirmed: true as const, ...extra });
function snapshot(h: ReturnType<typeof harness>) { return JSON.parse(readFileSync(path.join(h.env.root, 'datasets', LEDGER, 'state.json'), 'utf8')); }
describe('S13 independent consent, snapshots and export', () => {
    it('refuses registration without dataset consent; recognition grant is not dataset grant', () => { const h = setup(), image = h.addImage(); expect(() => h.register(image, randomUUID())).toThrow('CONSENT_REQUIRED'); h.command({ op: 'consent', ...image, purpose: 'recognition', decision: 'grant', supersedesId: null, noticeVersion: DATASET_NOTICE, rights: null, runManifestHash: 'a'.repeat(64) }); expect(h.summary().samples).toHaveLength(0); expect(() => h.register(image, randomUUID())).toThrow('CONSENT_REQUIRED'); });
    it('grant does not register or invoke a provider', () => { const h = setup(); h.grant(h.addImage()); expect(h.summary().samples).toHaveLength(0); expect(h.providerCalls).toBe(0); });
    it('rejects stale consent chain head', () => { const h = setup(), im = h.addImage(); h.grant(im); expect(() => h.grant(im)).toThrow('VERSION_CONFLICT'); });
    it('rejects denied/unreviewed rights, expired retention and unknown command keys', () => { const h = setup(), im = h.addImage(); expect(validDatasetCommand({ op: 'consent', ...im, purpose: 'dataset', decision: 'grant', supersedesId: null, noticeVersion: DATASET_NOTICE, rights: { ...rights(), licenseStatus: 'denied' }, runManifestHash: null })).toBe(false); expect(() => h.grant(im, { ...rights(), retainUntil: '2020-01-01T00:00:00Z' })).toThrow('LICENCE_REQUIRED'); expect(validDatasetCommand({ op: 'validate', versionId: randomUUID(), path: 'C:\\secret' })).toBe(false); });
    it('null labels cannot create versions; reviewed [] can', () => { const h = setup(), im = h.addImage(), id = h.register(im, h.grant(im)); expect((h.service.read({ kind: 'sample', id }) as {
        sample: Sample;
    }).sample.labels).toBeNull(); expect(() => h.version([id])).toThrow('DATASET_INVALID'); h.annotate(id, []); expect(h.version([id])).toBeTruthy(); });
    it('same image registration is rejected, label corrections retain prior values and original prediction', () => { const h = setup(), s = h.sample(); expect(() => h.register(s.image, s.consentId)).toThrow('DATASET_INVALID'); h.annotate(s.id, [label(0, { amountFen: 1900 })]); const r = h.service.read({ kind: 'sample', id: s.id }) as {
        sample: Sample;
        history: Sample[];
    }; expect(r.history.map(s => s.labels?.[0]?.value.amountFen ?? null)).toEqual([null, 1800, 1900]); expect(r.sample.predictionAvailable).toBe(false); expect(r.sample.prediction).toEqual([]); });
    it('same-person review requires a second saved stage', () => { const h = setup(), im = h.addImage(), id = h.register(im, h.grant(im)); const cmd = { op: 'label' as const, id, expectedVersion: 1, labels: [label()], annotator: 'same', reviewer: 'same', reviewMode: 'same_person' as const, reason: 'second review', correctionOfLockedTest: false }; expect(() => h.command(cmd)).toThrow('DATASET_INVALID'); h.command({ ...cmd, reviewer: null, reviewMode: null }); expect(() => h.command({ ...cmd, expectedVersion: 2 })).not.toThrow(); });
    it('same mutation replays; payload change conflicts', () => { const h = setup(), s = h.sample(), mid = randomUUID(); const c = { op: 'version' as const, tag: 'immutable', sampleIds: [s.id], seed: 13, synonyms: {}, synonymVersion: 'v1' }; expect(h.command(c, mid)).toEqual(h.command(c, mid)); expect(() => h.command({ ...c, seed: 14 }, mid)).toThrow('IDEMPOTENCY_CONFLICT'); });
    it('export checks exact recipient, purpose and image permission', () => { const h = setup(), im = h.addImage(), id = h.register(im, h.grant(im, { ...rights(), allowImages: false, purposes: ['evaluation'] })); h.annotate(id, [label()]); const v = h.version([id]); expect(() => h.command(exportCmd(v))).toThrow('LICENCE_REQUIRED'); expect(() => h.command({ ...exportCmd(v), purpose: 'evaluation', recipient: 'other' })).toThrow('LICENCE_REQUIRED'); expect(() => h.command({ ...exportCmd(v), purpose: 'evaluation' })).toThrow('LICENCE_REQUIRED'); expect(() => h.command({ ...exportCmd(v), purpose: 'evaluation', includeImages: false })).not.toThrow(); });
    it('deterministic full export hashes/JSONL, actual file hashes and no originalHash/identity leak', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); const a = h.command(exportCmd(v)), b = h.command(exportCmd(v)); expect(a.manifestHash).toBe(b.manifestHash); const fa = h.service.artifactFiles(a.artifactId as string), fb = h.service.artifactFiles(b.artifactId as string); expect(fa.find(f => f.relative === 'samples.jsonl')!.bytes).toEqual(fb.find(f => f.relative === 'samples.jsonl')!.bytes); const row = JSON.parse(fa.find(f => f.relative === 'samples.jsonl')!.bytes.toString()); expect(row.sampleId).toBe(s.id); expect(row.sample.originalHash).toBeUndefined(); expect(row.sample.annotator).toBeUndefined(); const manifest = JSON.parse(fa.find(f => f.relative === 'manifest.json')!.bytes.toString()); expect(manifest.manifestHash).toBe(snapshot(h).versions[0].manifestHash); for (const f of manifest.files)
        expect(bytesHash(fa.find(x => x.relative === f.path)!.bytes)).toBe(f.sha256); expect(manifest.files.every((f: {
        path: string;
    }) => !path.isAbsolute(f.path))).toBe(true); });
    it('deleted artifact receipt does not regenerate files', () => { const h = setup(), s = h.sample(), v = h.version([s.id]), mid = randomUUID(), c = exportCmd(v); const a = h.command(c, mid); rmSync(path.join(h.env.root, 'datasets', LEDGER, 'artifacts', a.artifactId as string, 'samples.jsonl')); expect(() => h.command(c, mid)).toThrow('ARTIFACT_MISSING'); });
    it('modified image is rejected', () => { const h = setup(), s = h.sample(); writeFileSync(path.join(h.env.root, 'datasets', LEDGER, 'images', s.image.preparedHash + '.png'), 'broken'); expect(() => h.version([s.id])).toThrow('HASH_MISMATCH'); });
    it('same epoch restarts preserve samples/grant, changed epoch refuses old grant/export', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); h.restart(); expect(h.summary().samples).toHaveLength(1); h.setEpoch(randomUUID()); expect(() => h.command(exportCmd(v))).toThrow('CONSENT_REQUIRED'); });
    it('corrupt state is fail closed rather than replaced by empty state', () => { const h = setup(); h.sample(); h.service.shutdown(); const file = path.join(h.env.root, 'datasets', LEDGER, 'state.json'); writeFileSync(file, 'broken'); expect(() => new DatasetService(h.env)).toThrow(); expect(readFileSync(file, 'utf8')).toBe('broken'); });
});
describe('S13 labels and conservative split isolation', () => {
    it.each([
        ['negative amount', () => [label(0, { amountFen: -1 })]], ['invalid category', () => [label(0, { categoryId: 'missing' })]], ['missing year', () => [label(0, { occurredDate: '09-08' })]],
        ['bad time precision', () => [label(0, { timePrecision: 'minute' })]], ['duplicate label', () => [label(), label()]], ['unknown nonnull', () => { const l = label(); l.facts.name.status = 'unknown'; return [l]; }],
        ['assisted no basis', () => { const l = label(); l.facts.name.status = 'assisted'; return [l]; }], ['total plus detail', () => [label(0, { groupKey: 'order', amountBasis: 'paid_total' }), label(1, { groupKey: 'order' })]],
    ])('rejects %s', (_n, make) => expect(() => validateLabels(make(), ['cat_food'])).toThrow());
    it('accepts multi-record, unknown and externally assisted while excluding assisted from known denominator', () => { const a = label(0, { name: null }), b = label(1); b.facts.occurredDate = { status: 'assisted', reason: 'external synthetic receipt', basisRef: 'external-receipt' }; expect(validateLabels([a, b], ['cat_food'])).toHaveLength(2); });
    it('byte hash and transitive order relations join connected components without collapsing distinct transactions', () => { const h = setup(), a = h.sample([label()], 'a', ['order-a']), b = h.sample([label()], 'b', ['order-a', 'order-b']), c = h.sample([label()], 'c', ['order-b']); const ss = snapshot(h).samples; const samples = [a, b, c].map(s => ss[s.id].at(-1)); const groups = groupSamples(samples); expect(new Set(Object.values(groups)).size).toBe(1); const assigned = splitSamples(samples, 13); expect(new Set(Object.values(assigned.splits)).size).toBe(1); expect(new Set(samples.map(s => s.labels[0].transactionId)).size).toBe(3); expect(() => h.version([a.id])).toThrow('DATASET_INVALID'); });
    it('fixed 100 independent groups allocate exactly 70/15/15; order independent; small sample has no test', () => { const h = setup(), s = h.sample(), base = snapshot(h).samples[s.id].at(-1) as Sample; const samples = Array.from({ length: 100 }, (_, i) => ({ ...base, id: String(i).padStart(3, '0'), preparedHash: `p${i}`, originalHash: `o${i}`, labels: [label(0, {}, `tx-${i}`)] })); const a = splitSamples(samples, 13), b = splitSamples(samples.slice().reverse(), 13); expect(a.splits).toEqual(b.splits); expect(['train', 'dev', 'test'].map(k => Object.values(a.splits).filter(x => x === k).length)).toEqual([70, 15, 15]); expect(Object.values(splitSamples(samples.slice(0, 9), 13).splits)).not.toContain('test'); });
    it('locked test members remain test, new cross-split relations are rejected', () => { const h = setup(), s = h.sample(), base = snapshot(h).samples[s.id].at(-1) as Sample, a = { ...base, id: 'a', relations: ['same'] }, b = { ...base, id: 'b', relations: ['same'] }; expect(() => splitSamples([a, b], 13, { a: 'test', b: 'train' })).toThrow('SPLIT_LEAKAGE'); expect(splitSamples([a, b], 13, { a: 'test' }).splits).toEqual({ a: 'test', b: 'test' }); });
});
describe('S13 withdrawal and unsupported training', () => {
    it('new unrelated artifacts survive tombstone reconciliation after restart', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); h.command(exportCmd(v)); h.command({ op: 'withdraw', sampleId: s.id, reason: 'human' }); const newer = h.sample(), v2 = h.version([newer.id]), e2 = h.command(exportCmd(v2)); h.restart(); expect(h.service.artifactFiles(e2.artifactId as string).length).toBeGreaterThan(1); });
    it('an on-disk old snapshot cannot resurrect deleted sample labels/consent', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); const file = path.join(h.env.root, 'datasets', LEDGER, 'state.json'), old = readFileSync(file); h.command({ op: 'withdraw', sampleId: s.id, reason: 'human' }); h.service.shutdown(); writeFileSync(file, old); const restored = new DatasetService(h.env); expect((restored.read({ kind: 'summary', id: null }) as {
        samples: unknown[];
    }).samples).toHaveLength(0); expect(() => restored.command(exportCmd(v), randomUUID())).toThrow('DATASET_WITHDRAWN'); expect(readFileSync(file, 'utf8')).not.toContain('午餐'); restored.shutdown(); });
    it('prepared validation detects tampered conversion instead of claiming valid', () => { const h = setup(), s = h.sample(), v = h.version([s.id]), e = h.command(exportCmd(v)), p = h.command({ op: 'prepare', versionId: v, exportId: e.artifactId as string, adapterVersion: 'future-training.v1' }); writeFileSync(path.join(h.env.root, 'datasets', LEDGER, 'artifacts', p.artifactId as string, 'training.jsonl'), 'bad'); expect(() => h.command({ op: 'validatePrepared', versionId: v, artifactId: p.artifactId as string, manifestHash: e.manifestHash as string, schemaVersion: 'bk-dataset.v1' })).toThrow('HASH_MISMATCH'); });
    it('epoch renewal requires a new explicit dataset grant and sample version', () => { const h = setup(), s = h.sample(); h.setEpoch(randomUUID()); const cid = h.command({ op: 'consent', ...s.image, purpose: 'dataset', decision: 'grant', supersedesId: s.consentId, noticeVersion: DATASET_NOTICE, rights: rights(), runManifestHash: null }).consentId as string; expect(() => h.version([s.id])).toThrow('CONSENT_REQUIRED'); h.command({ op: 'reauthorize', sampleId: s.id, expectedVersion: 2, consentId: cid }); expect(() => h.version([s.id])).not.toThrow(); });
    it('withdrawal blocks old versions, deletes labels/images/export/report and survives stale state restore', () => { const h = setup(), s = h.sample(), v = h.version([s.id]), e = h.command(exportCmd(v)); const file = path.join(h.env.root, 'datasets', LEDGER, 'state.json'), before = readFileSync(file); const result = h.command({ op: 'withdraw', sampleId: s.id, reason: 'human' }); expect(result.localDeleted).toBe(true); expect(result.externalCopies).toBe('unknown'); expect(h.summary().samples).toHaveLength(0); expect(() => h.command(exportCmd(v))).toThrow('DATASET_WITHDRAWN'); expect(() => h.service.artifactFiles(e.artifactId as string)).toThrow('DATASET_WITHDRAWN'); expect(readFileSync(file, 'utf8')).not.toContain('午餐'); writeFileSync(file, before); h.restart(); expect(h.summary().samples).toHaveLength(0); expect(existsSync(path.join(h.env.root, 'datasets', LEDGER, 'images', s.image.preparedHash + '.png'))).toBe(false); });
    it('withdrawn dataset consent leaves recognition decision independent', () => { const h = setup(), s = h.sample(); h.command({ op: 'consent', ...s.image, purpose: 'recognition', decision: 'grant', supersedesId: null, noticeVersion: DATASET_NOTICE, rights: null, runManifestHash: 'b'.repeat(64) }); h.command({ op: 'consent', ...s.image, purpose: 'dataset', decision: 'withdraw', supersedesId: s.consentId, noticeVersion: DATASET_NOTICE, rights: null, runManifestHash: null }); expect(h.summary().consents.filter(c => c.purpose === 'recognition').at(-1)?.decision).toBe('grant'); expect(h.summary().samples).toHaveLength(0); });
    it('prepare validates a real local artifact, idempotent format, submit/status explicitly unsupported with zero calls', () => { const h = setup(), s = h.sample(), v = h.version([s.id]), e = h.command(exportCmd(v)); const c = { op: 'prepare' as const, versionId: v, exportId: e.artifactId as string, adapterVersion: 'future-training.v1' as const }; const a = h.command(c), b = h.command(c); expect(a.artifactId).toBe(b.artifactId); expect(a.modelTrained).toBe(false); expect(a.weights).toBeNull(); for (const op of ['submit', 'trainingStatus'] as const) {
        try {
            h.command({ op, versionId: v });
            throw new Error('should reject');
        }
        catch (e) {
            expect(e).toMatchObject({ code: 'UNSUPPORTED', retryable: false, details: { reason: 'unsupported' } });
        }
    } expect(h.providerCalls).toBe(0); expect(h.summary().runs).toHaveLength(0); });
});
describe('S13 actual runner state / cancellation / quality guard', () => {
    const runCmd = (versionId: string) => ({ op: 'evaluate' as const, versionId, scope: 'framework' as const, provider: 'mock' as const, split: 'train' as const, intent: 'development' as const, seed: 13, promptVersion: 'bk-eval.s13.v1', possibleChargeAccepted: false, fixture: 's13-hand-calculated.v1' as const });
    it('queued→processing→completed; recorded failure stays in planned denominator; no actualModel/usage invented', async () => { const h = setup(), s = h.sample(), v = h.version([s.id]); h.responses.set(s.id, 'failed'); const r = h.command(runCmd(v)); expect(r.status).toBe('queued'); await waitRun(h.service, r.runId as string); const out = h.command({ op: 'align', runId: r.runId as string, alignment: [], reviewer: 'synthetic-blind', blindConfirmed: true, duplicatePredictions: [] }); const report = out.report as {
        failed: number;
        modelTrained: boolean;
        metrics: {
            key: string;
            numerator: number;
            denominator: number;
        }[];
        apiUsage: unknown;
    }; expect(report.failed).toBe(1); expect(report.modelTrained).toBe(false); expect(report.metrics.find(m => m.key === 'amount_exact')).toMatchObject({ numerator: 0, denominator: 1 }); expect(report.metrics.find(m => m.key === 'transaction_recall')).toMatchObject({ numerator: 0, denominator: 1 }); });
    it('mock+quality and real samples+mock rejected', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); expect(() => h.command({ ...runCmd(v), scope: 'quality' })).toThrow('DATASET_INVALID'); expect(h.providerCalls).toBe(0); });
    it('cancels in-flight and ignores late successful response', async () => { let resolve!: (value: Awaited<ReturnType<EvaluationProvider['recognize']>>) => void; let started = false; const provider: EvaluationProvider = { id: 'mock', adapterVersion: 'delayed-synthetic', recognize: () => { started = true; return new Promise(r => { resolve = r; }); } }; const h = setup({ provider: () => provider }), s = h.sample(), v = h.version([s.id]), r = h.command(runCmd(v)); while (!started)
        await new Promise(r => setTimeout(r, 2)); h.command({ op: 'cancel', runId: r.runId as string }); resolve({ output: { schemaVersion: 'bk-candidate.v1', candidates: [proposal()], warnings: [] }, metadata: { httpStatus: null, actualModel: null, usage: null } }); await new Promise(r => setTimeout(r, 5)); const run = h.service.read({ kind: 'run', id: r.runId as string }) as Run; expect(run.status).toBe('cancelled'); expect(run.results[0].predictions).toEqual([]); expect(run.report).toBeNull(); });
    it('withdraws in-flight, ignores late output, cleans report and current snapshots', async () => { let finish!: () => void; let started = false; const h = setup({ provider: () => ({ id: 'mock', adapterVersion: 'delayed', recognize: () => { started = true; return new Promise(r => { finish = () => r({ output: { schemaVersion: 'bk-candidate.v1', candidates: [proposal()], warnings: [] }, metadata: { httpStatus: null, actualModel: null, usage: null } }); }); } }) }), s = h.sample(), v = h.version([s.id]), r = h.command(runCmd(v)); while (!started)
        await new Promise(r => setTimeout(r, 2)); h.command({ op: 'withdraw', sampleId: s.id, reason: 'human' }); finish(); await new Promise(r => setTimeout(r, 5)); const run = h.service.read({ kind: 'run', id: r.runId as string }) as Run; expect(run.invalidReason).toBe('DATASET_WITHDRAWN'); expect(run.results).toEqual([]); });
    it('quality requires separate upload + cost confirmation before any provider call', () => { const h = setup(), s = h.sample(), v = h.version([s.id]); expect(() => h.command({ ...runCmd(v), provider: 'deepseek', scope: 'quality', fixture: null })).toThrow('CONSENT_REQUIRED'); expect(() => h.command({ ...runCmd(v), provider: 'deepseek', scope: 'quality', possibleChargeAccepted: true, fixture: null })).toThrow('CONSENT_REQUIRED'); expect(h.providerCalls).toBe(0); });
    it('prompt configuration is versioned, deterministic and rejects silent unknown revisions', () => { const cat = [{ id: 'cat_food', name: '食品餐饮' }]; expect(promptConfig('bk-eval.s13.v1', cat).hash).toBe(promptConfig('bk-eval.s13.v1', cat).hash); expect(() => promptConfig('random', cat)).toThrow('PROMPT_VERSION_UNKNOWN'); });
});
describe('S13 hand-calculated metrics', () => {
    it('multi truth, missed/duplicate/failed, unknown, assisted and empty-image false positive are recomputable', () => {
        const h = setup(), a = h.sample([label(0), label(1, { amountFen: 1000, name: '晚餐', occurredDate: null, timePrecision: 'unknown' })], 'multi'), b = h.sample([label()], 'failed'), c = h.sample([], 'empty'), d = h.sample([label(0, { transactionKind: 'refund' })], 'refund');
        const v = snapshot(h);
        const samples = [a, b, c, d].map(s => v.samples[s.id].at(-1)) as Sample[];
        samples[0].labels![1].facts.categoryId = { status: 'assisted', reason: 'external classification', basisRef: 'external' };
        const version: DatasetVersion = { id: randomUUID(), tag: 'manual-math', manifestHash: 'a'.repeat(64), seed: 13, algorithm: 'group-sse.v1', samples, groups: Object.fromEntries(samples.map(s => [s.id, s.id])), splits: Object.fromEntries(samples.map(s => [s.id, 'dev'])), categorySnapshot: [{ id: 'cat_food', name: '食品餐饮' }], categorySnapshotHash: 'b'.repeat(64), synonyms: { 午餐: ['午饭'] }, synonymVersion: 'test.v1', testLocked: true, contaminated: false, exploratory: true, status: 'active', epoch: EPOCH, specVersions: { dataset: 'dataset-spec.v1', evaluation: 'evaluation-spec.v1', schema: 'bk-dataset.v1', label: 'label-policy.v1' }, createdAt: '2026-10-22T00:00:00Z' };
        const run: Run = { id: randomUUID(), datasetVersionId: version.id, manifestHash: version.manifestHash, epoch: EPOCH, revision: 0, status: 'completed', scope: 'framework', provider: 'mock', split: 'dev', intent: 'development', seed: 13, promptVersion: 'v1', promptHash: 'p', runnerVersion: 'v1', runnerHash: 'r', appCommit: 'fixture', adapterVersion: 'mock', requestedModel: 'mock', startedAt: '2026-10-22T00:00:00Z', finishedAt: '2026-10-22T00:00:01Z', results: [
                { sampleId: a.id, status: 'completed', predictions: [proposal({ name: '午饭' }), proposal({ amountFen: 999, name: '晚餐', occurredDate: null, timePrecision: 'unknown' }), proposal()], errorCode: null, durationMs: 10, actualModel: null, usage: null, attempts: 1 },
                { sampleId: b.id, status: 'failed', predictions: [], errorCode: 'NETWORK_ERROR', durationMs: 40, actualModel: null, usage: null, attempts: 1 },
                { sampleId: c.id, status: 'completed', predictions: [proposal()], errorCode: null, durationMs: 20, actualModel: null, usage: null, attempts: 1 },
                { sampleId: d.id, status: 'completed', predictions: [proposal({ transactionKind: 'refund' })], errorCode: null, durationMs: 30, actualModel: null, usage: null, attempts: 1 },
            ], alignment: [{ sampleId: a.id, predictionOrdinal: 0, labelId: 'label-0', reason: 'row 0' }, { sampleId: a.id, predictionOrdinal: 1, labelId: 'label-1', reason: 'row 1' }, { sampleId: d.id, predictionOrdinal: 0, labelId: 'label-0', reason: 'refund row' }], alignmentHash: 'synthetic', alignmentReviewer: 'synthetic', pairPool: pairPool(version, samples), duplicatePredictions: [], report: null, invalidReason: null };
        const report = score(version, run) as {
            metrics: {
                key: string;
                scene: string;
                numerator: number;
                denominator: number;
                value: number | null;
            }[];
            latency: {
                n: number;
                p95: number;
            }[];
        };
        const m = (key: string) => report.metrics.find(m => m.key === key && m.scene === 'all')!;
        // 3 GT expenses; 4 possible-spend predictions = 2 TP + 2 FP; failed image contributes 1 FN.
        expect(m('transaction_precision')).toMatchObject({ numerator: 2, denominator: 4, value: .5 });
        expect(m('transaction_recall')).toMatchObject({ numerator: 2, denominator: 3 });
        expect(m('transaction_f1')).toMatchObject({ numerator: 4, denominator: 7 });
        expect(m('amount_exact')).toMatchObject({ numerator: 1, denominator: 3 });
        expect(m('date_exact')).toMatchObject({ numerator: 1, denominator: 2 });
        expect(m('category_exact')).toMatchObject({ numerator: 1, denominator: 2 });
        expect(m('item_acceptable')).toMatchObject({ numerator: 2, denominator: 3 });
        expect(m('missing_recall_occurredDate')).toMatchObject({ numerator: 1, denominator: 1 });
        expect(m('missing_recall_amountFen')).toMatchObject({ denominator: 0, value: null });
        expect(m('empty_image_fp_rate')).toMatchObject({ numerator: 1, denominator: 1 });
        expect(m('non_expense_recall')).toMatchObject({ numerator: 1, denominator: 1 });
        expect(report.latency[0]).toMatchObject({ n: 3, p95: 30 });
    });
});
