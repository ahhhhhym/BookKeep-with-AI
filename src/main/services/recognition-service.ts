import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, type ErrorCode } from '../../shared/errors';
import { CANDIDATE_SCHEMA_VERSION, DEEPSEEK_MODEL, MOCK_MODEL, PROMPT_VERSION } from '../../shared/constants';
import { normalizeCandidateOutput, parseCandidateOutput, type CandidateOutput, type ProposalWarning } from '../../shared/candidate';
import { IMPORT_PROMPT, NOTICE_VERSION, type Candidate, type CandidateQuery, type Job, type JobList, type JobQuery, type JobStatus, type ListResult, type RetryInput, type StartInput, type VersionedJob } from '../../shared/imports';
import type { LedgerStore } from './ledger-store';
import type { ImageService } from './image-service';
import { change, type ImportContext } from './import-context';
import { createTokenCodec, type TokenCodec } from './signed-token';
import { insertAuditEvent } from '../db/audit-repo';
import { hashPayload } from './canonical';
import { recognizeReceipt, type ReceiptRequest } from './providers/receipt';
import type { SecretStore } from './settings/ai-settings';
import type { TransportMetadata } from './providers/transport';
import { mockProvider } from './providers/mock';
type JobRow = {
    id: string;
    version: number;
    image_asset_id: string;
    prepared_hash: string;
    status: JobStatus;
    generation: number;
    attempt: number;
    total_attempts: number;
    provider: 'mock' | 'deepseek';
    model: string;
    actual_model: string | null;
    prompt_version: string;
    schema_version: string;
    error_code: ErrorCode | null;
    started_at: string | null;
    finished_at: string | null;
    next_attempt_at: string | null;
    candidate_count: number;
    created_at: string;
    needs_consent: number;
    request_id: string | null;
    consent_json: string;
    categories_json: string;
    force_new: number;
    warnings_json: string;
};
type CandidateRow = {
    id: string;
    version: number;
    job_id: string;
    image_asset_id: string;
    prepared_hash: string;
    ordinal: number;
    proposal_json: string;
    current_json: string;
    missing_json: string;
    warnings_json: string;
    duplicates_json: string;
    blocking: number;
    excluded_by_default: number;
    review_state: Candidate['reviewState'];
    posted_transaction_id: string | null;
    created_at: string;
};
const jobDto = (r: JobRow): Job => ({ id: r.id, version: r.version, imageAssetId: r.image_asset_id, preparedHash: r.prepared_hash, status: r.status, generation: r.generation, attempt: r.attempt, totalAttempts: r.total_attempts, provider: r.provider, model: r.model, actualModel: r.actual_model, promptVersion: r.prompt_version, schemaVersion: r.schema_version, errorCode: r.error_code, startedAt: r.started_at, finishedAt: r.finished_at, nextAttemptAt: r.next_attempt_at, candidateCount: r.candidate_count, createdAt: r.created_at, needsConsent: r.needs_consent === 1, warnings: JSON.parse(r.warnings_json) });
const candidateDto = (r: CandidateRow): Candidate => ({ id: r.id, version: r.version, jobId: r.job_id, imageAssetId: r.image_asset_id, preparedHash: r.prepared_hash, ordinal: r.ordinal, proposal: JSON.parse(r.proposal_json), current: JSON.parse(r.current_json), missingFields: JSON.parse(r.missing_json), warnings: JSON.parse(r.warnings_json), blocking: r.blocking === 1, excludedByDefault: r.excluded_by_default === 1, duplicateMatches: JSON.parse(r.duplicates_json), reviewState: r.review_state, postedTransactionId: r.posted_transaction_id, createdAt: r.created_at });
export interface RecognitionOptions {
    /** Tests inject only transport, retaining real production SQLite/scheduler. */
    execute?: (request: ReceiptRequest) => Promise<CandidateOutput>;
    timeoutMs?: number;
    backoffMs?: readonly [
        number,
        number
    ];
    clock?: () => number;
}
export class RecognitionService {
    private readonly active = new Map<string, AbortController>();
    private stopped = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly codec: TokenCodec;
    private readonly clock: () => number;
    private readonly epoch: string;
    constructor(private readonly store: LedgerStore, private readonly images: ImageService, private readonly secrets: SecretStore, private readonly options: RecognitionOptions = {}) {
        this.clock = options.clock ?? Date.now;
        this.epoch = store.currentEpoch;
        this.codec = createTokenCodec(randomBytes(32), this.clock);
        // Startup recovery is real SQLite, with no automatic network dispatch.
        const has = store.withImports(false, c => c.db.prepare('SELECT id FROM import_job WHERE ledger_id=? AND status IN(\'queued\',\'processing\') LIMIT 1').get(c.ledgerId));
        if (has)
            change(store, 'recognition.recover', null, {}, c => {
                c.db.prepare("UPDATE import_job SET status='failed',error_code='INTERRUPTED',finished_at=?,request_id=NULL,generation=generation+1,version=version+1,next_attempt_at=NULL,needs_consent=1,updated_at=? WHERE ledger_id=? AND status='processing'").run(this.now(), this.now(), c.ledgerId);
                c.db.prepare("UPDATE import_job SET needs_consent=1,version=version+1,updated_at=? WHERE ledger_id=? AND status='queued'").run(this.now(), c.ledgerId);
                return null;
            });
    }
    private now(): string { return new Date(this.clock()).toISOString(); }
    private row(id: string): JobRow {
        const r = this.store.withImports(false, c => c.db.prepare<JobRow>('SELECT * FROM import_job WHERE id=? AND ledger_id=?').get(id, c.ledgerId));
        if (!r)
            throw new AppError('NOT_FOUND');
        return r;
    }
    private available(provider: Job['provider']): void { if (provider === 'deepseek')
        this.secrets.readForProvider(); }
    private version(r: JobRow, n: number): void { if (r.version !== n)
        throw new AppError('VERSION_CONFLICT'); if (r.version >= 2147483646 || r.generation >= Number.MAX_SAFE_INTEGER || r.total_attempts >= Number.MAX_SAFE_INTEGER)
        throw new AppError('COUNTER_EXHAUSTED'); }
    start(input: StartInput, mutationId: string): {
        jobs: Job[];
        reusedIds: string[];
        createdIds: string[];
    } {
        const result = change(this.store, 'recognition.start', mutationId, input, c => {
            if (this.stopped || this.epoch !== c.epoch)
                throw new AppError('STALE_EPOCH');
            if (input.promptVersion !== IMPORT_PROMPT)
                throw new AppError('FIELD_INVALID');
            if (input.images.length > 20)
                throw new AppError('BATCH_LIMIT');
            const categories = this.store.listCategories(false).categories.filter(x => x.enabled).map(x => ({ id: x.id, name: x.name }));
            // Validate whole batch before any job exists or HTTP begins.
            input.images.forEach((image, i) => {
                this.images.readPrepared(image.imageAssetId, image.preparedHash);
                const consent = input.uploadConsent[i];
                if (!consent || !consent.confirmed || consent.noticeVersion !== NOTICE_VERSION || consent.preparedHash !== image.preparedHash)
                    throw new AppError('CONSENT_REQUIRED');
            });
            if (input.forceNew && !input.reason?.trim())
                throw new AppError('FIELD_INVALID');
            const jobs: Job[] = [];
            const reusedIds: string[] = [];
            const createdIds: string[] = [];
            input.images.forEach((image, i) => {
                const old = c.db.prepare<JobRow>('SELECT * FROM import_job WHERE ledger_id=? AND prepared_hash=? ORDER BY created_at DESC,id DESC LIMIT 1').get(c.ledgerId, image.preparedHash);
                if (old && !input.forceNew) {
                    jobs.push(jobDto(old));
                    reusedIds.push(old.id);
                    return;
                }
                this.available(input.provider);
                const id = randomUUID();
                c.db.prepare('INSERT INTO import_job(id,ledger_id,image_asset_id,prepared_hash,status,provider,model,prompt_version,schema_version,categories_json,consent_json,force_new,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    .run(id, c.ledgerId, image.imageAssetId, image.preparedHash, 'queued', input.provider, input.provider === 'deepseek' ? DEEPSEEK_MODEL : MOCK_MODEL, IMPORT_PROMPT, CANDIDATE_SCHEMA_VERSION, JSON.stringify(categories), JSON.stringify(input.uploadConsent[i]), input.forceNew ? 1 : 0, input.reason, this.now(), this.now());
                jobs.push(jobDto(this.row(id)));
                createdIds.push(id);
            });
            return { jobs, reusedIds, createdIds };
        });
        this.pump();
        return result;
    }
    cancel(input: VersionedJob, mutationId: string): Job {
        const result = change(this.store, 'recognition.cancel', mutationId, input, c => {
            const r = this.row(input.jobId);
            this.version(r, input.expectedVersion);
            if (!['queued', 'processing'].includes(r.status))
                throw new AppError('STATE_CONFLICT');
            c.db.prepare("UPDATE import_job SET status='cancelled',generation=generation+1,request_id=NULL,error_code='CANCELLED',finished_at=?,next_attempt_at=NULL,version=version+1,updated_at=? WHERE id=?").run(this.now(), this.now(), r.id);
            return jobDto(this.row(r.id));
        });
        this.active.get(input.jobId)?.abort();
        this.pump();
        return result;
    }
    retry(input: RetryInput, mutationId: string, resume = false): Job {
        const result = change(this.store, resume ? 'recognition.resume' : 'recognition.retry', mutationId, input, c => {
            const r = this.row(input.jobId);
            this.version(r, input.expectedVersion);
            if (resume ? r.status !== 'queued' || !r.needs_consent : !['failed', 'cancelled'].includes(r.status))
                throw new AppError('STATE_CONFLICT');
            if (!input.possibleChargeAccepted || input.uploadConsent.preparedHash !== r.prepared_hash || !input.uploadConsent.confirmed || input.uploadConsent.noticeVersion !== NOTICE_VERSION)
                throw new AppError('CONSENT_REQUIRED');
            this.images.readPrepared(r.image_asset_id, r.prepared_hash);
            this.available(r.provider);
            c.db.prepare("UPDATE import_job SET status='queued',generation=generation+1,attempt=0,request_id=NULL,error_code=NULL,started_at=NULL,finished_at=NULL,next_attempt_at=NULL,needs_consent=0,consent_json=?,version=version+1,updated_at=? WHERE id=?").run(JSON.stringify(input.uploadConsent), this.now(), r.id);
            return jobDto(this.row(r.id));
        });
        this.pump();
        return result;
    }
    private page<T>(ctx: ImportContext, table: 'import_job' | 'candidate', where: string, params: unknown[], query: {
        limit: number;
        cursor: string | null;
    }, scope: unknown, map: (r: never) => T): ListResult<T> {
        let offset = 0;
        const digest = hashPayload(scope);
        if (query.cursor) {
            const token = this.codec.verify(query.cursor);
            if (!token.ok)
                throw new AppError('TOKEN_EXPIRED');
            const p = token.payload;
            if (p.epoch !== ctx.epoch || p.scope !== digest || p.revision !== ctx.revision)
                throw new AppError('SNAPSHOT_STALE');
            offset = Number(p.offset);
            if (!Number.isSafeInteger(offset) || offset < 0)
                throw new AppError('PAYLOAD_INVALID');
        }
        const clause = `ledger_id=? ${where}`;
        const args = [ctx.ledgerId, ...params];
        const total = ctx.db.prepare<{
            n: number;
        }>(`SELECT count(*) n FROM ${table} WHERE ${clause}`).get(...args)!.n;
        const order = table === 'candidate' ? 'created_at DESC,job_id ASC,ordinal ASC,id ASC' : 'created_at DESC,id DESC';
        const rows = ctx.db.prepare<never>(`SELECT * FROM ${table} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, query.limit, offset);
        const next = offset + rows.length;
        return { items: rows.map(map), totalCount: total, snapshotRevision: ctx.revision, nextCursor: next < total ? this.codec.sign({ v: 1, x: this.clock() + 300000, epoch: ctx.epoch, revision: ctx.revision, scope: digest, offset: next }) : null };
    }
    status(query: JobQuery): Job | JobList {
        if (query.jobId)
            return jobDto(this.row(query.jobId));
        return this.store.withImports(false, c => {
            const where = query.statusFilter.length ? `AND status IN (${query.statusFilter.map(() => '?').join(',')})` : '';
            const result = this.page(c, 'import_job', where, query.statusFilter, query.page, { statusFilter: query.statusFilter }, jobDto);
            const counts: JobList['counts'] = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
            for (const r of c.db.prepare<{
                status: JobStatus;
                n: number;
            }>('SELECT status,count(*) n FROM import_job WHERE ledger_id=? GROUP BY status').all(c.ledgerId))
                counts[r.status] = r.n;
            return { ...result, counts };
        });
    }
    candidates(query: CandidateQuery): ListResult<Candidate> {
        const states=query.reviewStates??[];
        const where=(query.jobId?'AND job_id=? ':'')+(states.length?`AND review_state IN (${states.map(()=>'?').join(',')})`:'');
        return this.store.withImports(false, c => this.page(c, 'candidate', where, [...(query.jobId?[query.jobId]:[]),...states], query.page, { jobId: query.jobId,reviewStates:states }, candidateDto));
    }
    private pump(): void {
        if (this.stopped || this.store.currentEpoch !== this.epoch)
            return;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const rows = this.store.withImports(false, c => c.db.prepare<JobRow>("SELECT * FROM import_job WHERE ledger_id=? AND status='queued' AND needs_consent=0 ORDER BY created_at,id").all(c.ledgerId));
        let wait: number | null = null;
        for (const r of rows) {
            if (this.active.size >= 2)
                break;
            if (this.active.has(r.id))
                continue;
            const delay = r.next_attempt_at ? Date.parse(r.next_attempt_at) - this.clock() : 0;
            if (delay > 0) {
                wait = wait === null ? delay : Math.min(wait, delay);
                continue;
            }
            const abort = new AbortController();
            this.active.set(r.id, abort);
            void this.run(r.id, abort).catch(() => { }).finally(() => { this.active.delete(r.id); this.pump(); });
        }
        if (wait !== null)
            this.timer = setTimeout(() => this.pump(), Math.min(wait, 60000));
    }
    private async run(id: string, abort: AbortController): Promise<void> {
        let requestId = '';
        let generation = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const metadata: TransportMetadata = { httpStatus: null, actualModel: null, usage: null };
        try {
            let r = this.row(id);
            this.version(r, r.version);
            const consent = JSON.parse(r.consent_json);
            if (r.status !== 'queued' || r.needs_consent || consent.preparedHash !== r.prepared_hash || !consent.confirmed || consent.noticeVersion !== NOTICE_VERSION)
                throw new AppError('CONSENT_REQUIRED');
            this.available(r.provider);
            const image = this.images.readPrepared(r.image_asset_id, r.prepared_hash);
            requestId = randomUUID();
            generation = r.generation;
            change(this.store, 'recognition.dispatch', null, { id }, c => {
                c.db.prepare("UPDATE import_job SET status='processing',attempt=attempt+1,total_attempts=total_attempts+1,request_id=?,started_at=?,finished_at=NULL,next_attempt_at=NULL,error_code=NULL,version=version+1,updated_at=? WHERE id=? AND status='queued' AND generation=?").run(requestId, this.now(), this.now(), id, generation);
                return null;
            });
            r = this.row(id);
            const recordUsage=(phase:string)=>{
              if(this.stopped||this.store.currentEpoch!==this.epoch)return;
              this.store.withImports(true,c=>insertAuditEvent(c.db,{ledgerId:c.ledgerId,entityType:'job',entityId:id,action:'recognition.attempt',actor:'system',mutationId:null,reason:null,now:this.now(),diff:[
                {field:'requestId',before:null,after:requestId},{field:'generation',before:null,after:generation},{field:'phase',before:null,after:phase},
                {field:'requestSent',before:null,after:metadata.requestSent??false},{field:'usage',before:null,after:metadata.usage},{field:'httpStatus',before:null,after:metadata.httpStatus},
              ]}));
            };
            const request: ReceiptRequest = { image, categories: JSON.parse(r.categories_json), provider: r.provider, signal: abort.signal, metadata,onRequestSent:()=>recordUsage('dispatch') };
            let timeout = false;
            const interrupted = new Promise<never>((_, reject) => {
                abort.signal.addEventListener('abort', () => reject(new AppError(timeout ? 'REQUEST_TIMEOUT' : 'CANCELLED')), { once: true });
                timer = setTimeout(() => { timeout = true; abort.abort(); }, this.options.timeoutMs ?? 90000);
            });
            const execute = this.options.execute ?? (async (req: ReceiptRequest) => {
                if (req.provider === 'deepseek')
                    return recognizeReceipt(req, this.secrets.readForProvider());
                const response = await mockProvider.recognize({ requestId, model: MOCK_MODEL, promptVersion: PROMPT_VERSION, schemaVersion: CANDIDATE_SCHEMA_VERSION, image: null, categories: req.categories, mockScenario: 'two-expenses' });
                return response.output;
            });
            const transport=execute(request).then(output=>{recordUsage('settled');return output;},error=>{recordUsage('settled');throw error;});
            const output = parseCandidateOutput(await Promise.race([transport, interrupted]));
            if (timer)
                clearTimeout(timer);
            if (this.stopped || this.store.currentEpoch !== this.epoch)
                return;
            change(this.store, 'recognition.complete', null, { id }, c => {
                const current = this.row(id);
                if (current.status !== 'processing' || current.generation !== generation || current.request_id !== requestId || current.needs_consent || abort.signal.aborted)
                    return null;
                this.saveCandidates(c, current, output);
                c.db.prepare("UPDATE import_job SET status='completed',request_id=NULL,candidate_count=?,warnings_json=?,actual_model=?,usage_json=?,finished_at=?,error_code=NULL,version=version+1,updated_at=? WHERE id=?")
                    .run(output.candidates.length, JSON.stringify(output.warnings), metadata.actualModel, metadata.usage ? JSON.stringify(metadata.usage) : null, this.now(), this.now(), id);
                return null;
            });
        }
        catch (error) {
            if (this.stopped || this.store.currentEpoch !== this.epoch)
                return;
            const code = error instanceof AppError ? error.code : 'OUTPUT_SCHEMA_INVALID';
            change(this.store, 'recognition.fail', null, { id }, c => {
                const r = this.row(id);
                if (!['processing', 'queued'].includes(r.status) || r.generation !== (generation || r.generation) || (requestId && r.request_id !== requestId))
                    return null;
                const retry = ['NETWORK_ERROR', 'PROVIDER_TEMPORARY', 'PROVIDER_RATE_LIMIT', 'REQUEST_TIMEOUT'].includes(code) && r.attempt > 0 && r.attempt < 3;
                const delay = Math.max((this.options.backoffMs ?? [2000, 4000])[r.attempt - 1] ?? 2000, metadata.retryAfterMs ?? 0);
                const next = retry ? new Date(this.clock() + Math.min(60000, delay)).toISOString() : null;
                c.db.prepare('UPDATE import_job SET status=?,request_id=NULL,error_code=?,next_attempt_at=?,finished_at=?,version=version+1,updated_at=? WHERE id=?')
                    .run(retry ? 'queued' : 'failed', code, next, retry ? null : this.now(), this.now(), id);
                return null;
            });
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    private saveCandidates(c: ImportContext, job: JobRow, output: CandidateOutput): void {
        const normalized = normalizeCandidateOutput(output);
        const categories = new Set((JSON.parse(job.categories_json) as {
            id: string;
        }[]).map(x => x.id));
        const ids = normalized.candidates.map(() => randomUUID());
        normalized.candidates.forEach((n, i) => {
            const current = n.current;
            const warnings: ProposalWarning[] = [...n.warnings, ...output.warnings];
            const add = (code: string, message: string, field: string | null = null) => warnings.push({ code, message, field });
            if (current.amountFen !== null && (current.amountFen <= 0 || current.amountFen > 999999999)) {
                current.amountFen = null;
                add('AMOUNT_AMBIGUOUS', '金额需人工核实。', 'amountFen');
            }
            if (current.categoryId !== null && !categories.has(current.categoryId)) {
                current.categoryId = null;
                add('CATEGORY_UNKNOWN', '分类不在当前字典中。', 'categoryId');
            }
            if (current.occurredDate && !current.evidence.some(e => e.field === 'occurredDate' && e.text?.includes(current.occurredDate!.slice(0, 4)))) {
                current.occurredDate = null;
                current.occurredTime = null;
                current.timePrecision = 'unknown';
                add('DATE_UNCERTAIN', '日期证据缺少年份，请补全。', 'occurredDate');
            }
            if (current.transactionKind !== 'expense')
                add('NON_EXPENSE', '疑似非支出，默认排除，须人工核实。', 'transactionKind');
            if (!current.amountBasis)
                add('TOTAL_DETAIL_AMBIGUOUS', '实付口径未知，请对照原图。', 'amountBasis');
            const mixed = normalized.candidates.some(o => o !== n && o.current.amountBasis !== current.amountBasis && [o.current.amountBasis, current.amountBasis].includes('paid_total') && (!current.groupKey || !o.current.groupKey || current.groupKey === o.current.groupKey));
            if (mixed)
                add('TOTAL_DETAIL_AMBIGUOUS', '合计与明细可能重复，需人工选择实际支付项。', 'amountBasis');
            const duplicateMatches: Candidate['duplicateMatches'] = [];
            if (job.force_new) {
                const old = c.db.prepare<JobRow>('SELECT * FROM import_job WHERE ledger_id=? AND prepared_hash=? AND id<>? ORDER BY created_at DESC LIMIT 1').get(c.ledgerId, job.prepared_hash, job.id);
                if (old)
                    duplicateMatches.push({ targetType: 'job', targetId: old.id, targetVersion: old.version, basis: 'exact_hash' });
            }
            if (current.amountFen !== null && current.occurredDate && (current.name || current.merchant)) {
                const txs = c.db.prepare<{
                    id: string;
                    version: number;
                    name: string;
                    merchant: string | null;
                }>('SELECT id,version,name,merchant FROM "transaction" WHERE ledger_id=? AND amount_fen=? AND occurred_date=?').all(c.ledgerId, current.amountFen, current.occurredDate);
                for (const t of txs)
                    if ((current.merchant && t.merchant === current.merchant) || (current.name && t.name === current.name))
                        duplicateMatches.push({ targetType: 'transaction', targetId: t.id, targetVersion: t.version, basis: current.merchant && t.merchant === current.merchant ? 'amount_date_merchant' : 'amount_date_name' });
                const rows = c.db.prepare<CandidateRow>('SELECT * FROM candidate WHERE ledger_id=?').all(c.ledgerId);
                for (const row of rows) {
                    const other = candidateDto(row);
                    const p = other.current;
                    if (p.amountFen === current.amountFen && p.occurredDate === current.occurredDate && ((current.merchant && p.merchant === current.merchant) || (current.name && p.name === current.name))) {
                        duplicateMatches.push({ targetType: 'candidate', targetId: row.id, targetVersion: row.version + 1, basis: 'amount_date_name' });
                        const previous = [...other.duplicateMatches, { targetType: 'candidate', targetId: ids[i]!, targetVersion: 1, basis: 'amount_date_name' }];
                        c.db.prepare('UPDATE candidate SET duplicates_json=?,blocking=1,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(previous), this.now(), row.id);
                    }
                }
            }
            const missing = (['amountFen', 'occurredDate', 'name', 'categoryId'] as const).filter(f => current[f] === null);
            const blocking = n.blocking || warnings.length > 0 || missing.length > 0 || duplicateMatches.length > 0;
            c.db.prepare('INSERT INTO candidate(id,ledger_id,job_id,image_asset_id,prepared_hash,ordinal,proposal_json,current_json,evidence_json,missing_json,warnings_json,duplicates_json,blocking,excluded_by_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .run(ids[i], c.ledgerId, job.id, job.image_asset_id, job.prepared_hash, n.ordinal, JSON.stringify(n.proposal), JSON.stringify(current), JSON.stringify(n.proposal.evidence), JSON.stringify(missing), JSON.stringify(warnings), JSON.stringify(duplicateMatches), blocking ? 1 : 0, current.transactionKind === 'expense' ? 0 : 1, this.now(), this.now());
        });
    }
    shutdown(): void { this.stopped = true; if (this.timer)
        clearTimeout(this.timer); for (const controller of this.active.values())
        controller.abort(); }
}
