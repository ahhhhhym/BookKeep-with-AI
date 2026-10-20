import type { JSX } from 'react';
import { PageHeader, Panel, SkeletonNotice } from '../components/ui';
import { SYSTEM_CATEGORIES } from '../../shared/categories';
import { AppIcon } from '../lib/icon-registry';

/** P02 分类：使用 ICON-MAP 的 34 个稳定分类渲染真实图标（只读展示）。 */
export function CategoriesPage(): JSX.Element {
  const enabled = SYSTEM_CATEGORIES.filter((category) => category.enabled);
  const protectedOther = SYSTEM_CATEGORIES.find((category) => category.protected);

  return (
    <div className="page">
      <PageHeader
        title="分类"
        subtitle={`共 ${SYSTEM_CATEGORIES.length} 个初始分类（33 个消费分类 + “其他”）；“设置”是导航入口，不是分类。`}
      />

      <Panel
        title="启用中的分类"
        actions={<span className="tiny">排序：sortOrder = 序号 × 10</span>}
      >
        <div className="category-grid">
          {enabled.map((category) => (
            <div key={category.id} className="category-card">
              <span className="category-icon">
                <AppIcon iconKey={category.iconKey} size={20} />
              </span>
              <div className="category-meta">
                <div className="category-name">
                  {category.name}
                  {category.protected ? <span className="tiny">（受保护）</span> : null}
                </div>
                <div className="category-id" title={category.id}>
                  {category.id}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <SkeletonNotice
        step="S05（分类落库）/ S06（分类维护）"
        items={[
          `改名、换图标、排序与停用（${protectedOther?.name ?? '其他'} 按身份保护不可停用）`,
          '新建自定义分类（UUID + systemKey=null），最多 500 个',
          '旧交易与统计保留停用分类的关联和金额',
        ]}
      />
    </div>
  );
}
