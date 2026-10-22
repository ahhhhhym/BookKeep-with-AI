/** Single-writer, atomic dataset snapshots outside ledger generations. Never opens a personal directory. */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, type ErrorCode } from '../../../shared/errors';
import { DATASET_SCHEMA, DATASET_NOTICE, validateLabels, validDatasetCommand, type DatasetCommand, type DatasetConsent, type DatasetRead, type DatasetSummary, type DatasetVersion, type Run, type Sample, type Split, type Rights, type Purpose } from '../../../shared/dataset';
import type { Proposal } from '../../../shared/candidate';
import { canonicalJson, hashPayload } from '../canonical';
import { splitSamples, groupSamples } from './split';
import { pairPool, score } from './metrics';
import { duplicateHints, mapHints } from './duplicates';
import { promptConfig } from './prompt';
import { attemptsOnError, metadataOnError, normalizedPredictions, type EvaluationProvider } from './provider';
type ExportRecord = {
    id: string;
    versionId: string;
    manifestHash: string;
    includeImages: boolean;
    purpose: Purpose;
    recipient: string;
    status: 'completed' | 'withdrawn';
    sampleIds: string[];
    files: {
        path: string;
        sha256: string;
        bytes: number;
    }[];
};
type PreparedRecord = {
    id: string;
    versionId: string;
    exportId: string;
    manifestHash: string;
    files: {
        path: string;
        sha256: string;
        bytes: number;
    }[];
};
type Tombstone = {
    id: string;
    sampleId: string;
    preparedHash: string;
    versionHashes: string[];
    localDeleted: boolean;
    backupStatus: 'not_in_ledger_backups';
    externalCopies: 'unknown' | 'none';
    createdAt: string;
};
interface State {
    schema: 'bk-dataset-store.v1';
    revision: number;
    ledgerId: string;
    epoch: string;
    consents: DatasetConsent[];
    samples: Record<string, Sample[]>;
    versions: DatasetVersion[];
    runs: Run[];
    exports: ExportRecord[];
    receipts: Record<string, {
        hash: string;
        result: unknown;
    }>;
    locked: Record<string, Split>;
    lockHashes: Record<string, Split>;
    retiredTestHashes: string[];
    lockRelations: Record<string, Split>;
    prepared: PreparedRecord[];
}
export interface DatasetEnvironment {
    root: string;
    ledgerId: () => string;
    epoch: () => string;
    categories: () => {
        id: string;
        name: string;
    }[];
    image: (id: string, hash: string) => {
        bytes: Buffer;
        originalHash: string;
    };
    prediction: (jobId: string, imageId: string, hash: string) => {
        proposals: Proposal[];
        metadata: Record<string, unknown>;
    };
    provider: (id: 'mock' | 'deepseek', fixture: string | null) => EvaluationProvider;
    runnerHash: string;
    appCommit: string;
    clock?: () => number;
}
export const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const copy = <T>(v: T): T => structuredClone(v);
function error(code: ErrorCode, reason?: string): never { throw new AppError(code, { details: reason ? { reason } : {} }); }
function atomic(file: string, bytes: Buffer | string): void {
    const tmp = file + '.pending';
    const fd = openSync(tmp, 'w', 0o600);
    try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(tmp, file);
}
export class DatasetService {
    private state: State;
    private tombstones: Tombstone[];
    private controllers = new Map<string, AbortController>();
    private acceptedTicks = new Map<string, number>();
    private readonly root: string;
    private readonly stateFile: string;
    private readonly withdrawalFile: string;
    private readonly clock: () => number;
    private closed = false;
    constructor(private readonly env: DatasetEnvironment) {
        if (!/^[a-f0-9-]{36}$/.test(env.ledgerId()))
            error('DATASET_INVALID');
        this.root = path.join(env.root, 'datasets', env.ledgerId());
        this.stateFile = path.join(this.root, 'state.json');
        this.withdrawalFile = path.join(this.root, 'withdrawals.json');
        this.clock = env.clock ?? Date.now;
        mkdirSync(this.root, { recursive: true });
        this.safe(this.root);
        this.tombstones = existsSync(this.withdrawalFile) ? JSON.parse(readFileSync(this.withdrawalFile, 'utf8')) : [];
        this.state = existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) : { schema: 'bk-dataset-store.v1', revision: 0, ledgerId: env.ledgerId(), epoch: env.epoch(), consents: [], samples: {}, versions: [], runs: [], exports: [], receipts: {}, locked: {}, lockHashes: {}, retiredTestHashes: [], lockRelations: {}, prepared: [] };
        if (this.state.schema !== 'bk-dataset-store.v1' || this.state.ledgerId !== env.ledgerId() || !Array.isArray(this.tombstones))
            error('RECOVERY_REQUIRED');
        for (const run of this.state.runs)
            if (run.status === 'queued' || run.status === 'processing') {
                run.status = 'failed';
                run.invalidReason = 'INTERRUPTED';
                run.finishedAt = this.now();
            }
        for (const t of this.tombstones)
            this.purge(t);
        // Old grants remain auditable but never become effective under a new ledger dataEpoch.
        this.state.epoch = env.epoch();
        this.persist();
        this.sweep();
    }
    private now() { return new Date(this.clock()).toISOString(); }
    private safe(file: string): string {
        const absolute = path.resolve(file), base = path.resolve(this.root);
        if (absolute !== base && !absolute.startsWith(base + path.sep))
            error('PERMISSION_DENIED');
        const storage = path.resolve(this.env.root);
        let walk = absolute;
        while (walk.startsWith(storage)) {
            if (existsSync(walk) && lstatSync(walk).isSymbolicLink())
                error('PERMISSION_DENIED');
            if (walk === storage)
                break;
            walk = path.dirname(walk);
        }
        return absolute;
    }
    private file(...parts: string[]) { return this.safe(path.join(this.root, ...parts)); }
    private persist() { atomic(this.stateFile, canonicalJson(this.state)); }
    private current() { if (this.closed)
        error('STATE_CONFLICT'); if (this.env.ledgerId() !== this.state.ledgerId)
        error('STALE_EPOCH'); if (this.state.epoch !== this.env.epoch()) {
        this.shutdownRuns('STALE_EPOCH');
        this.state.epoch = this.env.epoch();
        this.persist();
    } }
    private head(image: string, purpose: 'dataset' | 'recognition') { return this.state.consents.filter(c => c.imageAssetId === image && c.purpose === purpose).at(-1) ?? null; }
    private rightsValid(rights: Rights, purpose?: Purpose) { return rights.licenseStatus === 'allowed' && rights.redactionStatus === 'approved' && Date.parse(rights.retainUntil) > this.clock() && Date.parse(rights.reviewAt) > this.clock() && (!purpose || rights.purposes.includes(purpose)); }
    private authorized(s: Sample, purpose?: Purpose) {
        if (this.tombstones.some(t => t.sampleId === s.id || t.preparedHash === s.preparedHash))
            error('DATASET_WITHDRAWN');
        const c = this.head(s.imageAssetId, 'dataset');
        if (!c || c.id !== s.consentId || c.decision !== 'grant' || c.epoch !== this.env.epoch() || c.preparedHash !== s.preparedHash || !c.rights || hashPayload(c.rights) !== hashPayload(s.rights))
            error('CONSENT_REQUIRED');
        if (!this.rightsValid(s.rights, purpose))
            error('LICENCE_REQUIRED');
    }
    private latest(id: string) { const s = this.state.samples[id]?.at(-1); if (!s)
        error(this.tombstones.some(t => t.sampleId === id) ? 'DATASET_WITHDRAWN' : 'NOT_FOUND'); return s; }
    private version(id: string) { const v = this.state.versions.find(v => v.id === id); if (!v)
        error('NOT_FOUND'); if (v.status !== 'active')
        error(v.status === 'withdrawn' ? 'DATASET_WITHDRAWN' : 'DATASET_INVALID'); for (const s of v.samples)
        this.authorized(s); if (hashPayload(this.manifest(v)) !== v.manifestHash)
        error('HASH_MISMATCH'); return v; }
    private image(s: Sample) { const bytes = readFileSync(this.file('images', s.preparedHash + '.png')); if (bytesHash(bytes) !== s.preparedHash)
        error('HASH_MISMATCH'); return bytes; }
    private sweep() {
        let changed = false;
        for (const s of Object.values(this.state.samples).map(h => h.at(-1)!))
            if (!this.rightsValid(s.rights)) {
                this.withdraw(s.id, 'expired');
                changed = true;
            }
        if (changed) {
            this.state.revision++;
            this.persist();
        }
    }
    read(input: DatasetRead): unknown {
        this.current();
        this.sweep();
        if (input.kind === 'summary')
            return this.summary();
        if (input.kind === 'sample') {
            const s = this.latest(input.id!);
            if (this.state.locked[s.id] === 'test')
                error('DATASET_LOCKED');
            return copy({ sample: s, history: this.state.samples[s.id] });
        }
        if (input.kind === 'version') {
            const v = this.version(input.id!);
            return copy({ ...v, samples: v.samples.map(s => ({ id: s.id, version: s.version, kind: s.kind, imageAssetId: s.imageAssetId, preparedHash: s.preparedHash, primaryScene: s.primaryScene })), synonyms: undefined });
        }
        const r = this.state.runs.find(r => r.id === input.id);
        if (!r)
            error('NOT_FOUND');
        if (input.kind === 'blinded') {
            const v = this.version(r.datasetVersionId);
            if (r.split === 'test' && r.intent !== 'final')
                error('DATASET_LOCKED');
            return { runId: r.id, pairPool: r.pairPool.map(({ positive: _p, hardNegative: _h, ...pair }) => pair), results: r.results.map(result => ({ sampleId: result.sampleId, status: result.status, predictions: result.predictions.map((p, ordinal) => ({ ordinal, evidence: p.evidence.map(e => ({ region: e.region, field: e.field })) })) })), labels: v.samples.filter(s => v.splits[s.id] === r.split).map(s => ({ sampleId: s.id, labels: s.labels!.map(l => ({ labelId: l.labelId, ordinal: l.ordinal, regions: l.value.evidence.map(e => e.region) })) })) };
        }
        return copy(r.split === 'test' ? { ...r, results: r.results.map(({ predictions: _p, ...safe }) => safe), pairPool: r.pairPool.map(({ positive: _p, hardNegative: _h, ...safe }) => safe), duplicatePredictions: [], alignment: null } : r);
    }
    summary(): DatasetSummary {
        return copy({ samples: Object.values(this.state.samples).map(h => { const s = h.at(-1)!; return { id: s.id, version: s.version, kind: s.kind, primaryScene: s.primaryScene, reviewStatus: s.reviewStatus, preparedHash: s.preparedHash, consentId: s.consentId }; }), versions: this.state.versions.map(v => ({ id: v.id, tag: v.tag, manifestHash: v.manifestHash, status: v.status, exploratory: v.exploratory, contaminated: v.contaminated })), runs: this.state.runs.map(r => ({ id: r.id, status: r.status, scope: r.scope, provider: r.provider, report: r.report })), consents: this.state.consents, withdrawals: this.tombstones.map(t => ({ ...t, preparedHash: undefined })), exports: this.state.exports.map(e => ({ id: e.id, versionId: e.versionId, status: e.status, recipient: e.recipient, manifestHash: e.manifestHash })), revision: this.state.revision, trainingSubmitSupported: false, trained: false });
    }
    command(input: DatasetCommand, mutationId: string): unknown {
        this.current();
        this.sweep();
        if (!validDatasetCommand(input))
            error('PAYLOAD_INVALID');
        if (input.op === 'validate' || input.op === 'validatePrepared')
            return copy(this.apply(input));
        const digest = hashPayload(input), old = this.state.receipts[mutationId];
        if (old) {
            if (old.hash !== digest)
                error('IDEMPOTENCY_CONFLICT');
            if (input.op === 'export' || input.op === 'prepare') {
                const result = old.result as {
                    artifactId: string;
                };
                this.checkArtifact(result.artifactId);
            }
            return copy(old.result);
        }
        // Failed mutations must not leave half-updated in-memory state.
        const before = copy(this.state);
        try {
            const result = this.apply(input);
            this.state.revision++;
            this.state.receipts[mutationId] = { hash: digest, result: copy(result) };
            this.persist();
            return copy(result);
        }
        catch (e) {
            this.state = before;
            for (const t of this.tombstones)
                this.purge(t);
            this.persist();
            throw e;
        }
    }
    private apply(c: DatasetCommand): unknown {
        switch (c.op) {
            case 'consent': {
                const old = this.head(c.imageAssetId, c.purpose);
                if ((old?.id ?? null) !== c.supersedesId)
                    error('VERSION_CONFLICT');
                if (c.decision === 'grant') {
                    this.env.image(c.imageAssetId, c.preparedHash);
                    if (c.purpose === 'dataset' && (!c.rights || !this.rightsValid(c.rights)))
                        error('LICENCE_REQUIRED');
                    if (c.purpose === 'recognition' && !c.runManifestHash)
                        error('CONSENT_REQUIRED');
                }
                const scopeHash = hashPayload({ imageAssetId: c.imageAssetId, preparedHash: c.preparedHash, purpose: c.purpose, rights: c.rights, runManifestHash: c.runManifestHash, noticeVersion: c.noticeVersion, epoch: this.env.epoch() });
                const record: DatasetConsent = { ...c, id: randomUUID(), epoch: this.env.epoch(), createdAt: this.now(), scopeHash };
                this.state.consents.push(record);
                if (c.decision === 'withdraw') {
                    if (c.purpose === 'dataset') {
                        for (const s of Object.values(this.state.samples).map(h => h.at(-1)!))
                            if (s.imageAssetId === c.imageAssetId)
                                this.withdraw(s.id, 'consent_withdrawn');
                    }
                    else
                        this.shutdownRuns('CONSENT_REQUIRED');
                }
                return { consentId: record.id, scopeHash };
            }
            case 'register': {
                const consent = this.head(c.imageAssetId, 'dataset');
                if (!consent || consent.id !== c.consentId || !consent.rights)
                    error('CONSENT_REQUIRED');
                if (Object.values(this.state.samples).some(h => h.at(-1)!.preparedHash === c.preparedHash))
                    error('DATASET_INVALID', 'DUPLICATE_IMAGE');
                const image = this.env.image(c.imageAssetId, c.preparedHash);
                const prediction = c.predictionJobId ? this.env.prediction(c.predictionJobId, c.imageAssetId, c.preparedHash) : null;
                const s: Sample = { id: randomUUID(), version: 1, kind: c.kind, imageAssetId: c.imageAssetId, preparedHash: c.preparedHash, originalHash: image.originalHash, byteSize: image.bytes.length, consentId: consent.id, rights: copy(consent.rights), relations: copy(c.relations), primaryScene: c.primaryScene, secondaryScenes: copy(c.secondaryScenes), labels: null, annotator: null, reviewer: null, reviewMode: null, reviewedAt: null, reviewStatus: 'unlabelled', predictionJobId: c.predictionJobId, predictionAvailable: prediction !== null, prediction: prediction?.proposals ?? [], predictionMetadata: prediction?.metadata ?? null, previousVersion: null, reason: 'registered', createdAt: this.now() };
                this.authorized(s);
                if (bytesHash(image.bytes) !== s.preparedHash)
                    error('HASH_MISMATCH');
                mkdirSync(this.file('images'), { recursive: true });
                atomic(this.file('images', s.preparedHash + '.png'), image.bytes);
                this.state.samples[s.id] = [s];
                return { sampleId: s.id, version: 1 };
            }
            case 'label': {
                const prior = this.latest(c.id);
                this.authorized(prior);
                if (prior.version !== c.expectedVersion)
                    error('VERSION_CONFLICT');
                if (this.state.locked[c.id] === 'test') {
                    if (!c.correctionOfLockedTest || !c.reviewer)
                        error('DATASET_LOCKED');
                    for (const v of this.state.versions)
                        if (v.samples.some(s => s.id === c.id)) {
                            v.status = 'invalid';
                            for (const r of this.state.runs.filter(r => r.datasetVersionId === v.id)) {
                                this.controllers.get(r.id)?.abort();
                                if (r.status === 'queued' || r.status === 'processing') {
                                    r.status = 'cancelled';
                                    r.finishedAt = this.now();
                                }
                                r.invalidReason = 'TEST_LABEL_CORRECTED';
                                r.report = null;
                            }
                        }
                }
                let labels;
                try {
                    labels = validateLabels(c.labels, this.env.categories().map(x => x.id));
                }
                catch (e) {
                    error('DATASET_INVALID', e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'BAD_LABEL');
                }
                if (c.reviewer && ((c.reviewer === c.annotator) !== (c.reviewMode === 'same_person') || c.reviewMode === null))
                    error('DATASET_INVALID', 'REVIEW_IDENTITY');
                if (c.reviewer === c.annotator && (prior.reviewStatus !== 'labelled' || prior.annotator!==c.annotator || hashPayload(labels)!==hashPayload(prior.labels)))
                    error('DATASET_INVALID', 'SECOND_REVIEW_REQUIRED');
                const next: Sample = { ...copy(prior), version: prior.version + 1, previousVersion: prior.version, labels, annotator: c.annotator, reviewer: c.reviewer, reviewMode: c.reviewMode, reviewedAt: c.reviewer ? this.now() : null, reviewStatus: c.reviewer ? 'reviewed' : 'labelled', reason: c.reason, createdAt: this.now() };
                this.state.samples[c.id].push(next);
                return { sampleId: c.id, version: next.version };
            }
            case 'link': {
                for (const id of c.ids) {
                    const s = this.latest(id);
                    this.authorized(s);
                    this.state.samples[id].push({ ...copy(s), version: s.version + 1, previousVersion: s.version, relations: [...new Set([...s.relations, c.relation])], reason: c.reason, createdAt: this.now() });
                }
                const all = Object.values(this.state.samples).map(h => h.at(-1)!), groups = groupSamples(all);
                let leak = false;
                for (const group of new Set(Object.values(groups))) {
                    const splits = new Set(all.filter(s => groups[s.id] === group).map(s => this.state.locked[s.id]).filter(Boolean));
                    if (splits.has('test') && (splits.has('train') || splits.has('dev')))
                        leak = true;
                }
                if (leak) {
                    for (const v of this.state.versions) {
                        v.status = 'invalid';
                        for (const r of this.state.runs.filter(r => r.datasetVersionId === v.id)) {
                            this.controllers.get(r.id)?.abort();
                            if (r.status === 'queued' || r.status === 'processing') {
                                r.status = 'cancelled';
                                r.finishedAt = this.now();
                            }
                            r.invalidReason = 'SPLIT_LEAKAGE';
                            r.report = null;
                        }
                    }
                }
                return { linked: c.ids, leakage: leak };
            }
            case 'version': {
                if (this.state.versions.some(v => v.tag === c.tag))
                    error('VERSION_CONFLICT');
                const samples = c.sampleIds.map(id => copy(this.latest(id))).sort((a, b) => a.id.localeCompare(b.id));
                for (const s of samples) {
                    this.authorized(s);
                    this.image(s);
                    if (s.labels === null || s.reviewStatus !== 'reviewed')
                        error('DATASET_INVALID', 'HUMAN_REVIEW_REQUIRED');
                    validateLabels(s.labels, this.env.categories().map(x => x.id));
                }
                // A subset version may not sever a known connected component.
                const all = Object.values(this.state.samples).map(h => h.at(-1)!), allGroups = groupSamples(all);
                for (const s of samples)
                    if (all.some(a => allGroups[a.id] === allGroups[s.id] && !c.sampleIds.includes(a.id)))
                        error('DATASET_INVALID', 'PARTIAL_GROUP');
                const locked = { ...this.state.locked };
                for (const s of samples)
                    if (this.state.lockHashes[s.preparedHash] === 'test' || this.state.lockHashes[s.originalHash] === 'test' || this.relationKeys(s).some(k => this.state.lockRelations[k] === 'test'))
                        locked[s.id] = 'test';
                let allocated;
                try {
                    allocated = splitSamples(samples, c.seed, locked);
                }
                catch {
                    error('SPLIT_LEAKAGE');
                }
                const categorySnapshot = copy(this.env.categories());
                const v: DatasetVersion = { id: randomUUID(), tag: c.tag, manifestHash: '', ...allocated, seed: c.seed, algorithm: 'group-sse.v1', samples, categorySnapshot, categorySnapshotHash: hashPayload(categorySnapshot), synonyms: copy(c.synonyms), synonymVersion: c.synonymVersion, testLocked: true, contaminated: samples.some(s => this.state.retiredTestHashes.includes(s.preparedHash)), status: 'active', epoch: this.env.epoch(), specVersions: { dataset: 'dataset-spec.v1', evaluation: 'evaluation-spec.v1', schema: DATASET_SCHEMA, label: 'label-policy.v1' }, createdAt: this.now() };
                v.manifestHash = hashPayload(this.manifest(v));
                for (const s of samples) {
                    this.state.locked[s.id] = v.splits[s.id];
                    this.state.lockHashes[s.preparedHash] = v.splits[s.id];
                    this.state.lockHashes[s.originalHash] = v.splits[s.id];
                    for (const key of this.relationKeys(s))
                        this.state.lockRelations[key] = v.splits[s.id];
                }
                this.state.versions.push(v);
                return { versionId: v.id, manifestHash: v.manifestHash, exploratory: v.exploratory };
            }
            case 'validate': return this.validate(this.version(c.versionId));
            case 'reauthorize': {
                const s = this.latest(c.sampleId);
                if (s.version !== c.expectedVersion)
                    error('VERSION_CONFLICT');
                const consent = this.head(s.imageAssetId, 'dataset');
                if (!consent || consent.id !== c.consentId || !consent.rights)
                    error('CONSENT_REQUIRED');
                const next = { ...copy(s), version: s.version + 1, previousVersion: s.version, consentId: consent.id, rights: copy(consent.rights), reason: 'explicit_reauthorization', createdAt: this.now() };
                this.authorized(next);
                this.image(next);
                this.state.samples[s.id].push(next);
                return { sampleId: s.id, version: next.version };
            }
            case 'validatePrepared': {
                const p = this.state.prepared.find(p => p.id === c.artifactId && p.versionId === c.versionId && p.manifestHash === c.manifestHash);
                if (!p)
                    error('DATASET_INVALID');
                this.version(c.versionId);
                this.checkArtifact(p.id);
                return { valid: true, scope: 'prepared_structure_and_authorization', qualityPassed: false, totalIssueCount: 0, manifestHash: p.manifestHash };
            }
            case 'export': return this.exportVersion(c);
            case 'prepare': {
                const v = this.version(c.versionId), e = this.state.exports.find(e => e.id === c.exportId && e.versionId === v.id && e.status === 'completed');
                if (!e || e.purpose !== 'future_training')
                    error('CONSENT_REQUIRED');
                if (!e.includeImages)
                    error('DATASET_INVALID', 'PREPARED_IMAGES_REQUIRED');
                for (const s of v.samples.filter(s => e.sampleIds.includes(s.id)))
                    this.authorized(s, 'future_training');
                this.checkArtifact(e.id);
                const id = hashPayload({ manifestHash: e.manifestHash, adapter: c.adapterVersion });
                const file = this.file('artifacts', id);
                mkdirSync(file, { recursive: true });
                const selected = v.samples.filter(s => e.sampleIds.includes(s.id));
                const artifact = { format: 'bk-training-prepared.v1', adapter: c.adapterVersion, exportManifestHash: e.manifestHash, datasetVersionId: v.id, samples: selected.length, groups: new Set(selected.map(s => v.groups[s.id])).size, kindCounts: { real: selected.filter(s => s.kind === 'real').length, synthetic: selected.filter(s => s.kind === 'synthetic').length }, weights: null, modelTrained: false };
                const files: PreparedRecord['files'] = [];
                for (const f of e.files.filter(f => f.path.startsWith('images/'))) {
                    const bytes = readFileSync(this.file('artifacts', e.id, f.path));
                    mkdirSync(path.dirname(path.join(file, f.path)), { recursive: true });
                    atomic(path.join(file, f.path), bytes);
                    files.push(copy(f));
                }
                const rows = selected.map(s => canonicalJson({ format: 'bk-training-example.v1', sampleId: s.id, sampleVersion: s.version, kind: s.kind, split: v.splits[s.id], group: v.groups[s.id], image: `images/${s.preparedHash}.png`, preparedHash: s.preparedHash, labels: s.labels, predictionsAreNotLabels: true })).join('\n') + '\n';
                atomic(path.join(file, 'training.jsonl'), rows);
                files.push({ path: 'training.jsonl', sha256: bytesHash(Buffer.from(rows)), bytes: Buffer.byteLength(rows) });
                const metadata = canonicalJson({ ...artifact, files });
                atomic(path.join(file, 'prepared.json'), metadata);
                files.push({ path: 'prepared.json', sha256: bytesHash(Buffer.from(metadata)), bytes: Buffer.byteLength(metadata) });
                const prepared = { id, versionId: v.id, exportId: e.id, manifestHash: e.manifestHash, files };
                this.state.prepared = this.state.prepared.filter(p => p.id !== id);
                this.state.prepared.push(prepared);
                this.checkArtifact(id);
                return { artifactId: id, ...artifact, validation: { valid: true, scope: 'prepared_structure_and_authorization', qualityPassed: false } };
            }
            case 'submit':
            case 'trainingStatus':
                this.version(c.versionId);
                return error('UNSUPPORTED', 'unsupported');
            case 'evaluate': return this.startRun(c);
            case 'align': {
                const run = this.state.runs.find(r => r.id === c.runId);
                if (!run)
                    error('NOT_FOUND');
                const v = this.version(run.datasetVersionId);
                if (run.status !== 'completed' || run.invalidReason || run.alignment !== null)
                    error('STATE_CONFLICT');
                if (c.duplicatePredictions.length)
                    error('DATASET_INVALID', 'DUPLICATE_HINTS_ARE_RUNNER_OWNED');
                const ps = new Set<string>(), ls = new Set<string>();
                for (const a of c.alignment) {
                    const s = v.samples.find(s => s.id === a.sampleId), r = run.results.find(r => r.sampleId === a.sampleId);
                    if (!s || !s.labels?.some(l => l.labelId === a.labelId) || !r || a.predictionOrdinal >= r.predictions.length || ps.has(`${a.sampleId}:${a.predictionOrdinal}`) || ls.has(`${a.sampleId}:${a.labelId}`))
                        error('DATASET_INVALID', 'ALIGNMENT_NOT_ONE_TO_ONE');
                    ps.add(`${a.sampleId}:${a.predictionOrdinal}`);
                    ls.add(`${a.sampleId}:${a.labelId}`);
                }
                run.alignment = copy(c.alignment);
                run.alignmentHash = hashPayload(c.alignment);
                run.alignmentReviewer = c.reviewer;
                run.duplicatePredictions = mapHints(run.duplicateOutput ?? [], run.alignment, run.pairPool);
                run.report = score(v, run);
                return { runId: run.id, report: run.report };
            }
            case 'cancel': {
                const r = this.state.runs.find(r => r.id === c.runId);
                if (!r)
                    error('NOT_FOUND');
                if (r.status !== 'queued' && r.status !== 'processing')
                    error('STATE_CONFLICT');
                this.controllers.get(r.id)?.abort();
                r.status = 'cancelled';
                r.invalidReason = 'CANCELLED';
                r.finishedAt = this.now();
                r.report = null;
                return { runId: r.id, status: r.status };
            }
            case 'contaminate': {
                const v = this.version(c.versionId);
                v.contaminated = true;
                for (const s of v.samples.filter(s => v.splits[s.id] === 'test'))
                    this.state.retiredTestHashes.push(s.preparedHash);
                for (const r of this.state.runs.filter(r => r.datasetVersionId === v.id)) {
                    r.invalidReason = 'TEST_CONTAMINATED';
                    r.report = null;
                    this.controllers.get(r.id)?.abort();
                    if (r.status === 'queued' || r.status === 'processing') {
                        r.status = 'cancelled';
                        r.finishedAt = this.now();
                    }
                }
                return { versionId: v.id, contaminated: true };
            }
            case 'withdraw': return this.withdraw(c.sampleId, c.reason);
        }
    }
    private publicSample(s: Sample) { const { originalHash: _o, rights: _rights, annotator: _a, reviewer: _r, predictionMetadata: _pm, ...safe } = s; return { ...safe, license: { status: 'allowed', purposes: s.rights.purposes, recipients: s.rights.recipients, retainUntil: s.rights.retainUntil }, redactionStatus: s.rights.redactionStatus }; }
    private manifest(v: DatasetVersion, selected: Sample[] = v.samples) {
        return { format: 'bk-dataset-manifest.v1', specVersions: v.specVersions, datasetVersionId: v.id, categorySnapshot: v.categorySnapshot, categorySnapshotHash: v.categorySnapshotHash, synonyms: v.synonyms, synonymVersion: v.synonymVersion, seed: v.seed, algorithm: v.algorithm, testLocked: v.testLocked,
            samples: selected.map(s => ({ sampleId: s.id, version: s.version, kind: s.kind, preparedHash: s.preparedHash, byteSize: s.byteSize, group: v.groups[s.id], split: v.splits[s.id], labelHash: hashPayload(s.labels), predictionHash: hashPayload(s.prediction), consentId: s.consentId, scopeHash: this.state.consents.find(c => c.id === s.consentId)?.scopeHash ?? null, noticeVersion: DATASET_NOTICE, licensePurposes: s.rights.purposes, redactionStatus: s.rights.redactionStatus, reviewStatus: s.reviewStatus })).sort((a, b) => a.sampleId.localeCompare(b.sampleId)) };
    }
    private validate(v: DatasetVersion) {
        const errors: {
            sampleId: string;
            code: string;
        }[] = [];
        for (const s of v.samples)
            try {
                this.authorized(s);
                this.image(s);
                validateLabels(s.labels, v.categorySnapshot.map(c => c.id));
            }
            catch (e) {
                errors.push({ sampleId: s.id, code: e instanceof AppError ? e.code : 'DATASET_INVALID' });
            }
        if (hashPayload(this.manifest(v)) !== v.manifestHash)
            errors.push({ sampleId: 'version', code: 'HASH_MISMATCH' });
        return { valid: errors.length === 0, scope: 'structural_and_authorization', qualityPassed: false, errors: errors.slice(0, 1000), totalIssueCount: errors.length, sampleCount: v.samples.length, groupCount: new Set(Object.values(v.groups)).size, manifestHash: v.manifestHash, datasetRevision: this.state.revision };
    }
    private exportVersion(c: Extract<DatasetCommand, {
        op: 'export';
    }>) {
        const v = this.version(c.versionId);
        if (v.contaminated)
            error('DATASET_LOCKED');
        const selected = c.sampleIds ? v.samples.filter(s => c.sampleIds!.includes(s.id)) : v.samples;
        if (!selected.length || (c.sampleIds && selected.length !== c.sampleIds.length))
            error('DATASET_INVALID');
        for (const s of selected) {
            this.authorized(s, c.purpose);
            if (!s.rights.recipients.includes(c.recipient) || c.includeImages && !s.rights.allowImages)
                error('LICENCE_REQUIRED');
            if (v.samples.some(o => v.groups[o.id] === v.groups[s.id] && !selected.some(s => s.id === o.id)))
                error('DATASET_INVALID', 'PARTIAL_GROUP');
            // Locked test cannot become a development export, few-shot set or training artifact.
            if (v.splits[s.id] === 'test')
                error('DATASET_LOCKED');
        }
        const id = randomUUID(), dir = this.file('artifacts', id);
        mkdirSync(dir, { recursive: true });
        const subset = selected.length !== v.samples.length, base = this.manifest(v, selected), manifestHash = subset ? hashPayload({ ...base, parentDatasetVersionId: v.id, parentManifestHash: v.manifestHash }) : v.manifestHash;
        const files: {
            path: string;
            sha256: string;
            bytes: number;
        }[] = [];
        const write = (relative: string, data: Buffer | string) => { const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'); atomic(this.safe(path.join(dir, relative)), bytes); files.push({ path: relative, sha256: bytesHash(bytes), bytes: bytes.length }); };
        write('samples.jsonl', selected.map(s => canonicalJson({ schema: DATASET_SCHEMA, sampleId: s.id, sampleVersion: s.version, group: v.groups[s.id], split: v.splits[s.id], sample: this.publicSample(s) })).join('\n') + '\n');
        if (c.includeImages) {
            mkdirSync(path.join(dir, 'images'));
            for (const s of selected)
                write(`images/${s.preparedHash}.png`, this.image(s));
        }
        const manifest = { ...base, manifestHash, parentDatasetVersionId: subset ? v.id : null, parentManifestHash: subset ? v.manifestHash : null, subsetManifestHash: subset ? manifestHash : null, includeImages: c.includeImages, purpose: c.purpose, recipient: c.recipient, withdrawalCheckRevision: this.state.revision, files: files.sort((a, b) => a.path.localeCompare(b.path)), limitations: ['不授权接收方自动上传或训练；外部副本撤回须人类处理'] };
        write('manifest.json', canonicalJson(manifest));
        const e: ExportRecord = { id, versionId: v.id, manifestHash, includeImages: c.includeImages, purpose: c.purpose, recipient: c.recipient, status: 'completed', sampleIds: selected.map(s => s.id), files };
        this.state.exports.push(e);
        return { artifactId: id, manifestHash, exportedCount: selected.length, subset, parentDatasetVersionId: subset ? v.id : null, frameworkOnly: true, modelTrained: false };
    }
    private checkArtifact(id: string) {
        if (!/^[a-f0-9-]{36}$|^[a-f0-9]{64}$/.test(id))
            error('ARTIFACT_MISSING');
        const e = this.state.exports.find(e => e.id === id);
        if (e) {
            if (e.status !== 'completed')
                error('DATASET_WITHDRAWN');
            this.version(e.versionId);
            for (const f of e.files) {
                const file = this.file('artifacts', id, f.path);
                if (!existsSync(file))
                    error('ARTIFACT_MISSING');
                if (bytesHash(readFileSync(file)) !== f.sha256)
                    error('HASH_MISMATCH');
            }
        }
        else {
            const prepared = this.state.prepared.find(p => p.id === id);
            if (!prepared)
                error('ARTIFACT_MISSING');
            this.version(prepared.versionId);
            for (const f of prepared.files) {
                const file = this.file('artifacts', id, f.path);
                if (!existsSync(file))
                    error('ARTIFACT_MISSING');
                if (bytesHash(readFileSync(file)) !== f.sha256)
                    error('HASH_MISMATCH');
            }
        }
    }
    /** Main-process native-save helper. Renderer supplies only an artifact id; selection stays native. */
    artifactFiles(id: string): {
        relative: string;
        bytes: Buffer;
    }[] { this.current(); this.checkArtifact(id); const e = this.state.exports.find(e => e.id === id)!; if (!e)
        error('ARTIFACT_MISSING'); return e.files.map(f => ({ relative: f.path, bytes: readFileSync(this.file('artifacts', id, f.path)) })); }
    private startRun(c: Extract<DatasetCommand, {
        op: 'evaluate';
    }>) {
        const v = this.version(c.versionId);
        if (v.contaminated)
            error('DATASET_LOCKED');
        if (c.scope === 'quality' && c.provider === 'mock')
            error('DATASET_INVALID', 'MOCK_NOT_QUALITY');
        if (c.split === 'test' && c.intent !== 'final')
            error('DATASET_LOCKED');
        const samples = v.samples.filter(s => v.splits[s.id] === c.split);
        if (!samples.length)
            error('DATASET_INVALID', 'EMPTY_SPLIT');
        if (c.provider === 'mock' && samples.some(s => s.kind !== 'synthetic'))
            error('DATASET_INVALID', 'MOCK_SYNTHETIC_ONLY');
        if (c.provider === 'deepseek') {
            if (!c.possibleChargeAccepted)
                error('CONSENT_REQUIRED');
            for (const s of samples)
                this.uploadAllowed(s, v.manifestHash);
        }
        for (const s of samples) {
            this.authorized(s, 'evaluation');
            this.image(s);
        }
        const prompt = promptConfig(c.promptVersion, v.categorySnapshot), provider = this.env.provider(c.provider, c.fixture);
        if (provider.id !== c.provider)
            error('DATASET_INVALID', 'PROVIDER_ID_MISMATCH');
        const run: Run = { id: randomUUID(), datasetVersionId: v.id, manifestHash: v.manifestHash, epoch: this.env.epoch(), revision: this.state.revision, status: 'queued', scope: c.scope, provider: c.provider, split: c.split, intent: c.intent, seed: c.seed, promptVersion: c.promptVersion, promptHash: prompt.hash, runnerVersion: 'evaluation-runner.v1', runnerHash: this.env.runnerHash, appCommit: this.env.appCommit, adapterVersion: provider.adapterVersion, requestedModel: prompt.model, startedAt: null, finishedAt: null, results: samples.map(s => ({ sampleId: s.id, status: 'unprocessed', predictions: [], errorCode: null, durationMs: 0, actualModel: null, usage: null, attempts: 0 })), alignment: null, alignmentHash: null, alignmentReviewer: null, pairPool: pairPool(v, samples), duplicatePredictions: [], report: null, invalidReason: null };
        run.acceptedAt = this.now();
        this.acceptedTicks.set(run.id, performance.now());
        this.state.runs.push(run);
        const abort = new AbortController();
        this.controllers.set(run.id, abort);
        setImmediate(() => { void this.execute(run.id, provider, abort).catch(() => { const r = this.state.runs.find(r => r.id === run.id); if (r) {
            r.status = 'failed';
            r.invalidReason = 'INTERNAL_ERROR';
            r.finishedAt = this.now();
            this.persist();
        } }); });
        return { runId: run.id, status: 'queued', modelTrained: false };
    }
    private uploadAllowed(s: Sample, manifestHash: string) { const c = this.head(s.imageAssetId, 'recognition'); if (!c || c.decision !== 'grant' || c.epoch !== this.env.epoch() || c.preparedHash !== s.preparedHash || c.runManifestHash !== manifestHash)
        error('CONSENT_REQUIRED'); }
    private async execute(id: string, provider: EvaluationProvider, abort: AbortController) {
        const lookup = () => this.state.runs.find(r => r.id === id)!;
        let r = lookup();
        if (r.status !== 'queued')
            return;
        r.status = 'processing';
        r.startedAt = this.now();
        this.persist();
        const v = this.version(r.datasetVersionId), prompt = promptConfig(r.promptVersion, v.categorySnapshot);
        for (const planned of r.results) {
            this.current();
            r = lookup();
            if (abort.signal.aborted || r.status !== 'processing')
                break;
            const s = v.samples.find(s => s.id === planned.sampleId)!;
            const result = copy(planned);
            result.attempts = 0;
            try {
                this.authorized(s, 'evaluation');
                if (provider.id === 'deepseek')
                    this.uploadAllowed(s, v.manifestHash);
                const image = this.image(s);
                result.attempts = 1;
                const response = await provider.recognize({ sampleId: s.id, image, prompt: prompt.text, signal: abort.signal, categories: v.categorySnapshot });
                this.current();
                r = lookup();
                this.authorized(s, 'evaluation');
                if (provider.id === 'deepseek')
                    this.uploadAllowed(s, v.manifestHash);
                if (abort.signal.aborted || r.status !== 'processing')
                    break;
                result.predictions = normalizedPredictions(response.output, v.categorySnapshot);
                result.actualModel = provider.id === 'mock' ? null : response.metadata.actualModel;
                result.usage = provider.id === 'mock' ? null : response.metadata.usage;
                result.status = 'completed';
            }
            catch (e) {
                if (abort.signal.aborted || lookup().status !== 'processing')
                    break;
                result.status = 'failed';
                result.errorCode = e instanceof AppError ? e.code : 'OUTPUT_SCHEMA_INVALID';
                result.usage = metadataOnError(e);
                if (provider.id === 'deepseek')
                    result.attempts = attemptsOnError(e);
            }
            result.durationMs = Math.max(0, Math.round(performance.now() - (this.acceptedTicks.get(id) ?? performance.now())));
            r = lookup();
            r.results[r.results.findIndex(p => p.sampleId === result.sampleId)] = result;
            this.persist();
        }
        r = lookup();
        if (r.status === 'processing') {
            r.duplicateOutput = duplicateHints(v, r.results);
            r.status = 'completed';
            r.finishedAt = this.now();
        }
        this.controllers.delete(id);
        this.acceptedTicks.delete(id);
        this.persist();
    }
    private shutdownRuns(reason: string) { for (const r of this.state.runs)
        if (r.status === 'queued' || r.status === 'processing') {
            this.controllers.get(r.id)?.abort();
            r.status = 'cancelled';
            r.invalidReason = reason;
            r.finishedAt = this.now();
            r.report = null;
        } }
    private withdraw(id: string, _reason: string) {
        const existing = this.tombstones.find(t => t.sampleId === id);
        if (existing) {
            this.purge(existing);
            return { withdrawalId: existing.id, blocked: true, localDeleted: existing.localDeleted, externalCopies: existing.externalCopies };
        }
        const s = this.latest(id), versions = this.state.versions.filter(v => v.samples.some(s => s.id === id));
        const t: Tombstone = { id: randomUUID(), sampleId: id, preparedHash: s.preparedHash, versionHashes: versions.map(v => v.manifestHash), localDeleted: false, backupStatus: 'not_in_ledger_backups', externalCopies: this.state.exports.some(e => e.sampleIds.includes(id)) ? 'unknown' : 'none', createdAt: this.now() };
        this.tombstones.push(t);
        atomic(this.withdrawalFile, canonicalJson(this.tombstones));
        this.purge(t);
        return { withdrawalId: t.id, blocked: true, localDeleted: t.localDeleted, backupStatus: t.backupStatus, externalCopies: t.externalCopies };
    }
    private purge(t: Tombstone) {
        this.shutdownRuns('DATASET_WITHDRAWN');
        delete this.state.samples[t.sampleId];
        this.state.receipts = {};
        for (const c of this.state.consents)
            if (c.preparedHash === t.preparedHash)
                c.rights = null;
        for (const v of this.state.versions)
            if (v.samples.some(s => s.id === t.sampleId) || t.versionHashes.includes(v.manifestHash)) {
                v.status = 'withdrawn';
                v.samples = v.samples.filter(s => s.id !== t.sampleId);
                v.synonyms = {};
                for (const r of this.state.runs.filter(r => r.datasetVersionId === v.id)) {
                    r.status = 'cancelled';
                    r.invalidReason = 'DATASET_WITHDRAWN';
                    r.results = [];
                    r.alignment = null;
                    r.report = null;
                }
            }
        for (const e of this.state.exports)
            if (e.sampleIds.includes(t.sampleId))
                e.status = 'withdrawn';
        try {
            const image = this.file('images', t.preparedHash + '.png');
            if (existsSync(image))
                rmSync(image);
            // All prepared conversions/exports are invalidated, including content not indexed after an interrupted write.
            const affectedVersions = this.state.versions.filter(v => t.versionHashes.includes(v.manifestHash)).map(v => v.id);
            const affectedIds = [...this.state.exports.filter(e => e.sampleIds.includes(t.sampleId) || affectedVersions.includes(e.versionId)).map(e => e.id), ...this.state.prepared.filter(p => affectedVersions.includes(p.versionId)).map(p => p.id)];
            const artifacts = this.file('artifacts');
            if (existsSync(artifacts))
                for (const entry of readdirSync(artifacts)) {
                    if (!/^[a-f0-9-]{36}$|^[a-f0-9]{64}$/.test(entry))
                        error('PERMISSION_DENIED');
                    const dir = this.file('artifacts', entry);
                    let affected = affectedIds.includes(entry);
                    for (const metadata of ['manifest.json', 'prepared.json']) {
                        const file = this.safe(path.join(dir, metadata));
                        if (existsSync(file)) {
                            const m = JSON.parse(readFileSync(file, 'utf8'));
                            if (affectedVersions.includes(m.datasetVersionId) || m.samples?.some?.((s: {
                                sampleId: string;
                            }) => s.sampleId === t.sampleId))
                                affected = true;
                        }
                    }
                    if (affected)
                        rmSync(dir, { recursive: true, force: true });
                }
            t.localDeleted = true;
        }
        catch {
            t.localDeleted = false;
        }
        atomic(this.withdrawalFile, canonicalJson(this.tombstones));
    }
    shutdown() { this.shutdownRuns('INTERRUPTED'); this.persist(); this.closed = true; }
    resetEpoch() { this.current(); }
    private relationKeys(s: Sample) { return [...s.relations.map(r => hashPayload(['relation', r])), ...(s.labels ?? []).map(l => hashPayload(['transaction', l.transactionId]))]; }
}
