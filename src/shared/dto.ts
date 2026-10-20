/** 主进程返回给渲染层的受限 DTO（不含路径、凭证、图片字节或 provider 原文）。 */

import type { NormalizedCandidate, ProposalWarning } from './candidate.js';

export type ProviderId = 'deepseek' | 'mock';

/** stub=骨架未接入真实识图；needs_probe=能力已声明但未真实探测；ready=已验证可用。 */
export type ProviderReadiness = 'stub' | 'ready' | 'needs_probe';

export type SecretMode = 'absent' | 'encrypted' | 'session';

export type StructuredOutputStatus = 'unverified' | 'verified' | 'unsupported';

/** settings.ai 输出（docs/CONTRACTS.md §6）。 */
export interface AiSettingsView {
  provider: 'deepseek';
  model: string;
  promptVersion: string;
  schemaVersion: string;
  readiness: ProviderReadiness;
  secretMode: SecretMode;
  configured: boolean;
  settingsVersion: number;
  ledgerId: string | null;
}

/** settings.readStatus 输出；不含掩码/片段/明文。 */
export interface SecretStatusView {
  configured: boolean;
  mode: SecretMode;
  encryptionAvailable: boolean;
  version: number;
  lastErrorCode: string | null;
}

/** settings.saveSecret 成功输出形状（S04 恒失败，S09 实现后返回）。 */
export interface SecretSaveResult {
  configured: boolean;
  mode: SecretMode;
  version: number;
}

/** provider.capabilities 输出（docs/CONTRACTS.md §7.1）。 */
export interface ProviderCapabilitiesView {
  providerId: ProviderId;
  adapterVersion: string;
  supportsImage: boolean;
  structuredOutputStatus: StructuredOutputStatus;
  trainingSubmitSupported: false;
  model: string;
  probeEvidenceId: string | null;
}

/** S04 骨架诊断场景：只驱动本地 mock，不读取文件、不出网、不写库。 */
export type MockScenario = 'paid-order' | 'two-expenses' | 'product-photo';

export interface MockRecognitionInput {
  scenario: MockScenario;
}

/** mock 识别结果视图：显式标记本地模拟，actualModel 必须为 null。 */
export interface MockRecognitionView {
  providerId: 'mock';
  localSimulation: true;
  adapterVersion: string;
  requestedModel: string;
  actualModel: null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  schemaVersion: string;
  candidates: NormalizedCandidate[];
  warnings: ProposalWarning[];
  note: string;
}

/** 骨架阶段自检/环境摘要，仅用于诊断，不含敏感信息。 */
export interface RuntimeSummaryView {
  appVersion: string;
  contractVersion: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  modules: string;
}
