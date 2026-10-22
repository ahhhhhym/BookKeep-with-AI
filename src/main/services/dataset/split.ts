import type { Sample, Split } from '../../../shared/dataset';
import { hashPayload } from '../canonical';
/** Conservative connected components: uncertain/manual relations also stay in one split. */
export function groupSamples(samples: Sample[]): Record<string, string> {
    const parent = new Map(samples.map(s => [s.id, s.id]));
    const root = (id: string): string => { const p = parent.get(id)!; return p === id ? id : root(p); };
    const join = (a: string, b: string): void => { const x = root(a), y = root(b); if (x !== y)
        parent.set(x < y ? y : x, x < y ? x : y); };
    const owners = new Map<string, string>();
    for (const s of samples)
        for (const key of [`prepared:${s.preparedHash}`, `original:${s.originalHash}`, ...s.relations.map(r => `relation:${r}`), ...(s.labels ?? []).map(l => `transaction:${l.transactionId}`)]) {
            const old = owners.get(key);
            if (old)
                join(s.id, old);
            else
                owners.set(key, s.id);
        }
    return Object.fromEntries(samples.map(s => [s.id, root(s.id)]));
}
export function splitSamples(samples: Sample[], seed: number, locked: Record<string, Split> = {}): {
    groups: Record<string, string>;
    splits: Record<string, Split>;
    exploratory: boolean;
} {
    const groups = groupSamples(samples), splits: Record<string, Split> = {};
    const all = new Map<string, Sample[]>();
    for (const s of samples)
        all.set(groups[s.id], [...(all.get(groups[s.id]) ?? []), s]);
    // Relations found after locking cannot silently move previously seen development samples to test.
    for (const group of all.values()) {
        const old = new Set(group.map(s => locked[s.id]).filter(Boolean));
        if (old.has('test') && (old.has('train') || old.has('dev')))
            throw new Error('SPLIT_LEAKAGE');
    }
    let exploratory = false;
    for (const kind of ['real', 'synthetic'] as const) {
        const subset = samples.filter(s => s.kind === kind);
        const components = [...all.entries()].filter(([, ss]) => ss.some(s => s.kind === kind));
        if (components.some(([, ss]) => ss.some(s => s.kind !== kind)))
            throw new Error('MIXED_KIND_GROUP');
        const small = subset.length < 50 || components.length < 10;
        if (subset.length && small)
            exploratory = true;
        const order: Split[] = small ? ['train', 'dev'] : ['train', 'dev', 'test'];
        const targets = { train: subset.length * .7, dev: subset.length * (small ? .3 : .15), test: subset.length * (small ? 0 : .15) };
        const counts = { train: 0, dev: 0, test: 0 };
        const sorted = components.sort((a, b) => b[1].length - a[1].length || hashPayload({ seed, groupId: a[0] }).localeCompare(hashPayload({ seed, groupId: b[0] })));
        for (const [, ss] of sorted)
            if (ss.some(s => locked[s.id] === 'test')) {
                for (const s of ss)
                    splits[s.id] = 'test';
                counts.test += ss.length;
            }
        for (const [, ss] of sorted) {
            if (splits[ss[0].id])
                continue;
            let best: Split = order[0], score = Infinity;
            for (const split of order) {
                const next = { ...counts, [split]: counts[split] + ss.length };
                const err = (['train', 'dev', 'test'] as const).reduce((sum, k) => sum + (next[k] - targets[k]) ** 2, 0);
                if (err < score) {
                    score = err;
                    best = split;
                }
            }
            for (const s of ss)
                splits[s.id] = best;
            counts[best] += ss.length;
        }
        if (subset.length && (counts.train === 0 || counts.dev === 0 || counts.test === 0 || new Set(subset.filter(s => splits[s.id] === 'test').map(s => groups[s.id])).size < 10))
            exploratory = true;
    }
    return { groups, splits, exploratory };
}
