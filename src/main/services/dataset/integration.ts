import { DatasetService } from './store';
import { deepseekEvaluationProvider } from './provider';
import { AppError } from '../../../shared/errors';
import type { LedgerStore } from '../ledger-store';
import type { ImageService } from '../image-service';
import type { SecretStore } from '../settings/ai-settings';
declare const __BOOKKEEP_DATASET_BUILD__: {
    sourceHash: string;
    commit: string;
};
export function createDatasetService(store: LedgerStore, images: ImageService, secrets: SecretStore) {
    return new DatasetService({ root: store.diagnostics().root, ledgerId: () => store.currentLedgerId, epoch: () => store.currentEpoch,
        categories: () => store.listCategories(true).categories.map(c => ({ id: c.id, name: c.name })),
        image: (id, hash) => store.withImports(false, ctx => {
            const row = ctx.db.prepare<{
                original_hash: string;
            }>('SELECT original_hash FROM image_asset WHERE id=? AND ledger_id=? AND prepared_hash=? AND deleted_at IS NULL').get(id, ctx.ledgerId, hash);
            if (!row)
                throw new AppError('IMAGE_NOT_PREPARED');
            return { bytes: images.readPrepared(id, hash), originalHash: row.original_hash };
        }),
        prediction: (jobId, imageId, hash) => store.withImports(false, ctx => {
            const job = ctx.db.prepare<{
                provider: string;
                actual_model: string | null;
                prompt_version: string;
                schema_version: string;
            }>('SELECT * FROM import_job WHERE id=? AND ledger_id=? AND image_asset_id=? AND prepared_hash=? AND status=\'completed\'').get(jobId, ctx.ledgerId, imageId, hash);
            if (!job)
                throw new AppError('DATASET_INVALID');
            const rows = ctx.db.prepare<{
                proposal_json: string;
            }>('SELECT proposal_json FROM candidate WHERE job_id=? ORDER BY ordinal').all(jobId);
            return { proposals: rows.map(r => JSON.parse(r.proposal_json)), metadata: { provider: job.provider, actualModel: job.actual_model, promptVersion: job.prompt_version, schemaVersion: job.schema_version } };
        }),
        provider: (id, fixture) => {
            if (id === 'deepseek')
                return deepseekEvaluationProvider(() => secrets.readForProvider());
            if (fixture !== null)
                throw new AppError('DATASET_INVALID', { details: { reason: 'CLI_FIXTURE_ONLY' } });
            return { id: 'mock', adapterVersion: 'mock-empty.v1', async recognize() { return { output: { schemaVersion: 'bk-candidate.v1', candidates: [], warnings: [] }, metadata: { httpStatus: null, actualModel: null, usage: null } }; } };
        },
        runnerHash: __BOOKKEEP_DATASET_BUILD__.sourceHash, appCommit: __BOOKKEEP_DATASET_BUILD__.commit,
    });
}
