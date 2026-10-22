/** 通道处理器：参数编排 + 调用主进程账本服务；业务事务与校验在 services/仓储层。 */

import { normalizeCandidateOutput } from '../../shared/candidate';
import { CANDIDATE_SCHEMA_VERSION, PROMPT_VERSION } from '../../shared/constants';
import { AppError } from '../../shared/errors';
import type { MockRecognitionView } from '../../shared/dto';
import { CHANNEL_SPECS, SECRET_SUBMIT_RATE_LIMIT } from '../../shared/ipc';
import { SYSTEM_CATEGORIES } from '../../shared/categories';
import type { IpcRouter } from './registry';
import { createRateLimiter } from './rate-limit';
import { getProvider } from '../services/providers';
import { readAiSettings, type SecretStore } from '../services/settings/ai-settings';
import type { ProbeService } from '../services/providers/probe';
import type { LedgerStore } from '../services/ledger-store';
import type { ImageService } from '../services/image-service';
import type { RecognitionService } from '../services/recognition-service';
import { ReviewService } from '../services/review-service';
import type { DatasetService } from '../services/dataset/store';

export interface HandlerDependencies {
  readonly maintenance: import('../services/maintenance-service').MaintenanceService;
  readonly activity: import('../services/review-activity').ReviewActivityService;
  readonly store: LedgerStore;
  readonly secrets: SecretStore;
  readonly probe: ProbeService;
  readonly images: ImageService;
  readonly recognition: RecognitionService;
  readonly selectImages: () => Promise<string[]>;
  readonly onRestored: () => void;
  readonly reviewOwner?: () => number|null;
  readonly dataset?: DatasetService;
  readonly saveDataset?: (artifactId:string)=>Promise<{saved:boolean}>;
}

