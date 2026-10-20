/** 通道处理器：只做参数编排，业务逻辑在 services。S04 不写数据库、不发网络请求。 */

import { normalizeCandidateOutput } from '../../shared/candidate';
import { CANDIDATE_SCHEMA_VERSION, PROMPT_VERSION } from '../../shared/constants';
import { AppError } from '../../shared/errors';
import type { MockRecognitionView } from '../../shared/dto';
import {
  CHANNEL_SPECS,
  SECRET_SUBMIT_RATE_LIMIT,
} from '../../shared/ipc';
import { SYSTEM_CATEGORIES } from '../../shared/categories';
import type { IpcRouter } from './registry';
import { createRateLimiter } from './rate-limit';
import { getProvider } from '../services/providers';
import {
  readAiSettings,
  readSecretStatus,
  saveSecretStub,
} from '../services/settings/ai-settings';

export interface HandlerDependencies {
  readonly encryptionAvailable: () => boolean;
}

export function registerIpcHandlers(router: IpcRouter, deps: HandlerDependencies): void {
  const secretLimiter = createRateLimiter(
    SECRET_SUBMIT_RATE_LIMIT.limit,
    SECRET_SUBMIT_RATE_LIMIT.windowMs,
  );

  router.handle(CHANNEL_SPECS.settingsReadAi, () =>
    readAiSettings({ encryptionAvailable: deps.encryptionAvailable() }),
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
