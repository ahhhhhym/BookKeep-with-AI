/** provider 注册表：主进程内唯一入口，渲染层只能读能力摘要。 */

import type { ProviderId } from '../../../shared/dto';
import { deepseekProvider } from './deepseek';
import { mockProvider } from './mock';
import type { RecognitionProvider } from './types';

const PROVIDERS: Readonly<Record<ProviderId, RecognitionProvider>> = {
  deepseek: deepseekProvider,
  mock: mockProvider,
};

export function getProvider(id: ProviderId): RecognitionProvider {
  return PROVIDERS[id];
}

export function listProviders(): readonly RecognitionProvider[] {
  return [PROVIDERS.deepseek, PROVIDERS.mock];
}

export { deepseekProvider, mockProvider };
export type { ProviderResult, RecognitionProvider, RecognitionRequest } from './types';
