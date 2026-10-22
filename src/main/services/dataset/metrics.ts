import { FIELDS, type Alignment, type DatasetVersion, type EvaluationResult, type Label, type Metric, type Pair, type Run, type Sample } from '../../../shared/dataset';
import type { MissingField, Proposal } from '../../../shared/candidate';
import { hashPayload } from '../canonical';
const possible = (p: Proposal) => p.transactionKind === 'expense' || p.transactionKind === null;
const name = (s: string) => s.normalize('NFC').trim().replace(/\s+/gu, ' ');
export function metric(key: string, k: number, n: number, kind: string, scene: string, split: string, ratio = true): Metric {
    const p = n ? k / n : null, z = 1.96;
    const interval: [
        number,
        number
    ] | null = p === null || !ratio ? null : [Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)), Math.min(1, (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n))];
    return { key, numerator: k, denominator: n, value: p, kind, scene, split, wilson95: interval };
}
export function pairPool(v: DatasetVersion, samples: Sample[]): Pair[] {
    if (samples.some(s => !Object.hasOwn(v.splits, s.id)))
        throw new Error('PAIR_POOL_SCOPE');
    const objects = samples.flatMap(s => (s.labels ?? []).filter(l => l.value.transactionKind === 'expense').map(l => ({ s, l })));
    if (objects.length > 1000)
        throw new Error('PAIR_POOL_TOO_LARGE');
    const pairs: Pair[] = [];
    for (let i = 0; i < objects.length; i++)
        for (let j = i + 1; j < objects.length; j++) {
            const a = objects[i], b = objects[j];
            if (a.s.id === b.s.id)
                continue;
            const positive = a.l.transactionId === b.l.transactionId;
            const hardNegative = !positive && a.l.value.amountFen !== null && a.l.value.amountFen === b.l.value.amountFen && a.l.value.occurredDate === b.l.value.occurredDate && a.l.value.merchant === b.l.value.merchant;
            // Whole frozen split pool; no selection based on which pairs the detector already found.
            pairs.push({ id: hashPayload([a.s.id, a.l.labelId, b.s.id, b.l.labelId]), leftSample: a.s.id, leftLabel: a.l.labelId, rightSample: b.s.id, rightLabel: b.l.labelId, positive, hardNegative });
            if (pairs.length > 100000)
                throw new Error('PAIR_POOL_TOO_LARGE');
        }
    return pairs;
}
function matched(a: Alignment[], s: Sample, r: EvaluationResult | undefined, l: Label): Proposal | undefined { const m = a.find(m => m.sampleId === s.id && m.labelId === l.labelId); return r?.status === 'completed' && m ? r.predictions[m.predictionOrdinal] : undefined; }
export function score(v: DatasetVersion, run: Run): Record<string, unknown> {
    const samples = v.samples.filter(s => v.splits[s.id] === run.split), results = run.results, alignment = run.alignment ?? [];
    const metrics: Metric[] = [];
    const scenes = ['all', ...new Set(samples.flatMap(s => [s.primaryScene, ...s.secondaryScenes]).filter(scene=>scene!=='all'))];
    const strata: Record<string, unknown>[] = [];
    const confusion: Record<string, number> = {};
    for (const kind of ['real', 'synthetic'])
        for (const scene of scenes) {
            const ss = samples.filter(s => s.kind === kind && (scene === 'all' || s.primaryScene === scene || s.secondaryScenes.includes(scene)));
            if (!ss.length)
                continue;
            const rs = results.filter(r => ss.some(s => s.id === r.sampleId));
            const opportunities = Object.fromEntries(FIELDS.map(f => [f, { known: 0, unknown: 0, assisted: 0 }]));
            const c: Record<string, [
                number,
                number
            ]> = {};
            const add = (key: string, k: number, n: number) => { const old = c[key] ?? [0, 0]; c[key] = [old[0] + k, old[1] + n]; };
            let tp = 0, fp = 0, fn = 0, nonexpense = 0, unknownStatus = 0;
            for (const s of ss) {
                const r = rs.find(r => r.sampleId === s.id), labels = s.labels ?? [], ps = r?.status === 'completed' ? r.predictions : [];
                const expense = labels.filter(l => l.value.transactionKind === 'expense');
                for (let i = 0; i < ps.length; i++)
                    if (possible(ps[i])) {
                        const map = alignment.find(m => m.sampleId === s.id && m.predictionOrdinal === i);
                        if (map && expense.some(l => l.labelId === map.labelId))
                            tp++;
                        else
                            fp++;
                        for (const f of FIELDS)
                            if (ps[i].missingFields.includes(f))
                                add(`missing_precision_${f}`, Number(!!map && expense.some(l => l.labelId === map.labelId && l.facts[f].status === 'unknown') && ps[i][f] === null), 1);
                    }
                for (const l of expense) {
                    const p = matched(alignment, s, r, l), detected = p && possible(p);
                    if (!detected)
                        fn++;
                    for (const f of FIELDS) {
                        const fact = l.facts[f];
                        opportunities[f][fact.status]++;
                        if (fact.status === 'known') {
                            let correct = !!detected && p[f] === l.value[f];
                            if (f === 'name' && detected && p.name !== null && l.value.name !== null)
                            correct = [l.value.name, ...(Object.hasOwn(v.synonyms,l.value.name)?v.synonyms[l.value.name]:[])].map(name).includes(name(p.name));
                            const keys: Record<MissingField, string> = { amountFen: 'amount_exact', occurredDate: 'date_exact', name: 'item_acceptable', categoryId: 'category_exact' };
                            add(keys[f], Number(correct), 1);
                            if (f === 'occurredDate')
                                add('time_precision_exact', Number(detected && p.occurredDate === l.value.occurredDate && p.occurredTime === l.value.occurredTime && p.timePrecision === l.value.timePrecision), 1);
                        }
                        else if (fact.status === 'unknown') {
                            const hit = !!detected && p[f] === null && p.missingFields.includes(f);
                            add(`missing_recall_${f}`, Number(hit), 1);
                            add(`unknown_fill_rate_${f}`, Number(detected && p[f] !== null), 1);
                        }
                    }
                    if (scene === 'all' && l.facts.categoryId.status === 'known') {
                        const key = `${kind}:${l.value.categoryId}->${detected ? p.categoryId ?? 'null' : 'missed'}`;
                        confusion[key] = (confusion[key] ?? 0) + 1;
                    }
                }
                for (const l of labels.filter(l => l.value.transactionKind !== 'expense')) {
                    const p = matched(alignment, s, r, l);
                    if (l.value.transactionKind === null) {
                        unknownStatus++;
                        add('unknown_status_warning_recall', Number(p?.transactionKind === null && p.warnings.length > 0), 1);
                        continue;
                    }
                    nonexpense++;
                    const hit = p?.transactionKind === l.value.transactionKind && p.warnings.some(w => w.code === 'NON_EXPENSE');
                    add('non_expense_recall', Number(hit), 1);
                    add(`non_expense_recall_${l.value.transactionKind}`, Number(hit), 1);
                    add('non_expense_as_expense_rate', Number(p && possible(p)), 1);
                }
                if (labels.length === 0) {
                    add('empty_image_fp_rate', Number(ps.some(possible)), 1);
                    add('empty_completion_rate', Number(r?.status === 'completed'), 1);
                }
                for (const status of ['completed', 'failed', 'cancelled', 'unprocessed'])
                    add(status === 'completed' ? 'completion_rate' : `${status}_rate`, Number((r?.status ?? 'unprocessed') === status), 1);
            }
            add('transaction_precision', tp, tp + fp);
            add('transaction_recall', tp, tp + fn);
            add('transaction_f1', 2 * tp, 2 * tp + fp + fn);
            for (const prefix of ['missing_recall', 'missing_precision', 'unknown_fill_rate']) {
                const sum = FIELDS.reduce(([k, n], f) => { const x = c[`${prefix}_${f}`] ?? [0, 0]; return [k + x[0], n + x[1]]; }, [0, 0]);
                add(prefix, sum[0], sum[1]);
            }
            for (const f of FIELDS)
                for (const prefix of ['missing_recall', 'missing_precision', 'unknown_fill_rate'])
                    add(`${prefix}_${f}`, 0, 0);
            for (const key of ['amount_exact', 'date_exact', 'category_exact', 'item_acceptable', 'time_precision_exact', 'empty_image_fp_rate', 'empty_completion_rate', 'non_expense_recall', 'unknown_status_warning_recall', 'manual_edits_per_image', 'images_needing_edits'])
                add(key, 0, 0);
            const pools = run.pairPool.filter(p => ss.some(s => s.id === p.leftSample) && ss.some(s => s.id === p.rightSample));
            const detected = (p: Pair) => [[p.leftSample, p.leftLabel], [p.rightSample, p.rightLabel]].every(([sid, lid]) => {
                const s = ss.find(s => s.id === sid)!, l = s.labels!.find(l => l.labelId === lid)!;
                const proposal = matched(alignment, s, rs.find(r => r.sampleId === sid), l);
                return proposal && possible(proposal);
            });
            const dtp = pools.filter(p => p.positive && detected(p) && run.duplicatePredictions.includes(p.id)).length;
            const dfp = pools.filter(p => (!p.positive || !detected(p)) && run.duplicatePredictions.includes(p.id)).length;
            const dfn = pools.filter(p => p.positive).length - dtp;
            add('duplicate_precision', dtp, dtp + dfp);
            add('duplicate_recall', dtp, dtp + dfn);
            add('duplicate_f1', 2 * dtp, 2 * dtp + dfp + dfn);
            for (const [key, [k, n]] of Object.entries(c))
                metrics.push(metric(key, k, n, kind, scene, run.split, !key.endsWith('f1') && !key.startsWith('manual_')));
            const categoryCounts = v.categorySnapshot.map(category => ({ id: category.id, truth: ss.reduce((n, s) => n + (s.labels ?? []).filter(l => l.value.transactionKind === 'expense' && l.facts.categoryId.status === 'known' && l.value.categoryId === category.id).length, 0), predicted: rs.reduce((n, r) => n + r.predictions.filter(p => possible(p) && p.categoryId === category.id).length, 0) }));
            strata.push({ kind, scene, split: run.split, images: ss.length, groups: new Set(ss.map(s => v.groups[s.id])).size, expenses: tp + fn, nonexpense, unknownStatus, opportunities, categoryCounts, tp, fp, fn, pairs: { total: pools.length, positive: pools.filter(p => p.positive).length, negative: pools.filter(p => !p.positive).length, hardNegative: pools.filter(p => p.hardNegative).length } });
        }
    const latency = (status: string) => { const values = results.filter(r => r.status === status).map(r => r.durationMs).sort((a, b) => a - b); return { status, n: values.length, totalMs: values.reduce((s, x) => s + x, 0), meanMs: values.length ? values.reduce((s, x) => s + x, 0) / values.length : null, nearestRank: true, p50: values.length ? values[Math.ceil(.5 * values.length) - 1] : null, p95: values.length ? values[Math.ceil(.95 * values.length) - 1] : null }; };
    const usage = (field: 'promptTokens' | 'completionTokens' | 'totalTokens') => { const rr = results.filter(r => r.usage?.[field] !== null && r.usage?.[field] !== undefined); return { knownSum: rr.length ? rr.reduce((n, r) => n + r.usage![field]!, 0) : null, knownAttemptCount: rr.length, totalAttemptCount: results.reduce((n, r) => n + r.attempts, 0) }; };
    const valid = run.status === 'completed' && !run.invalidReason;
    return { schema: 'bk-evaluation-report.v1', frameworkStatus: run.scope === 'framework' && valid ? 'ran' : 'not_asserted', modelTrained: false, qualityConclusion: run.scope === 'framework' ? 'not_evaluated' : valid && !v.contaminated ? 'measured_experimental' : 'invalid',
        independentQualityPassed: false, limitations: ['未进行权重训练', '人工成本/实际费用未采集，N/A', 'Wilson区间未调整组内相关性', ...(v.exploratory ? ['小样本探索，不能宣称质量达标'] : []), ...(v.contaminated ? ['test已污染并退役'] : []), '场景可重叠；主场景计数单列', '固定全split重复对池；池外提示单列，未复核不报正式重复质量'],
        provenance: { datasetVersionId: v.id, manifestHash: v.manifestHash, categorySnapshotHash: v.categorySnapshotHash, synonymVersion: v.synonymVersion, promptVersion: run.promptVersion, promptHash: run.promptHash, runnerVersion: run.runnerVersion, runnerHash: run.runnerHash, appCommit: run.appCommit, adapterVersion: run.adapterVersion, requestedModel: run.requestedModel, actualModels: [...new Set(results.map(r => r.actualModel))], seed: run.seed, scope: run.scope, provider: run.provider, outputLevel: 'pipeline', timezone: 'Asia/Shanghai', alignmentHash: run.alignmentHash, alignmentReviewer: run.alignmentReviewer, pairPoolHash: hashPayload(run.pairPool), testLocked: v.testLocked, testContaminated: v.contaminated, split: run.split, acceptedAt: run.acceptedAt ?? run.startedAt, startedAt: run.startedAt, finishedAt: run.finishedAt, resultHash: hashPayload(results), specVersions: v.specVersions },
        planned: samples.length, completed: results.filter(r => r.status === 'completed').length, failed: results.filter(r => r.status === 'failed').length, cancelled: results.filter(r => r.status === 'cancelled').length, unprocessed: samples.length - results.filter(r => r.status !== 'unprocessed').length,
        primaryScenes: Object.fromEntries([...new Set(samples.map(s => s.primaryScene))].map(scene => [scene, samples.filter(s => s.primaryScene === scene).length])), strata, metrics, categoryConfusion: confusion,
        latency: [latency('completed'), latency('failed'), latency('cancelled')], latencyDefinition: 'per-image end-to-end from run acceptance, including queue; human review excluded', automaticRetries: 0, apiUsage: { input: usage('promptTokens'), output: usage('completionTokens'), total: usage('totalTokens') }, cost: { currency: 'CNY', actual: null, estimated: null }, humanReview: { collected: false, completedSessions: 0, activeMs: null }, outOfPoolDuplicatePredictions: run.duplicatePredictions.filter(id => !run.pairPool.some(p => p.id === id)) };
}
