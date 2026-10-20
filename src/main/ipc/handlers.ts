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
import { readAiSettings, readSecretStatus, saveSecretStub } from '../services/settings/ai-settings';
import type { LedgerStore } from '../services/ledger-store';

export interface HandlerDependencies {
  readonly store: LedgerStore;
  readonly encryptionAvailable: () => boolean;
}

export function registerIpcHandlers(router: IpcRouter, deps: HandlerDependencies): void {
  const secretLimiter = createRateLimiter(
    SECRET_SUBMIT_RATE_LIMIT.limit,
    SECRET_SUBMIT_RATE_LIMIT.windowMs,
  );

  router.handle(CHANNEL_SPECS.settingsReadAi, () =>
    readAiSettings({
      encryptionAvailable: deps.encryptionAvailable(),
      ledgerId: deps.store.currentLedgerId,
    }),
  );

  router.handle(CHANNEL_SPECS.settingsReadStatus, () =>
    readSecretStatus({ encryptionAvailable: deps.encryptionAvailable() }),
  );

  router.handle(CHANNEL_SPECS.settingsSaveSecret, (request) => {
    const decision = secretLimiter.tryConsume();
    if (!decision.ok) {
      throw new AppError('SECRET_RATE_LIMIT', { retryAfterMs: decision.retryAfterMs });
    }
    return saveSecretStub(request.payload);
  });

  router.handle(CHANNEL_SPECS.providerCapabilities, (request) =>
    getProvider(request.payload.providerId).capabilities(),
  );

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

  router.handle(CHANNEL_SPECS.backupCreate, (request) =>
    deps.store.createBackup(request.payload, request.mutationId),
  );

  router.handle(CHANNEL_SPECS.backupList, () => deps.store.listBackups());

  router.handle(CHANNEL_SPECS.backupRestore, (request) => {
    if (request.payload.mode === 'commit' && request.mutationId === null) {
      throw new AppError('PAYLOAD_INVALID', {
        fieldErrors: [{ path: 'request.mutationId', code: 'MUTATION_ID_REQUIRED' }],
      });
    }
    return deps.store.restoreBackup(request.payload, request.mutationId);
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