export function registerIpcHandlers(router: IpcRouter, deps: HandlerDependencies): void {
  router.handle(CHANNEL_SPECS.maintenanceCsv,r=>deps.maintenance.csv(r.payload as unknown as import('../../shared/maintenance').CsvInput,r.mutationId!));
  router.handle(CHANNEL_SPECS.maintenanceBackupArtifact,r=>deps.maintenance.backup(String(r.payload.backupId)));
  router.handle(CHANNEL_SPECS.maintenanceSave,r=>deps.maintenance.save(String(r.payload.artifactId),r.mutationId!));
  router.handle(CHANNEL_SPECS.maintenanceSelect,()=>deps.maintenance.select());
  router.handle(CHANNEL_SPECS.maintenanceImport,r=>deps.maintenance.import(String(r.payload.selectionToken),r.mutationId!));
  router.handle(CHANNEL_SPECS.maintenanceStatus,r=>deps.store.backupStatus(String(r.payload.restoreId)));
  router.handle(CHANNEL_SPECS.maintenanceActivity,r=>deps.activity.record(r.payload as unknown as import('../../shared/maintenance').ActivityInput));
  router.handle(CHANNEL_SPECS.maintenanceMetrics,r=>deps.activity.metrics(r.payload.jobId as string|null));
  const review=new ReviewService(deps.store,deps.images,deps.reviewOwner);
  const dataset=()=>{if(!deps.dataset)throw new AppError('RECOVERY_REQUIRED');return deps.dataset;};
  router.handle(CHANNEL_SPECS.datasetRead,r=>dataset().read(r.payload));
  router.handle(CHANNEL_SPECS.datasetCommand,r=>dataset().command(r.payload.command,r.mutationId!));
  router.handle(CHANNEL_SPECS.datasetSave,r=>{dataset();if(!deps.saveDataset)throw new AppError('NOT_IMPLEMENTED');return deps.saveDataset(r.payload.artifactId);});
  router.handle(CHANNEL_SPECS.imageSelect, async () => deps.images.select(await deps.selectImages(), 'selection'));
  router.handle(CHANNEL_SPECS.imageDrop, r => deps.images.select(r.payload.paths,'drop'));
  router.handle(CHANNEL_SPECS.imageImport, r => deps.images.import(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.imagePrepare, r => deps.images.prepare(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.imageResource, r => deps.images.resource(r.payload));
  router.handle(CHANNEL_SPECS.imageDelete, r => deps.images.delete(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.recognitionStart, r => deps.recognition.start(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.recognitionStatus, r => deps.recognition.status(r.payload));
  router.handle(CHANNEL_SPECS.recognitionCancel, r => deps.recognition.cancel(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.recognitionRetry, r => deps.recognition.retry(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.recognitionResume, r => deps.recognition.retry(r.payload,r.mutationId!,true));
  router.handle(CHANNEL_SPECS.candidateList, r => review.list(r.payload,deps.recognition));
  router.handle(CHANNEL_SPECS.candidateUpdate, r => review.update(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.candidateReject, r => review.reject(r.payload,r.mutationId!));
  router.handle(CHANNEL_SPECS.candidateApprove, r => review.approve(r.payload,r.mutationId));
  const secretLimiter = createRateLimiter(
    SECRET_SUBMIT_RATE_LIMIT.limit,
    SECRET_SUBMIT_RATE_LIMIT.windowMs,
  );

  router.handle(CHANNEL_SPECS.settingsReadAi, () =>
    readAiSettings(deps.secrets, deps.store.currentLedgerId, deps.probe.verified),
  );

  router.handle(CHANNEL_SPECS.settingsReadStatus, () =>
    deps.secrets.status(),
  );

  router.handle(CHANNEL_SPECS.settingsSaveSecret, (request) => {
    const decision = secretLimiter.tryConsume();
    if (!decision.ok) {
      throw new AppError('SECRET_RATE_LIMIT', { retryAfterMs: decision.retryAfterMs });
    }
    return deps.secrets.save(request.payload, request.mutationId!);
  });

  router.handle(CHANNEL_SPECS.providerCapabilities, (request) =>
    ({ ...getProvider(request.payload.providerId).capabilities(), ...(request.payload.providerId === 'deepseek' && deps.probe.verified ? { structuredOutputStatus: 'verified' as const, probeEvidenceId: deps.probe.verifiedEvidenceId } : {}) }),
  );
  router.handle(CHANNEL_SPECS.providerProbe, (request) => deps.probe.run(request.mutationId!));

  router.handle(CHANNEL_SPECS.ledgerEnsureDefault, () => deps.store.ensureDefault());

  router.handle(CHANNEL_SPECS.categoryList, (request) =>
    deps.store.listCategories(request.payload.includeDisabled ?? true),
  );

  router.handle(CHANNEL_SPECS.categoryCreate, (request) =>
    deps.store.createCategory(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.categoryUpdate, (request) =>
    deps.store.updateCategory(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.categoryDisable, (request) =>
    deps.store.disableCategory(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.transactionCreate, (request) =>
    deps.store.createTransaction(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.transactionUpdate, (request) =>
    deps.store.updateTransaction(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.transactionSoftDelete, (request) =>
    deps.store.softDeleteTransaction(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.transactionRestore, (request) =>
    deps.store.restoreTransaction(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.transactionList, (request) =>
    deps.store.listTransactions(request.payload),
  );

  router.handle(CHANNEL_SPECS.statisticsSeries, (request) => deps.store.statisticsSeries(request.payload));
  router.handle(CHANNEL_SPECS.statisticsSummary, (request) => deps.store.statisticsSummary(request.payload));
  router.handle(CHANNEL_SPECS.statisticsTopTransactions, (request) => deps.store.statisticsTopTransactions(request.payload));
  router.handle(CHANNEL_SPECS.statisticsTopCategories, (request) => deps.store.statisticsTopCategories(request.payload));

  router.handle(CHANNEL_SPECS.backupCreate, (request) =>
    deps.store.createBackup(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.backupList, r => deps.store.listBackups(r.payload.page));

  router.handle(CHANNEL_SPECS.backupRestore, (request) => {
    if (request.payload.mode === 'commit' && request.mutationId === null) {
      throw new AppError('PAYLOAD_INVALID', {
        fieldErrors: [{ path: 'request.mutationId', code: 'MUTATION_ID_REQUIRED' }],
      });
    }
    const result=deps.store.restoreBackup(request.payload, request.mutationId);
    if('newDataEpoch' in result&&!result.replayed)deps.onRestored();
    return result;
  });

  router.handle(CHANNEL_SPECS.skeletonMockRecognition, async (request): Promise<MockRecognitionView> => {
    const provider = getProvider('mock');
    const capabilities = provider.capabilities();
    const result = await provider.recognize({
      requestId: request.requestId,
      model: capabilities.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      image: null,
      categories: SYSTEM_CATEGORIES.map((category) => ({ id: category.id, name: category.name })),
      mockScenario: request.payload.scenario,
    });
    const normalized = normalizeCandidateOutput(result.output);
    return {
      providerId: 'mock',
      localSimulation: true,
      adapterVersion: result.adapterVersion,
      requestedModel: result.requestedModel,
      actualModel: null,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      schemaVersion: result.output.schemaVersion,
      candidates: normalized.candidates,
      warnings: normalized.warnings,
      note: result.note,
    };
  });
}
