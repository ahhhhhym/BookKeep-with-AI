/** BK-S13-007: fixed, hand-calculated SYNTHETIC/mock truth; no external HTTP. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, label, proposal, waitRun, LEDGER } from '../fixtures/s13';
import { metric, score } from '../../src/main/services/dataset/metrics';
import { FIELDS, type DatasetVersion, type Label, type Metric, type Run } from '../../src/shared/dataset';

const opened: ReturnType<typeof harness>[] = [];
afterEach(() => {
    for (const h of opened.splice(0)) {
        h.service.shutdown();
        rmSync(h.env.root, { recursive: true, force: true });
    }
});
const setup = () => {
    const h = harness(mkdtempSync(path.join(tmpdir(), 'BookKeep 007 synthetic ')));
    opened.push(h);
    return h;
};
const evaluate = (versionId: string) => ({ op: 'evaluate' as const, versionId, scope: 'framework' as const, provider: 'mock' as const, split: 'train' as const, intent: 'development' as const, seed: 13, promptVersion: 'bk-eval.s13.v1', possibleChargeAccepted: false, fixture: null });
const align = (runId: string, alignment: Run['alignment'] = []) => ({ op: 'align' as const, runId, alignment: alignment!, reviewer: 'synthetic-predefined-row', blindConfirmed: true as const, duplicatePredictions: [] });
const metrics = (r: Record<string, unknown>) => r.metrics as Metric[];
const get = (r: Record<string, unknown>, key: string, scene = 'all') => metrics(r).find(m => m.key === key && m.scene === scene)!;
function expectCount(r: Record<string, unknown>, key: string, k: number, n: number, scene = 'all') {
    expect(get(r, key, scene), key).toMatchObject({ numerator: k, denominator: n, value: n ? k / n : null });
}
function finiteTree(value: unknown) {
    if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    else if (value && typeof value === 'object') for (const x of Object.values(value)) finiteTree(x);
}
function checkReport(r: Record<string, unknown>) {
    finiteTree(r); // Must run BEFORE stringify; JSON would silently replace NaN with null.
    for (const m of metrics(r)) {
        expect(Number.isSafeInteger(m.numerator), m.key).toBe(true);
        expect(Number.isSafeInteger(m.denominator), m.key).toBe(true);
        expect(m.value, m.key).toBe(m.denominator ? m.numerator / m.denominator : null);
        if (!m.denominator || m.key.endsWith('f1') || m.key.startsWith('manual_')) expect(m.wilson95).toBeNull();
        else {
            // Independent center/half-width form of the published Wilson formula.
            const n = m.denominator, p = m.numerator / n, z2 = 3.8416;
            const center = (p + z2 / (2 * n)) / (1 + z2 / n);
            const half = 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / (1 + z2 / n);
            expect(m.wilson95![0]).toBeCloseTo(Math.max(0, center - half), 12);
            expect(m.wilson95![1]).toBeCloseTo(Math.min(1, center + half), 12);
        }
    }
}
async function failedReport(labels: Label[]) {
    const h = setup(), s = h.sample(labels), v = h.version([s.id]);
    h.responses.set(s.id, 'failed');
    const { runId } = h.command(evaluate(v)) as { runId: string };
    await waitRun(h.service, runId);
    const { report } = h.command(align(runId)) as { report: Record<string, unknown> };
    return { h, s, v, runId, report };
}

describe('BK-S13-007 failed counts before serialization and after persistence', () => {
    it.each(['known', 'unknown', 'nonexpense'] as const)('%s retains denominators and finite zero counts across restart', async kind => {
        const truth = kind === 'known' ? label() : kind === 'unknown' ? label(0, { occurredDate: null, timePrecision: 'unknown', name: null, categoryId: null }) : label(0, { transactionKind: 'refund' });
        const { h, runId, report } = await failedReport([truth]);
        if (kind === 'known') {
            for (const key of ['time_precision_exact', 'amount_exact', 'date_exact', 'item_acceptable', 'category_exact', 'transaction_recall']) expectCount(report, key, 0, 1);
        } else if (kind === 'unknown') {
            for (const f of ['occurredDate', 'name', 'categoryId']) {
                expectCount(report, `unknown_fill_rate_${f}`, 0, 1);
                expectCount(report, `missing_recall_${f}`, 0, 1);
            }
            expectCount(report, 'unknown_fill_rate', 0, 3);
            expectCount(report, 'missing_recall', 0, 3);
        } else {
            expectCount(report, 'non_expense_as_expense_rate', 0, 1);
            expectCount(report, 'non_expense_recall', 0, 1); // Failure is not correct recognition.
        }
        expectCount(report, 'completion_rate', 0, 1);
        expectCount(report, 'failed_rate', 1, 1);
        checkReport(report);
        const state = JSON.parse(readFileSync(path.join(h.env.root, 'datasets', LEDGER, 'state.json'), 'utf8'));
        expect(state.runs[0].report).toEqual(report);
        checkReport(state.runs[0].report);
        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
        h.restart();
        const reread = h.service.read({ kind: 'run', id: runId }) as Run;
        expect(reread.report).toEqual(report);
        checkReport(reread.report!);
    });

    // A completed empty prediction and a non-aligned prediction are different from failure.
    // Cancelled/unfinished copies below are diagnostic score inputs, never public completed runs.
    it.each(['empty', 'unaligned', 'cancelled', 'unprocessed', 'absent', 'processing'] as const)('%s has no observed correct/fill event', async mode => {
        const truth = [label(0), label(1, { amountFen: null, occurredDate: null, timePrecision: 'unknown', name: null, categoryId: null }), label(2, { transactionKind: 'refund' }), label(3, { transactionKind: null })];
        const { h, s, runId } = await failedReport(truth);
        const state = JSON.parse(readFileSync(path.join(h.env.root, 'datasets', LEDGER, 'state.json'), 'utf8'));
        const v = state.versions[0] as DatasetVersion, run = state.runs[0] as Run;
        const row = run.results[0];
        row.status = mode === 'empty' || mode === 'unaligned' ? 'completed' : mode === 'absent' ? 'unprocessed' : mode;
        row.predictions = mode === 'unaligned' ? [proposal()] : [];
        run.alignment = [];
        if (mode === 'absent') run.results = [];
        if (!['empty', 'unaligned'].includes(mode)) { run.status = 'cancelled'; run.invalidReason = 'CANCELLED'; run.scope = 'quality'; }
        const report = score(v, run);
        expectCount(report, 'time_precision_exact', 0, 1);
        expectCount(report, 'unknown_fill_rate', 0, 4);
        expectCount(report, 'missing_recall', 0, 4);
        expectCount(report, 'non_expense_as_expense_rate', 0, 1);
        expectCount(report, 'non_expense_recall', 0, 1);
        expectCount(report, 'unknown_status_warning_recall', 0, 1);
        expectCount(report, 'transaction_recall', 0, 2);
        expectCount(report, 'transaction_precision', 0, mode === 'unaligned' ? 1 : 0);
        expectCount(report, 'completion_rate', ['empty', 'unaligned'].includes(mode) ? 1 : 0, 1);
        if (mode === 'cancelled') expectCount(report, 'cancelled_rate', 1, 1);
        if (mode === 'unprocessed' || mode === 'absent') expectCount(report, 'unprocessed_rate', 1, 1);
        if (!['empty', 'unaligned'].includes(mode)) expect(report).toMatchObject({ frameworkStatus: 'not_asserted', qualityConclusion: 'invalid', independentQualityPassed: false });
        checkReport(report);
        expect(s.id).toBe(row.sampleId);
        expect(runId).toBe(run.id);
        expect(h.providerCalls).toBe(1);
    });

    it('public cancel keeps report null and refuses align without fabricating completion', async () => {
        const h = setup(), s = h.sample(), v = h.version([s.id]);
        const { runId } = h.command(evaluate(v)) as { runId: string };
        h.command({ op: 'cancel', runId });
        const run = h.service.read({ kind: 'run', id: runId }) as Run;
        expect(run.status).toBe('cancelled');
        expect(run.report).toBeNull();
        expect(() => h.command(align(runId))).toThrow('STATE_CONFLICT');
        expect(h.providerCalls).toBe(0);
    });

    it('observed non-expense false positives remain one; wrong-kind expenses remain missed', async () => {
        const { h, s } = await failedReport([label(0, { transactionKind: 'refund' }), label(1)]);
        const state = JSON.parse(readFileSync(path.join(h.env.root, 'datasets', LEDGER, 'state.json'), 'utf8'));
        const v = state.versions[0] as DatasetVersion, run = state.runs[0] as Run;
        run.results[0].status = 'completed';
        run.alignment = [0, 1].map(i => ({ sampleId: s.id, labelId: `label-${i}`, predictionOrdinal: i, reason: 'predefined synthetic row' }));
        for (const kind of ['expense', null, 'refund'] as const) {
            run.results[0].predictions = [proposal({ transactionKind: kind }), proposal({ transactionKind: 'refund' })];
            const report = score(v, run);
            expectCount(report, 'non_expense_as_expense_rate', kind === 'refund' ? 0 : 1, 1);
            expectCount(report, 'non_expense_recall', kind === 'refund' ? 1 : 0, 1);
            expectCount(report, 'time_precision_exact', 0, 1);
            expectCount(report, 'transaction_recall', 0, 1);
            checkReport(report);
        }
    });
});

describe('BK-S13-007 fixed six-image demo truth and independent metric types', () => {
    it('time precision is 2/3 overall and 0/1 failed; other hand-counted results stay intact', async () => {
        const h = setup(), tx = 'synthetic-same-transaction';
        const scenarios = [
            { scene: 'multi', labels: [label(0, {}, tx), label(1, { amountFen: 1000, name: '晚餐', occurredDate: null, timePrecision: 'unknown' })], predictions: [proposal({ name: '午饭' }), proposal({ amountFen: 999, name: '晚餐', occurredDate: null, timePrecision: 'unknown' }), proposal()] },
            { scene: 'request-failed', labels: [label()], predictions: 'failed' as const },
            { scene: 'empty-background', labels: [], predictions: [proposal()] },
            { scene: 'refund', labels: [label(0, { transactionKind: 'refund' })], predictions: [proposal({ transactionKind: 'refund' })] },
            { scene: 'duplicate-view', labels: [label(0, {}, tx)], predictions: [proposal()] },
            { scene: 'unknown-product', labels: [label(0, { name: null, categoryId: null, occurredDate: null, timePrecision: 'unknown' })], predictions: [proposal({ name: null, categoryId: null, occurredDate: '2026-09-08' })] },
        ];
        scenarios[0].labels[1].facts.categoryId = { status: 'assisted', reason: 'synthetic external supplement', basisRef: 'synthetic-receipt' };
        const ids = scenarios.map(s => { const x = h.sample(s.labels, s.scene, ['synthetic-demo-family']); h.responses.set(x.id, s.predictions); return x.id; });
        const v = h.version(ids), { runId } = h.command(evaluate(v)) as { runId: string };
        await waitRun(h.service, runId);
        const mapping = scenarios.flatMap((s, i) => s.predictions === 'failed' ? [] : s.labels.map((l, j) => ({ sampleId: ids[i], labelId: l.labelId, predictionOrdinal: j, reason: 'predefined synthetic source row' })));
        const report = h.command(align(runId, mapping)).report as Record<string, unknown>;
        const expected: Record<string, [number, number]> = { time_precision_exact: [2, 3], amount_exact: [3, 5], date_exact: [2, 3], category_exact: [2, 3], item_acceptable: [3, 4], transaction_precision: [4, 6], transaction_recall: [4, 5], transaction_f1: [8, 11], missing_recall: [3, 4], missing_precision: [3, 3], unknown_fill_rate: [1, 4], non_expense_recall: [1, 1], non_expense_as_expense_rate: [0, 1], duplicate_precision: [1, 3], duplicate_recall: [1, 1], duplicate_f1: [2, 4] };
        for (const [key, [k, n]] of Object.entries(expected)) expectCount(report, key, k, n);
        expectCount(report, 'time_precision_exact', 0, 1, 'request-failed');
        expectCount(report, 'category_exact', 1, 1, 'multi'); // Assisted category excluded.
        expectCount(report, 'missing_recall_amountFen', 0, 0);
        expect(metrics(report).every(m => m.kind === 'synthetic' && m.split === 'train')).toBe(true);
        checkReport(report);
        const usage = report.apiUsage as { total: { knownSum: null; knownAttemptCount: number; totalAttemptCount: number } };
        expect(usage.total).toEqual({ knownSum: null, knownAttemptCount: 0, totalAttemptCount: 6 });
    });

    it.each([[NaN, 1], [Infinity, 1], [1, Infinity], [-1, 1], [1, -1], [.5, 1], [2, 1], [1, 0], [0, .5], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]])('rejects invalid binomial counts %s/%s before Wilson/JSON', (k, n) => {
        expect(() => metric('synthetic_ratio', k, n, 'synthetic', 'all', 'train')).toThrow('METRIC_COUNTS_INVALID');
    });
    it('zero opportunity, Wilson 0/1 and 2/3, F1 and mean use their own rules', () => {
        const m = (k: number, n: number, ratio = true) => metric('synthetic', k, n, 'synthetic', 'all', 'train', ratio);
        expect(m(0, 0)).toMatchObject({ numerator: 0, denominator: 0, value: null, wilson95: null });
        expect(m(0, 1).wilson95![1]).toBeCloseTo(.7934567085, 9);
        expect(m(2, 3).wilson95![0]).toBeCloseTo(.2076549551, 9);
        expect(m(2, 3).wilson95![1]).toBeCloseTo(.9385096847, 9);
        expect(m(8, 11, false)).toMatchObject({ value: 8 / 11, wilson95: null });
        expect(m(7, 2, false)).toMatchObject({ value: 3.5, wilson95: null });
        expect(m(7.5, 2, false)).toMatchObject({ value: 3.75, wilson95: null });
        expect(m(0, 0, false)).toMatchObject({ value: null, wilson95: null });
        expect(() => m(Infinity, 2, false)).toThrow('METRIC_COUNTS_INVALID');
    });

    it('secondary scenes and real/synthetic strata never mix field opportunities', async () => {
        const { h } = await failedReport([label()]);
        const state = JSON.parse(readFileSync(path.join(h.env.root, 'datasets', LEDGER, 'state.json'), 'utf8'));
        const v = state.versions[0] as DatasetVersion, run = state.runs[0] as Run;
        // Synthetic object used only to exercise reporting separation; never registered as real data.
        const real = structuredClone(v.samples[0]); real.id = 'synthetic-real-stratum-placeholder'; real.kind = 'real'; real.secondaryScenes = ['overlap'];
        v.samples.push(real); v.splits[real.id] = 'train'; v.groups[real.id] = 'synthetic-separate-group';
        const report = score(v, run);
        for (const kind of ['real', 'synthetic']) {
            expect(metrics(report).find(m => m.key === 'time_precision_exact' && m.kind === kind && m.scene === 'all')).toMatchObject({ numerator: 0, denominator: 1 });
        }
        expect(metrics(report).filter(m => m.scene === 'overlap').every(m => m.kind === 'real')).toBe(true);
        checkReport(report);
        expect(FIELDS).toHaveLength(4);
    });
});
