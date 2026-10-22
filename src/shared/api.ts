/** 受限 preload 暴露给渲染层的 API 形状（唯一跨进程入口）。 */

import type {
  AiSettingsView,
  MockRecognitionInput,
  MockRecognitionView,
  ProviderCapabilitiesView,
  SecretSaveResult,
  SecretStatusView,
} from './dto';
import type {
  BackupCreateInput,
  BackupCreateResult,
  BackupListResult,
  BackupRestoreInput,
  BackupRestorePreviewResult,
  BackupRestoreResult,
  CategoryCreateInput,
  CategoryDisableInput,
  CategoryListResult,
  CategoryMutationResult,
  CategoryUpdateInput,
  LedgerEnsureDefaultView,
  MutationOptions,
  TransactionInput,
  TransactionListInput,
  TransactionListResult,
  TransactionMutationResult,
  TransactionUpdateInput,
  TransactionVersionedInput,
} from './entities';
import type { CategoryListInput, ProviderCapabilitiesInput, SaveSecretInput } from './ipc';
import type { AppErrorPayload } from './errors';
import type { DatasetCommand, DatasetRead } from './dataset';
import type { ProbeInput, ProbeReport } from './probe';
import type { ApprovalInput, ApprovalPreview, ApprovalResult, ReviewList, ReviewUpdate, ReviewCandidate } from './review';
import type { Asset, CandidateQuery, ImportInput, ImportResult, Job, JobList, JobQuery, PrepareInput, Resource, ResourceInput, RetryInput, Selection, StartInput, VersionedJob } from './imports';
import type { StatisticsInput, StatisticsSeries, StatisticsSummary, TopTransactionsInput, TopTransactionsResult, TopCategoriesInput, TopCategoriesResult } from './statistics';

/** 桥接结果对象：错误以数据形式返回，不跨上下文抛自定义异常（避免丢字段）。 */
export type ApiResult<T> = ({ ok: true; data: T } | { ok: false; error: AppErrorPayload }) & {
  /** 透传既有信封元数据；S06写意图绑定读取世代，旧调用方可忽略。 */
  dataEpoch?: string | null;
  dataRevision?: number;
};

export interface BookKeepApi {
  readonly dataset: {
    read(input:DatasetRead):Promise<ApiResult<unknown>>;
    command(command:DatasetCommand,options?:MutationOptions):Promise<ApiResult<unknown>>;
    save(input:{artifactId:string},options?:MutationOptions):Promise<ApiResult<{saved:boolean}>>;
  };
  readonly image: {
    select(): Promise<ApiResult<Selection>>;
    /** Actual File objects only; strings and arbitrary paths are rejected in isolated preload. */
    drop(files: readonly unknown[]): Promise<ApiResult<Selection>>;
    import(input: ImportInput, options?: MutationOptions): Promise<ApiResult<ImportResult>>;
    prepare(input: PrepareInput, options?: MutationOptions): Promise<ApiResult<Asset>>;
    resource(input: ResourceInput): Promise<ApiResult<Resource>>;
    delete(input: {imageAssetId:string;expectedVersion:number;confirmed:true}, options?:MutationOptions):Promise<ApiResult<{deleted:true;id:string}>>;
  };
  readonly recognition: {
    start(input:StartInput,options?:MutationOptions):Promise<ApiResult<{jobs:Job[];createdIds:string[];reusedIds:string[]}>>;
    status(input:JobQuery):Promise<ApiResult<Job|JobList>>;
    cancel(input:VersionedJob,options?:MutationOptions):Promise<ApiResult<Job>>;
    retry(input:RetryInput,options?:MutationOptions):Promise<ApiResult<Job>>;
    resume(input:RetryInput,options?:MutationOptions):Promise<ApiResult<Job>>;
  };
  readonly candidate: {
    list(input:CandidateQuery):Promise<ApiResult<ReviewList>>;
    update(input:ReviewUpdate,options?:MutationOptions):Promise<ApiResult<ReviewCandidate>>;
    reject(input:{id:string;expectedVersion:number;reason:string},options?:MutationOptions):Promise<ApiResult<ReviewCandidate>>;
    approve(input:ApprovalInput,options?:MutationOptions):Promise<ApiResult<ApprovalResult|ApprovalPreview>>;
  };
  readonly contractVersion: string;
  readonly skeletonStage: 'S05';
  readonly settings: {
    /** AI 配置摘要（不含密钥、明文或路径）。 */
    readAi(): Promise<ApiResult<AiSettingsView>>;
    /** 本机密钥状态；只返回 configured/mode/version，不返回掩码或片段。 */
    readStatus(): Promise<ApiResult<SecretStatusView>>;
    /** 受限密钥写入；版本冲突拒绝，存储结果不含密钥。 */
    saveSecret(input: SaveSecretInput): Promise<ApiResult<SecretSaveResult>>;
  };
  readonly provider: {
    probe(input: ProbeInput): Promise<ApiResult<ProbeReport>>;
    capabilities(input: ProviderCapabilitiesInput): Promise<ApiResult<ProviderCapabilitiesView>>;
  };
  readonly ledger: {
    /** 启动幂等初始化：不同 mutationId 多次调用也只存在一个默认账本。 */
    ensureDefault(options?: MutationOptions): Promise<ApiResult<LedgerEnsureDefaultView>>;
  };
  readonly category: {
    list(input?: CategoryListInput): Promise<ApiResult<CategoryListResult>>;
    create(
      input: CategoryCreateInput,
      options?: MutationOptions,
    ): Promise<ApiResult<CategoryMutationResult>>;
    update(
      input: CategoryUpdateInput,
      options?: MutationOptions,
    ): Promise<ApiResult<CategoryMutationResult>>;
    disable(
      input: CategoryDisableInput,
      options?: MutationOptions,
    ): Promise<ApiResult<CategoryMutationResult>>;
  };
  readonly transaction: {
    create(
      input: TransactionInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>>;
    update(
      input: TransactionUpdateInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>>;
    softDelete(
      input: TransactionVersionedInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>>;
    restore(
      input: TransactionVersionedInput,
      options?: MutationOptions,
    ): Promise<ApiResult<TransactionMutationResult>>;
    list(input: TransactionListInput): Promise<ApiResult<TransactionListResult>>;
  };
  readonly statistics: {
    series(input: StatisticsInput): Promise<ApiResult<StatisticsSeries>>;
    summary(input: StatisticsInput): Promise<ApiResult<StatisticsSummary>>;
    topTransactions(input: TopTransactionsInput): Promise<ApiResult<TopTransactionsResult>>;
    topCategories(input: TopCategoriesInput): Promise<ApiResult<TopCategoriesResult>>;
  };
  readonly backup: {
    create(
      input: BackupCreateInput,
      options?: MutationOptions,
    ): Promise<ApiResult<BackupCreateResult>>;
    list(): Promise<ApiResult<BackupListResult>>;
    restore(
      input: BackupRestoreInput,
      options?: MutationOptions,
    ): Promise<ApiResult<BackupRestorePreviewResult | BackupRestoreResult>>;
  };
  /** S04 骨架诊断入口：强制本地 mock，不出网、不读文件、不写库（S10 移除）。 */
  readonly skeleton: {
    mockRecognition(input: MockRecognitionInput): Promise<ApiResult<MockRecognitionView>>;
  };
}
