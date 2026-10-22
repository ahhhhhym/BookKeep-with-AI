import { isPossibleDuplicate } from '../../../shared/duplicate';
import type { Alignment, DatasetVersion, EvaluationResult, Pair, Run } from '../../../shared/dataset';
import { hashPayload } from '../canonical';
/** Prediction-only detector. Ground truth and pair positivity are never inputs to the hint algorithm. */
export function duplicateHints(v: DatasetVersion, results: EvaluationResult[]): NonNullable<Run['duplicateOutput']> {
    const objects = results.filter(r => r.status === 'completed').flatMap(r => r.predictions.map((p, ordinal) => ({ sampleId: r.sampleId, p, ordinal })).filter(o => o.p.transactionKind === null || o.p.transactionKind === 'expense'));
    if (objects.length > 1000)
        throw new Error('DUPLICATE_OUTPUT_TOO_LARGE');
    const hints: NonNullable<Run['duplicateOutput']> = [];
    for (let i = 0; i < objects.length; i++)
        for (let j = i + 1; j < objects.length; j++) {
            const a = objects[i], b = objects[j];
            if (a.sampleId === b.sampleId)
                continue;
            const sa = v.samples.find(s => s.id === a.sampleId)!, sb = v.samples.find(s => s.id === b.sampleId)!;
            if (sa.preparedHash === sb.preparedHash || sa.originalHash === sb.originalHash || isPossibleDuplicate(a.p, b.p))
                hints.push({ leftSample: a.sampleId, leftOrdinal: a.ordinal, rightSample: b.sampleId, rightOrdinal: b.ordinal });
        }
    return hints;
}
export function mapHints(hints: NonNullable<Run['duplicateOutput']>, alignment: Alignment[], pool: Pair[]): string[] {
    return [...new Set(hints.map(h => {
            const left = alignment.find(a => a.sampleId === h.leftSample && a.predictionOrdinal === h.leftOrdinal), right = alignment.find(a => a.sampleId === h.rightSample && a.predictionOrdinal === h.rightOrdinal);
            const pair = left && right ? pool.find(p => p.leftSample === left.sampleId && p.leftLabel === left.labelId && p.rightSample === right.sampleId && p.rightLabel === right.labelId || p.rightSample === left.sampleId && p.rightLabel === left.labelId && p.leftSample === right.sampleId && p.leftLabel === right.labelId) : null;
            return pair?.id ?? 'outside:' + hashPayload(h);
        }))];
}
