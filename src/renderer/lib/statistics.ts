import type { BookKeepApi, ApiResult } from '../../shared/api';
import type { CategoryView } from '../../shared/entities';
import type { StatisticsInput, StatisticsSeries, StatisticsSummary, TopCategoriesResult, StatisticsScope } from '../../shared/statistics';
import { BridgeError } from './bridge';

export interface StatisticsBundle {
  series: StatisticsSeries; summary: StatisticsSummary; ranking: TopCategoriesResult; categories: CategoryView[];
}
export function unwrapStatistics<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new BridgeError(result.error.code, result.error);
  return result.data;
}
export function sameStatisticsScope(expected: StatisticsScope, result: { scope: StatisticsScope }, epoch?: string | null): boolean {
  return expected.scopeId === result.scope.scopeId && expected.dataEpoch === epoch;
}
export function snapshotChanged(): BridgeError { return new BridgeError('SNAPSHOT_STALE', null); }

/** 四方读快照：不拼接不同revision/today/epoch，变化则整组重读；重试有界。 */
export async function readStatistics(api: BookKeepApi, input: StatisticsInput): Promise<StatisticsBundle> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const first = await api.statistics.series({ ...input, snapshotRevision: null });
      const series = unwrapStatistics(first);
      const bound = { ...input, snapshotRevision: series.scope.revision };
      const [summaryReply, rankReply, categoryReply] = await Promise.all([
        api.statistics.summary(bound), api.statistics.topCategories({ ...bound, pointMonth: null }), api.category.list({ includeDisabled: true }),
      ]);
      const summary = unwrapStatistics(summaryReply); const ranking = unwrapStatistics(rankReply); const cats = unwrapStatistics(categoryReply);
      if (!sameStatisticsScope(series.scope, series, first.dataEpoch) || !sameStatisticsScope(series.scope, summary, summaryReply.dataEpoch) || !sameStatisticsScope(series.scope, ranking, rankReply.dataEpoch) || cats.revision !== series.scope.revision || categoryReply.dataEpoch !== series.scope.dataEpoch) throw snapshotChanged();
      if (series.totalFen !== summary.totalFen || series.totalFen !== ranking.totalFen || series.points.reduce((sum, point) => sum + BigInt(point.amountFen), 0n).toString() !== series.totalFen || ranking.items.reduce((sum, item) => sum + BigInt(item.totalFen), 0n).toString() !== series.totalFen) throw new BridgeError('INTEGRITY_ERROR', null);
      return { series, summary, ranking, categories: cats.categories };
    } catch (error) {
      if (!(error instanceof BridgeError) || !['STALE_EPOCH', 'SNAPSHOT_STALE'].includes(error.code) || attempt === 2) throw error;
    }
  }
  throw snapshotChanged();
}
